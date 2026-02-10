import {Command} from 'commander';
import {execa} from 'execa';
import fs from 'fs';
import path from 'path';
import output from '../../lib/output.js';
import type {ArkConfig} from '../../lib/config.js';
import {isCommandAvailable} from '../../lib/commands.js';

type PortOverrides = {
  arkApi: number;
  arkBroker: number;
  arkDashboard: number;
  arkControllerHealth: number;
  processCompose: number;
};

type DevOptions = {
  services?: string;
  port?: string[];
  noUi?: boolean;
  uiOnly?: boolean;
  headless?: boolean;
};

function resolvePorts(config: ArkConfig, overrides: Partial<PortOverrides>) {
  const base = {
    arkApi: 8000,
    arkBroker: 8080,
    arkDashboard: 3000,
    arkControllerHealth: 8081,
    processCompose: 9100,
  };
  const configPorts = config.local?.ports || {};
  return {
    arkApi: overrides.arkApi ?? configPorts.arkApi ?? base.arkApi,
    arkBroker: overrides.arkBroker ?? configPorts.arkBroker ?? base.arkBroker,
    arkDashboard:
      overrides.arkDashboard ?? configPorts.arkDashboard ?? base.arkDashboard,
    arkControllerHealth:
      overrides.arkControllerHealth ??
      configPorts.arkControllerHealth ??
      base.arkControllerHealth,
    processCompose:
      overrides.processCompose ??
      configPorts.processCompose ??
      base.processCompose,
  };
}

function parsePortOverrides(values: string[] = []) {
  const overrides: Partial<PortOverrides> = {};
  for (const value of values) {
    const [key, portValue] = value.split('=');
    if (!key || !portValue) {
      output.error(`Invalid port override: ${value}`);
      process.exit(1);
    }
    const port = Number(portValue);
    if (!Number.isInteger(port) || port <= 0) {
      output.error(`Invalid port number: ${portValue}`);
      process.exit(1);
    }
    const normalized = key.trim().toLowerCase();
    if (normalized === 'api' || normalized === 'ark-api') {
      overrides.arkApi = port;
      continue;
    }
    if (normalized === 'broker' || normalized === 'ark-broker') {
      overrides.arkBroker = port;
      continue;
    }
    if (normalized === 'dashboard' || normalized === 'ark-dashboard') {
      overrides.arkDashboard = port;
      continue;
    }
    if (
      normalized === 'controller-health' ||
      normalized === 'ark-controller-health'
    ) {
      overrides.arkControllerHealth = port;
      continue;
    }
    if (
      normalized === 'process-compose' ||
      normalized === 'processcompose' ||
      normalized === 'pc'
    ) {
      overrides.processCompose = port;
      continue;
    }
    output.error(`Unknown port target: ${key}`);
    process.exit(1);
  }
  return overrides;
}

function resolveNamespaces(options: DevOptions) {
  if (options.noUi && options.uiOnly) {
    output.error('Use either --no-ui or --ui-only, not both');
    process.exit(1);
  }
  if (options.uiOnly) {
    return ['ui'];
  }
  if (options.noUi) {
    return ['infra', 'core'];
  }
  if (options.headless && !options.services) {
    return ['infra', 'core'];
  }
  if (!options.services) {
    return [];
  }
  const entries = options.services
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  if (entries.includes('all')) {
    return [];
  }
  const namespaces = new Set<string>();
  if (
    entries.includes('services') ||
    entries.includes('core') ||
    entries.some((entry) =>
      [
        'ark-api',
        'ark-broker',
        'ark-controller',
        'ark-sdk-build',
      ].includes(entry)
    )
  ) {
    namespaces.add('infra');
    namespaces.add('core');
  }
  if (
    entries.includes('ui') ||
    entries.includes('dashboard') ||
    entries.includes('ark-dashboard')
  ) {
    namespaces.add('ui');
  }
  if (entries.includes('infra')) {
    namespaces.add('infra');
  }
  return Array.from(namespaces);
}

