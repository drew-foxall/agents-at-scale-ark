import chalk from 'chalk';
import {Command} from 'commander';
import open from 'open';
import ora from 'ora';
import {execa} from 'execa';
import type {ArkConfig} from '../../lib/config.js';
import {ArkServiceProxy} from '../../lib/arkServiceProxy.js';
import {arkServices} from '../../arkServices.js';
import {isCommandAvailable} from '../../lib/commands.js';

function resolveDashboardPort(config: ArkConfig) {
  const envPort = Number(process.env.ARK_DASHBOARD_PORT);
  if (Number.isInteger(envPort) && envPort > 0) {
    return envPort;
  }
  return config.local?.ports?.arkDashboard ?? 3000;
}

function resolveProcessComposePort(config: ArkConfig) {
  const envPort = Number(process.env.PC_PORT_NUM);
  if (Number.isInteger(envPort) && envPort > 0) {
    return envPort;
  }
  return config.local?.ports?.processCompose ?? 9100;
}

async function localDashboardUrl(config: ArkConfig) {
  const hasProcessCompose = await isCommandAvailable('process-compose');
  if (!hasProcessCompose) {
    return null;
  }
  const pcPort = resolveProcessComposePort(config);
  try {
    await execa(
      'process-compose',
      ['project', 'is-ready', '-p', String(pcPort)],
      {timeout: 2000}
    );
  } catch {
    return null;
  }
  try {
    const {stdout} = await execa(
      'process-compose',
      ['-p', String(pcPort), 'process', 'list', '-o', 'wide'],
      {timeout: 2000}
    );
    const dashboardRunning = stdout
      .split('\n')
      .some((line) => /\sark-dashboard\s+\S+\s+Running\s+/i.test(line));
    if (!dashboardRunning) {
      return null;
    }
  } catch {
    return null;
  }
  const dashPort = resolveDashboardPort(config);
  return `http://localhost:${dashPort}`;
}

export async function openDashboard(config: ArkConfig) {
  const spinner = ora('Connecting to dashboard').start();

  try {
    const localUrl = await localDashboardUrl(config);
    if (localUrl) {
      spinner.succeed('Dashboard connected');
      console.log(`ARK dashboard running on: ${chalk.green(localUrl)}`);
      console.log(chalk.gray('Press Ctrl+C to stop'));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await open(localUrl);
      process.on('SIGINT', () => {
        process.exit(0);
      });
      process.stdin.resume();
      return;
    }

    const dashboardService = arkServices['ark-dashboard'];
    const proxy = new ArkServiceProxy(
      dashboardService,
      3274, // DASH on phone keypad
      config.services?.reusePortForwards ?? false
    );

    const url = await proxy.start();
    spinner.succeed('Dashboard connected');

    console.log(`ARK dashboard running on: ${chalk.green(url)}`);
    console.log(chalk.gray('Press Ctrl+C to stop'));

    // Brief pause before opening browser
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Open browser
    await open(url);

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      proxy.stop();
      process.exit(0);
    });

    // Keep process alive
    process.stdin.resume();
  } catch (error) {
    spinner.fail(
      error instanceof Error ? error.message : 'Failed to start dashboard'
    );
    process.exit(1);
  }
}

export function createDashboardCommand(config: ArkConfig): Command {
  const dashboardCommand = new Command('dashboard');
  dashboardCommand
    .description('Open the ARK dashboard in your browser')
    .action(() => openDashboard(config));

  return dashboardCommand;
}
