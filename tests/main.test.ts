import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { main } from '../src/run-and-notify.js';
import { loggerCalls } from './logger-mock.js';

const env = process.env as NodeJS.ProcessEnv & {
  MISSING_MAIN_SLACK_TOKEN?: string;
  RUN_AND_NOTIFY_MAIN_DOTENV_ONLY?: string;
  RUN_AND_NOTIFY_MAIN_DOTENV_PRESET?: string;
};

const writeConfig = async (config: unknown): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-and-notify-main-'));
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
};

const disabledSmtpTransport = {
  enabled: false,
  host: 'smtp.example.com',
  port: 587,
  from: 'bot@example.com',
  to: ['ops@example.com'],
};

const enabledSmtpTransport = {
  ...disabledSmtpTransport,
  enabled: true,
};

describe('main', () => {
  it('returns 0 for --help without requiring configuration', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(main(['--help'])).resolves.toBe(0);
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Options:'));
    } finally {
      consoleError.mockRestore();
    }
  });

  it('returns 0 for -h without requiring configuration', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(main(['-h'])).resolves.toBe(0);
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Options:'));
    } finally {
      consoleError.mockRestore();
    }
  });

  it('returns 1 for invalid CLI arguments after printing the parser error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(main(['--stdout.does-not-exist=true'])).resolves.toBe(1);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Unknown option: stdout.does-not-exist'),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('returns the command status after a successful notification pass', async () => {
    const configPath = await writeConfig({
      locale: 'en-US',
      dryRun: true,
      timeoutSeconds: 0,
      showStderrIfSuccess: false,
      stdout: { format: 'raw' },
      stderr: { format: 'raw' },
      transports: {
        smtp: enabledSmtpTransport,
      },
      success: {},
      error: {},
    });

    await expect(
      main(['--config', configPath, '--', process.execPath, '-e', 'process.exit(3)']),
    ).resolves.toBe(3);
  });

  it('returns 0 for command failure when exit-code propagation is disabled in config', async () => {
    const configPath = await writeConfig({
      locale: 'en-US',
      dryRun: true,
      propagateExitCode: false,
      timeoutSeconds: 0,
      showStderrIfSuccess: false,
      stdout: { format: 'raw' },
      stderr: { format: 'raw' },
      transports: {
        smtp: enabledSmtpTransport,
      },
      success: {},
      error: {},
    });

    await expect(
      main(['--config', configPath, '--', process.execPath, '-e', 'process.exit(3)']),
    ).resolves.toBe(0);
  });

  it('returns 0 for command failure when exit-code propagation is disabled by CLI switch', async () => {
    const configPath = await writeConfig({
      locale: 'en-US',
      dryRun: true,
      timeoutSeconds: 0,
      showStderrIfSuccess: false,
      stdout: { format: 'raw' },
      stderr: { format: 'raw' },
      transports: {
        smtp: enabledSmtpTransport,
      },
      success: {},
      error: {},
    });

    await expect(
      main([
        '--config',
        configPath,
        '--no-propagate-exit-code',
        '--',
        process.execPath,
        '-e',
        'process.exit(3)',
      ]),
    ).resolves.toBe(0);
  });

  it('returns 1 when transport delivery fails', async () => {
    const configPath = await writeConfig({
      locale: 'en-US',
      timeoutSeconds: 0,
      showStderrIfSuccess: false,
      stdout: { format: 'raw' },
      stderr: { format: 'raw' },
      transports: {
        smtp: disabledSmtpTransport,
        slack: {
          enabled: true,
          tokenEnvVar: 'MISSING_MAIN_SLACK_TOKEN',
        },
      },
      success: {
        slack: {
          blocks: 'default.slack.blocks.json.hbs',
        },
      },
      error: {
        slack: {
          blocks: 'default.slack.blocks.json.hbs',
        },
      },
    });

    delete env.MISSING_MAIN_SLACK_TOKEN;

    await expect(main(['--config', configPath, '--', process.execPath, '-e', ''])).resolves.toBe(1);
    expect(loggerCalls).toContainEqual(
      expect.objectContaining({
        level: 'fatal',
        args: [
          expect.objectContaining({ err: expect.any(Error) }),
          'transport failure: %s',
          expect.any(Error),
        ],
      }),
    );
  });

  it('returns 1 when rendering fails after the command runs', async () => {
    const markerPath = path.join(
      os.tmpdir(),
      `run-and-notify-render-failure-ran-${process.pid}-${Date.now()}`,
    );
    const configPath = await writeConfig({
      locale: 'en-US',
      timeoutSeconds: 0,
      showStderrIfSuccess: false,
      stdout: { format: 'raw' },
      stderr: { format: 'raw' },
      transports: {
        smtp: enabledSmtpTransport,
      },
      success: {
        email: {
          subject: 'success.subject.hbs',
          html: 'missing-template.hbs',
        },
      },
      error: {},
    });

    await expect(
      main([
        '--config',
        configPath,
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`,
      ]),
    ).resolves.toBe(1);
    await expect(fs.readFile(markerPath, 'utf8')).resolves.toBe('ran');
    expect(loggerCalls).toContainEqual(
      expect.objectContaining({
        level: 'fatal',
        args: [
          expect.objectContaining({ err: expect.any(Error) }),
          'transport failure: %s',
          expect.any(Error),
        ],
      }),
    );
  });

  it('returns 1 without running the command when no transport is enabled', async () => {
    const markerPath = path.join(
      os.tmpdir(),
      `run-and-notify-should-not-run-${process.pid}-${Date.now()}`,
    );
    const configPath = await writeConfig({
      locale: 'en-US',
      timeoutSeconds: 0,
      showStderrIfSuccess: false,
      stdout: { format: 'raw' },
      stderr: { format: 'raw' },
      transports: {
        smtp: disabledSmtpTransport,
      },
      success: {},
      error: {},
    });

    await expect(
      main([
        '--config',
        configPath,
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`,
      ]),
    ).resolves.toBe(1);
    await expect(fs.readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(loggerCalls).toContainEqual(
      expect.objectContaining({
        level: 'fatal',
        args: [
          expect.objectContaining({ err: expect.any(Error) }),
          'transport failure: %s',
          expect.any(Error),
        ],
      }),
    );
  });

  it('returns 1 without running the command in dry-run when no transport is enabled', async () => {
    const markerPath = path.join(
      os.tmpdir(),
      `run-and-notify-dry-run-should-not-run-${process.pid}-${Date.now()}`,
    );
    const configPath = await writeConfig({
      locale: 'en-US',
      dryRun: true,
      timeoutSeconds: 0,
      showStderrIfSuccess: false,
      stdout: { format: 'raw' },
      stderr: { format: 'raw' },
      transports: {
        smtp: disabledSmtpTransport,
      },
      success: {},
      error: {},
    });

    await expect(
      main([
        '--config',
        configPath,
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`,
      ]),
    ).resolves.toBe(1);
    await expect(fs.readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(loggerCalls).toContainEqual(
      expect.objectContaining({
        level: 'fatal',
        args: [
          expect.objectContaining({ err: expect.any(Error) }),
          'transport failure: %s',
          expect.any(Error),
        ],
      }),
    );
  });

  it('does not propagate dotenv-loaded environment variables to the target command', async () => {
    const cwd = process.cwd();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-and-notify-main-dotenv-'));
    const configPath = path.join(dir, 'config.json');
    const markerPath = path.join(dir, 'child-env.txt');
    await fs.writeFile(
      path.join(dir, '.env'),
      [
        'RUN_AND_NOTIFY_MAIN_DOTENV_ONLY=from-dotenv',
        'RUN_AND_NOTIFY_MAIN_DOTENV_PRESET=from-dotenv',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          locale: 'en-US',
          dryRun: true,
          timeoutSeconds: 0,
          showStderrIfSuccess: false,
          stdout: { format: 'raw' },
          stderr: { format: 'raw' },
          transports: {
            smtp: enabledSmtpTransport,
          },
          success: {},
          error: {},
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    delete env.RUN_AND_NOTIFY_MAIN_DOTENV_ONLY;
    env.RUN_AND_NOTIFY_MAIN_DOTENV_PRESET = 'before';

    try {
      process.chdir(dir);
      await expect(
        main([
          '--config',
          configPath,
          '--',
          process.execPath,
          '-e',
          `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(
            markerPath,
          )}, JSON.stringify({ dotenvOnly: process.env.RUN_AND_NOTIFY_MAIN_DOTENV_ONLY ?? 'missing', preset: process.env.RUN_AND_NOTIFY_MAIN_DOTENV_PRESET ?? 'missing' }))`,
        ]),
      ).resolves.toBe(0);
      await expect(fs.readFile(markerPath, 'utf8')).resolves.toBe(
        JSON.stringify({ dotenvOnly: 'missing', preset: 'before' }),
      );
    } finally {
      process.chdir(cwd);
      delete env.RUN_AND_NOTIFY_MAIN_DOTENV_ONLY;
      delete env.RUN_AND_NOTIFY_MAIN_DOTENV_PRESET;
    }
  });
});
