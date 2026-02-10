import {Command} from 'commander';
import {execa} from 'execa';
import fs from 'fs';
import path from 'path';
import output from '../../lib/output.js';
import type {ArkConfig} from '../../lib/config.js';
import {isCommandAvailable} from '../../lib/commands.js';

type StartOptions = {
  dependency?: string[];
  profile?: string[];
  headless?: boolean;
};

function collectValues(value: string, previous: string[] = []) {
  return previous.concat(value);
}

function resolveProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    const hasRootDevspace = fs.existsSync(path.join(dir, 'devspace.yaml'));
    const hasArkDependency = fs.existsSync(path.join(dir, 'ark', 'devspace.yaml'));
    const hasCli = fs.existsSync(path.join(dir, 'tools', 'ark-cli'));
    if (hasRootDevspace && hasArkDependency && hasCli) {
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

async function ensureDevspaceAvailable() {
  const available = await isCommandAvailable('devspace', ['--version']);
  if (!available) {
    output.error('devspace is required');
    output.info('Install: https://www.devspace.sh/docs/getting-started/installation');
    process.exit(1);
  }
}

async function runDevspace(args: string[], cwd: string) {
  await execa('devspace', args, {cwd, stdio: 'inherit'});
}

function applyCommonStartOptions(args: string[], options: StartOptions) {
  const next = [...args];
  for (const profile of options.profile || []) {
    next.push('-p', profile);
  }
  for (const dependency of options.dependency || []) {
    next.push('--dependency', dependency);
  }
  return next;
}

async function startDev(options: StartOptions, passthroughArgs: string[] = []) {
  await ensureDevspaceAvailable();
  const rootDir = resolveProjectRoot(process.cwd());
  const args = applyCommonStartOptions(['dev'], options);
  if (options.headless) {
    output.info('DevSpace mode enabled; --headless has no special effect');
  }
  args.push(...passthroughArgs);
  await runDevspace(args, rootDir);
}

async function stopDev(args: string[] = []) {
  await ensureDevspaceAvailable();
  const rootDir = resolveProjectRoot(process.cwd());
  await runDevspace(['purge', ...args], rootDir);
}

async function showDevStatus(args: string[] = []) {
  await ensureDevspaceAvailable();
  const rootDir = resolveProjectRoot(process.cwd());
  await runDevspace(['list', 'deployments', ...args], rootDir);
}

async function showDevLogs(args: string[] = []) {
  await ensureDevspaceAvailable();
  const rootDir = resolveProjectRoot(process.cwd());
  if (args.length > 0 && !args[0].startsWith('-')) {
    await runDevspace(['logs', '--dependency', args[0], ...args.slice(1)], rootDir);
    return;
  }
  await runDevspace(['logs', ...args], rootDir);
}

function addStartOptions(cmd: Command) {
  return cmd
    .option(
      '--dependency <name>',
      'limit devspace execution to one or more dependencies',
      collectValues,
      []
    )
    .option(
      '-p, --profile <name>',
      'activate one or more devspace profiles',
      collectValues,
      []
    )
    .option('--headless', 'kept for compatibility; no special behavior in devspace mode')
    .argument('[args...]', 'additional arguments passed to devspace dev');
}

function handleStartAction() {
  return (args: string[] = [], options: StartOptions = {}) => {
    startDev(options, args).catch((error) => {
      output.error(
        error instanceof Error ? error.message : 'failed to start ark dev'
      );
      process.exit(1);
    });
  };
}

export function createDevCommand(_: ArkConfig): Command {
  const devCommand = new Command('dev');
  addStartOptions(devCommand).description('Run Ark locally using DevSpace');

  devCommand.action(handleStartAction());

  addStartOptions(devCommand.command('start')).action(handleStartAction());

  devCommand
    .command('stop')
    .argument('[args...]', 'arguments passed to devspace purge')
    .action((args: string[] = []) => {
      stopDev(args).catch((error) => {
        output.error(
          error instanceof Error ? error.message : 'failed to stop ark dev'
        );
        process.exit(1);
      });
    });

  devCommand
    .command('status')
    .argument('[args...]', 'arguments passed to devspace list deployments')
    .action((args: string[] = []) => {
      showDevStatus(args).catch((error) => {
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
    .argument('[args...]', 'service name or arguments passed to devspace logs')
    .action((args: string[] = []) => {
      showDevLogs(args).catch((error) => {
        output.error(
          error instanceof Error ? error.message : 'failed to fetch logs'
        );
        process.exit(1);
      });
    });

  return devCommand;
}
