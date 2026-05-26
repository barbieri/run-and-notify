import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/command.js';
import type { RunAndNotifyConfig } from '../src/types.js';
import { loggerCalls } from './logger-mock.js';

const baseConfig: RunAndNotifyConfig = {
  name: 'run-and-notify',
  locale: 'en-US',
  dryRun: false,
  propagateExitCode: true,
  timeoutSeconds: 0,
  showStderrIfSuccess: false,
  hideCommandIfSuccess: false,
  stdout: { format: 'raw' },
  stderr: { format: 'raw' },
  transports: {},
  success: {},
  error: {},
};

const commandOptions = (): { env: NodeJS.ProcessEnv } => ({ env: { ...process.env } });

describe('runCommand', () => {
  const env = process.env as NodeJS.ProcessEnv & {
    RUN_AND_NOTIFY_CHILD_ENV_EXPLICIT?: string;
    RUN_AND_NOTIFY_CHILD_ENV_SNAPSHOT?: string;
  };

  it('executes a command and parses stdout and stderr', async () => {
    const result = await runCommand(
      [process.execPath, path.resolve('tests/fixtures/output-jsonl.mjs')],
      {
        ...baseConfig,
        stdout: { format: 'jsonl' },
        stderr: { format: 'jsonl' },
      },
      commandOptions(),
    );

    expect(result.status).toBe(0);
    expect(result.executedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.stdout).toEqual({
      format: 'jsonl',
      lines: [{ level: 'info', message: 'built', count: 2 }, { raw: 'not json' }],
    });
    expect(result.stderr).toEqual({
      format: 'jsonl',
      lines: [{ level: 'warn', message: 'stderr' }],
    });
    expect(loggerCalls).toContainEqual({
      level: 'info',
      args: ['spawn %o %o', process.execPath, [path.resolve('tests/fixtures/output-jsonl.mjs')]],
    });
    expect(loggerCalls).toContainEqual(
      expect.objectContaining({
        level: 'info',
        args: [
          expect.objectContaining({ code: 0, signal: null, elapsedSeconds: expect.any(Number) }),
          'close: code=%s, signal=%s, time=%s seconds',
          0,
          null,
          expect.any(Number),
        ],
      }),
    );
  });

  it('rejects when no command is provided', async () => {
    await expect(runCommand([], baseConfig, commandOptions())).rejects.toThrow(
      'No command provided',
    );
  });

  it('propagates explicitly configured environment variables by default', async () => {
    env.RUN_AND_NOTIFY_CHILD_ENV_EXPLICIT = 'visible';
    try {
      const result = await runCommand(
        [
          process.execPath,
          '-e',
          "process.stdout.write(process.env.RUN_AND_NOTIFY_CHILD_ENV_EXPLICIT ?? '')",
        ],
        baseConfig,
        commandOptions(),
      );

      expect(result.stdout).toEqual({ format: 'raw', raw: 'visible' });
    } finally {
      delete env.RUN_AND_NOTIFY_CHILD_ENV_EXPLICIT;
    }
  });

  it('uses the provided environment snapshot for the child process', async () => {
    const childEnv = { ...process.env };
    Reflect.deleteProperty(childEnv, 'RUN_AND_NOTIFY_CHILD_ENV_SNAPSHOT');
    env.RUN_AND_NOTIFY_CHILD_ENV_SNAPSHOT = 'secret';
    try {
      const result = await runCommand(
        [
          process.execPath,
          '-e',
          "process.stdout.write(process.env.RUN_AND_NOTIFY_CHILD_ENV_SNAPSHOT ?? 'missing')",
        ],
        baseConfig,
        { env: childEnv },
      );

      expect(result.stdout).toEqual({ format: 'raw', raw: 'missing' });
    } finally {
      delete env.RUN_AND_NOTIFY_CHILD_ENV_SNAPSHOT;
    }
  });

  it('rejects when the command executable cannot be spawned', async () => {
    await expect(
      runCommand(['missing-run-and-notify-command'], baseConfig, commandOptions()),
    ).rejects.toThrow();
    expect(loggerCalls).toContainEqual(
      expect.objectContaining({
        level: 'error',
        args: [expect.objectContaining({ err: expect.any(Error) }), 'error: %s', expect.any(Error)],
      }),
    );
  });

  it('clears an active timeout when spawning fails', async () => {
    await expect(
      runCommand(
        ['missing-run-and-notify-command'],
        { ...baseConfig, timeoutSeconds: 1 },
        commandOptions(),
      ),
    ).rejects.toThrow();
  });

  it('returns 124 when the timeout kills the process', async () => {
    const result = await runCommand(
      [process.execPath, '-e', 'setTimeout(() => {}, 10_000)'],
      {
        ...baseConfig,
        timeoutSeconds: 1,
      },
      commandOptions(),
    );

    expect(result.status).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(loggerCalls).toContainEqual({
      level: 'warn',
      args: [
        { elapsedSeconds: expect.any(Number) },
        'timed out waiting for child process %s after %s seconds',
        expect.any(Number),
        expect.any(Number),
      ],
    });
  });

  it('returns status 1 and signal when a process exits from a signal without timeout', async () => {
    const result = await runCommand(
      [process.execPath, '-e', "process.kill(process.pid, 'SIGTERM')"],
      baseConfig,
      commandOptions(),
    );

    expect(result.status).toBe(1);
    expect(result.signal).toBe('SIGTERM');
    expect(result.timedOut).toBe(false);
  });
});