function findComposeFile(config: ArkConfig, rootDir: string) {
  const composeFile = config.local?.composeFile || 'process-compose.yaml';
  const composePath = path.resolve(rootDir, composeFile);
  if (!fs.existsSync(composePath)) {
    output.error(`Missing ${composeFile} in ${rootDir}`);
    process.exit(1);
  }
  return composePath;
}

function resolveProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    const hasCompose = fs.existsSync(path.join(dir, 'process-compose.yaml'));
    const hasDepsScript = fs.existsSync(
      path.join(dir, 'scripts', 'local', 'ensure-deps.sh')
    );
    if (hasCompose && hasDepsScript) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  output.error(
    `Unable to locate project root from ${startDir}. Run this command in the Ark repository.`
  );
  process.exit(1);
  return startDir;
}

async function runProcessCompose(
  args: string[],
  env: Record<string, string | undefined>,
  cwd: string
) {
  await execa('process-compose', args, {cwd, env, stdio: 'inherit'});
}

async function runProcessComposeWithCapture(
  args: string[],
  env: Record<string, string | undefined>,
  cwd: string
) {
  const result = await execa('process-compose', args, {cwd, env});
  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
}

function getErrorText(error: unknown) {
  if (error && typeof error === 'object') {
    const execaError = error as {
      stderr?: string;
      stdout?: string;
      shortMessage?: string;
      message?: string;
    };
    return [
      execaError.stderr,
      execaError.stdout,
      execaError.shortMessage,
      execaError.message,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return String(error);
}

function isProjectNotRunningError(error: unknown) {
  const message = getErrorText(error);
  return message.includes('connect: connection refused');
}

async function ensureProcessComposeAvailable() {
  const available = await isCommandAvailable('process-compose', ['version']);
  if (!available) {
    output.error('process-compose is required');
    process.exit(1);
  }
}

async function ensureDependencies(rootDir: string) {
  const scriptPath = path.resolve(rootDir, 'scripts/local/ensure-deps.sh');
  if (!fs.existsSync(scriptPath)) {
    output.error(`Missing ${scriptPath}`);
    process.exit(1);
  }
  await execa(scriptPath, [], {cwd: rootDir, stdio: 'inherit'});
}

function buildEnv(ports: PortOverrides, rootDir: string, config: ArkConfig) {
  const kubeconfigPath = path.join(rootDir, 'out', 'local-kubeconfig');
  return {
    ...process.env,
    ARK_BROKER_PORT: String(ports.arkBroker),
    ARK_API_PORT: String(ports.arkApi),
    ARK_DASHBOARD_PORT: String(ports.arkDashboard),
    ARK_CONTROLLER_HEALTH_PORT: String(ports.arkControllerHealth),
    PC_PORT_NUM: String(ports.processCompose),
    ARK_K8S_PROVIDER: config.local?.k8sProvider || 'auto',
    KUBECONFIG: kubeconfigPath,
    CORS_ORIGINS: `http://localhost:${ports.arkDashboard}`,
    ARK_API_SERVICE_HOST: 'localhost',
    ARK_API_SERVICE_PORT: String(ports.arkApi),
    ARK_API_SERVICE_PROTOCOL: 'http',
  };
}

async function startDev(config: ArkConfig, options: DevOptions) {
  const rootDir = resolveProjectRoot(process.cwd());
  await ensureDependencies(rootDir);
  await ensureProcessComposeAvailable();

  const portOverrides = parsePortOverrides(options.port);
  const ports = resolvePorts(config, portOverrides);
  const namespaces = resolveNamespaces(options);
  const composePath = findComposeFile(config, rootDir);
  const envFile = path.resolve(rootDir, '.env.dev');
  if (!fs.existsSync(envFile)) {
    output.error(`Missing ${envFile}`);
    process.exit(1);
  }

  const args = ['-p', String(ports.processCompose), '-f', composePath];
  const defaultEnv = path.resolve(rootDir, '.env');
  if (fs.existsSync(defaultEnv)) {
    args.push('-e', defaultEnv);
  }
  args.push('-e', envFile);
  for (const namespace of namespaces) {
    args.push('-n', namespace);
  }
  if (options.headless) {
    args.push('-t=false');
  }
  args.push('up');

  const env = buildEnv(ports, rootDir, config);
  try {
    await runProcessCompose(args, env, rootDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const canRetryHeadless =
      !options.headless && message.includes('exit code 255');
    if (!canRetryHeadless) {
      throw error;
    }

    output.warning('process-compose TUI failed, retrying in headless mode');
    const headlessArgs = [...args];
    const upIndex = headlessArgs.lastIndexOf('up');
    if (upIndex >= 0) {
      headlessArgs.splice(upIndex, 0, '-t=false');
    } else {
      headlessArgs.push('-t=false');
    }
    await runProcessCompose(headlessArgs, env, rootDir);
  }
}

async function stopDev(config: ArkConfig) {
  await ensureProcessComposeAvailable();
  const ports = resolvePorts(config, {});
  const args = ['-p', String(ports.processCompose), 'down'];
  const rootDir = resolveProjectRoot(process.cwd());
  try {
    await runProcessComposeWithCapture(args, process.env, rootDir);
  } catch (error) {
    if (isProjectNotRunningError(error)) {
      output.info('Ark local dev is not running');
      return;
    }
    throw error;
  }
}

async function showDevStatus(config: ArkConfig) {
  await ensureProcessComposeAvailable();
  const ports = resolvePorts(config, {});
  const args = [
    '-p',
    String(ports.processCompose),
    'process',
    'list',
    '-o',
    'wide',
  ];
  const rootDir = resolveProjectRoot(process.cwd());
  try {
    await runProcessComposeWithCapture(args, process.env, rootDir);
  } catch (error) {
    if (isProjectNotRunningError(error)) {
      output.info('Ark local dev is not running');
      return;
    }
    throw error;
  }
}

async function showDevLogs(config: ArkConfig, service: string) {
  await ensureProcessComposeAvailable();
  if (!service) {
    output.error('Service name is required');
    process.exit(1);
  }
  const ports = resolvePorts(config, {});
  const args = [
    '-p',
    String(ports.processCompose),
    'process',
    'logs',
    service,
  ];
  const rootDir = resolveProjectRoot(process.cwd());
  try {
    await runProcessCompose(args, process.env, rootDir);
  } catch (error) {
    if (isProjectNotRunningError(error)) {
      output.info('Ark local dev is not running');
      return;
    }
    throw error;
  }
}

function addStartOptions(cmd: Command) {
  return cmd
    .option('--services <list>', 'comma-separated list of services to start')
    .option(
      '--port <mapping>',
      'override port, e.g. dashboard=4000',
      (value: string, previous: string[] = []) => previous.concat(value),
      []
    )
    .option('--no-ui', 'start backend services only')
    .option('--ui-only', 'start dashboard only')
    .option(
      '--headless',
      'run without process-compose TUI; defaults to backend services only'
    );
}

function handleStartAction(config: ArkConfig) {
  return (options: DevOptions) => {
    startDev(config, options).catch((error) => {
      output.error(
        error instanceof Error ? error.message : 'failed to start ark dev'
      );
      process.exit(1);
    });
  };
}

export function createDevCommand(config: ArkConfig): Command {
  const devCommand = new Command('dev');
  addStartOptions(devCommand).description(
    'Run Ark locally using process-compose'
  );

  devCommand.action(handleStartAction(config));

  addStartOptions(devCommand.command('start')).action(
    handleStartAction(config)
  );

  devCommand.command('stop').action(() => {
    stopDev(config).catch((error) => {
      output.error(
        error instanceof Error ? error.message : 'failed to stop ark dev'
      );
      process.exit(1);
    });
  });

  devCommand.command('status').action(() => {
    showDevStatus(config).catch((error) => {
      output.error(
        error instanceof Error
          ? error.message
          : 'failed to check ark dev status'
      );
      process.exit(1);
    });
  });

  devCommand
    .command('logs')
    .argument('<service>')
    .action((service: string) => {
      showDevLogs(config, service).catch((error) => {
        output.error(
          error instanceof Error ? error.message : 'failed to fetch logs'
        );
        process.exit(1);
      });
    });

  return devCommand;
}
