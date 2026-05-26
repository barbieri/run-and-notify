import { spawn } from 'node:child_process';
import process from 'node:process';
import { logger } from './logger.js';
import { parseOutput } from './output.js';
import type { CommandResult, RunAndNotifyConfig } from './types.js';

type RunCommandOptions = {
  env: NodeJS.ProcessEnv;
};

export const runCommand = async (
  command: string[],
  config: RunAndNotifyConfig,
  options: RunCommandOptions,
): Promise<CommandResult> => {
  if (command.length === 0) {
    throw new Error('No command provided. Pass the command after --.');
  }

  const [executable = '', ...args] = command;

  const cwd = config.cwd ?? process.cwd();
  const executedAt = new Date().toISOString();
  let stdout = '';
  let stderr = '';
  let timedOut = false;

  let childLogger = logger.child({ executable, args });
  childLogger.info('spawn %o %o', executable, args);

  const child = spawn(executable, args, {
    cwd,
    env: options.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const start = Date.now();

  const getElapsedInSeconds = () => (Date.now() - start) / 1000;

  childLogger = childLogger.child({ pid: child.pid });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    childLogger.debug('stdout: %o', chunk);
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    childLogger.debug('stderr: %o', chunk);
    stderr += chunk;
  });

  const timeout =
    config.timeoutSeconds > 0
      ? setTimeout(() => {
          const elapsedSeconds = getElapsedInSeconds();
          childLogger.warn(
            { elapsedSeconds },
            'timed out waiting for child process %s after %s seconds',
            child.pid,
            elapsedSeconds,
          );
          timedOut = true;
          child.kill('SIGTERM');
        }, config.timeoutSeconds * 1000)
      : undefined;

  return await new Promise<CommandResult>((resolve, reject) => {
    child.on('error', (error) => {
      const elapsedSeconds = getElapsedInSeconds();
      childLogger.error({ err: error, elapsedSeconds }, 'error: %s', error);
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      reject(error);
    });

    child.on('close', (code, signal) => {
      const elapsedSeconds = getElapsedInSeconds();
      childLogger.info(
        { code, signal, elapsedSeconds },
        'close: code=%s, signal=%s, time=%s seconds',
        code,
        signal,
        elapsedSeconds,
      );
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }

      resolve({
        command,
        cwd,
        status: timedOut ? 124 : (code ?? 1),
        ...(signal !== null ? { signal } : {}),
        timedOut,
        executedAt,
        elapsedSeconds,
        stdout: parseOutput(stdout, config.stdout),
        stderr: parseOutput(stderr, config.stderr),
      });
    });
  });
};
