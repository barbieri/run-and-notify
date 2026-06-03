import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/command.js';
import { createDeliveryPayloads } from '../src/delivery.js';
import type { OutputFormat, RunAndNotifyConfig, TemplateContext } from '../src/types.js';

const makeConfig = (format: OutputFormat): RunAndNotifyConfig => ({
  name: 'run-and-notify',
  locale: 'en-US',
  dryRun: false,
  propagateExitCode: true,
  timeoutSeconds: 0,
  showStderrIfSuccess: true,
  hideCommandIfSuccess: false,
  stdout: { format },
  stderr: { format },
  transports: {
    smtp: {
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      from: 'bot@example.com',
      to: ['ops@example.com'],
    },
    slack: {
      enabled: true,
      tokenEnvVar: 'SLACK_BOT_TOKEN',
      thread: false,
    },
  },
  success: {
    email: {
      subject: 'success.subject.hbs',
      html: 'default.email.html.hbs',
      text: 'default.text.hbs',
    },
    slack: {
      blocks: 'default.slack.blocks.json.hbs',
    },
  },
  error: {
    email: {
      subject: 'error.subject.hbs',
      html: 'default.email.html.hbs',
    },
    slack: {
      blocks: 'default.slack.blocks.json.hbs',
    },
  },
});

describe('sample output formats', () => {
  it.each([
    ['jsonl', 'output-jsonl.mjs'],
    ['markdown', 'output-markdown.mjs'],
    ['html', 'output-html.mjs'],
    ['raw', 'output-raw.mjs'],
  ] as const)('runs %s sample script and renders notifications', async (format, fixture) => {
    const config = makeConfig(format);
    const result = await runCommand(
      [process.execPath, path.resolve('tests/fixtures', fixture)],
      config,
      { env: { ...process.env } },
    );
    const context: TemplateContext = {
      config,
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
      command: result.command,
      cwd: result.cwd,
      timedOut: result.timedOut,
      executedAt: result.executedAt,
      dryRun: false,
    };

    const payloads = await createDeliveryPayloads(context);

    expect(result.stdout.format).toBe(format);
    expect(payloads).toHaveLength(2);
    expect(JSON.stringify(payloads)).toContain('Output');
    if (format === 'raw') {
      expect(JSON.stringify(payloads)).toContain('rich_text_preformatted');
    }
    expect(JSON.stringify(payloads)).not.toContain('*stdout*\\n');
  });
});
