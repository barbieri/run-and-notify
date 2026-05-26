import path from 'node:path';
import { mockTransport as mockEmailTransport } from '@betternotify/email';
import { mockSlackTransport } from '@betternotify/slack';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/command.js';
import { defaultsFromSchema, parseConfig, readConfigSchema } from '../src/config.js';
import { deliverNotifications } from '../src/delivery.js';
import type { TemplateContext } from '../src/types.js';

const runExample = async (configPath: string, appPath: string) => {
  const schema = readConfigSchema();
  const config = parseConfig(configPath, schema, defaultsFromSchema(schema));
  const result = await runCommand([process.execPath, path.resolve(appPath)], config, {
    env: { ...process.env },
  });
  const context: TemplateContext = {
    config,
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    command: result.command,
    cwd: result.cwd,
    timedOut: result.timedOut,
    executedAt: result.executedAt,
    dryRun: config.dryRun,
  };
  const email = mockEmailTransport();
  const slack = mockSlackTransport();

  await deliverNotifications(context, { emailSmtp: email, slack });

  return { result, email, slack };
};

describe('example workflow: full-raw', () => {
  it('formats raw stdout, stderr, cwd, command, status, and execution timestamp', async () => {
    const { result, email, slack } = await runExample(
      'examples/full-raw/config.json',
      'examples/apps/full-raw.mjs',
    );

    expect(result.stdout).toMatchObject({ format: 'raw', raw: expect.stringContaining('backup') });
    expect(email.sent[0]?.html).toContain('Raw command result');
    expect(email.sent[0]?.html).toContain('Executed:');
    expect(email.sent[0]?.html).toContain('Output');
    expect(email.sent[0]?.html).toContain('Errors');
    expect(email.sent[0]?.html).toContain('stderr line two &amp; details');
    expect(slack.messages[0]?.blocks?.[1]).toMatchObject({
      text: { type: 'mrkdwn', text: expect.stringContaining('```\nstderr line one') },
    });
    const outputBlock = slack.messages[0]?.blocks?.[1] as {
      text?: { text?: string };
    };
    expect(outputBlock.text?.text).toContain('*Output*\n');
    expect(outputBlock.text?.text).toContain('```\nbackup started');
    expect(outputBlock.text?.text).not.toContain(String.raw`*Output*\n`);
  });
});

describe('example workflow: minimal', () => {
  it('uses built-in templates when templatesDir and template config are omitted', async () => {
    const { email, slack } = await runExample(
      'examples/minimal/config.json',
      'examples/apps/full-raw.mjs',
    );

    expect(email.sent[0]?.subject).toBe('run-and-notify');
    expect(email.sent[0]?.html).toContain(
      '<h1 style="margin: 0; font-size: 22px;">run-and-notify</h1>',
    );
    expect(slack.messages[0]?.blocks).toContainEqual({ type: 'divider' });
    expect(JSON.stringify(slack.messages[0]?.blocks)).toContain('rich_text_preformatted');
  });
});

describe('example workflow: full-markdown', () => {
  it('formats markdown stdout and stderr with code blocks', async () => {
    const { email, slack } = await runExample(
      'examples/full-markdown/config.json',
      'examples/apps/full-markdown.mjs',
    );

    expect(email.sent[0]?.text).toContain('```markdown');
    expect(email.sent[0]?.text).toContain('# Backup report');
    expect(email.sent[0]?.text).toContain('## Output');
    expect(email.sent[0]?.text).toContain('## Errors');
    expect(slack.messages[0]?.blocks?.[0]).toMatchObject({
      text: { type: 'mrkdwn', text: expect.stringContaining('```\n# Backup report') },
    });
    const markdownBlock = slack.messages[0]?.blocks?.[0] as {
      text?: { text?: string };
    };
    expect(markdownBlock.text?.text).toContain('*Output*\n');
    expect(markdownBlock.text?.text).not.toContain(String.raw`*Output*\n`);
  });
});

describe('example workflow: full-html', () => {
  it('formats html stdout and stderr as email HTML and Slack markdown', async () => {
    const { email, slack } = await runExample(
      'examples/full-html/config.json',
      'examples/apps/full-html.mjs',
    );

    expect(email.sent[0]?.html).toContain('<h1>Backup report</h1>');
    expect(email.sent[0]?.text).toContain('Backup report');
    expect(slack.messages[0]?.blocks?.[0]).toMatchObject({
      text: { type: 'mrkdwn', text: expect.stringContaining('```\nBackup report') },
    });
  });
});

describe('example workflow: daily-digest-markdown', () => {
  it('success omits all metadata and stderr, sending only stdout markdown', async () => {
    const { email, slack } = await runExample(
      'examples/daily-digest-markdown/config.json',
      'examples/apps/daily-digest-success.mjs',
    );

    expect(email.sent[0]?.text).toContain('# Daily digest');
    expect(email.sent[0]?.text).toContain('| Job | Status |');
    expect(email.sent[0]?.text).not.toContain('Command:');
    expect(email.sent[0]?.text).not.toContain('success stderr should be omitted');
    expect(slack.messages[0]?.blocks?.[0]).toMatchObject({
      text: {
        type: 'mrkdwn',
        text: expect.stringContaining('# Daily digest'),
      },
    });
    expect(slack.messages[0]?.blocks?.[0]).toMatchObject({
      text: { text: expect.stringContaining('| Job | Status |') },
    });
  });

  it('failure formats pino stderr logs with localized datetimes and escaped markdown', async () => {
    const { result, email, slack } = await runExample(
      'examples/daily-digest-markdown/config.json',
      'examples/apps/daily-digest-failure.mjs',
    );

    expect(result.status).toBe(2);
    expect(email.sent[0]?.text).toContain('Daily digest failed');
    expect(email.sent[0]?.text).toContain('Jan 2, 2026');
    expect(email.sent[0]?.text).toContain('\\*input\\* contained <tags\\>');
    expect(slack.messages[0]?.blocks?.[0]).toMatchObject({
      text: { type: 'mrkdwn', text: expect.stringContaining('Daily digest failed') },
    });
    expect(slack.messages[0]?.blocks?.[1]).toMatchObject({
      text: { type: 'mrkdwn', text: expect.stringContaining('```\nJan 2, 2026') },
    });
  });
});

describe('example workflow: daily-digest-html', () => {
  it('success omits all metadata and stderr, sending only stdout HTML', async () => {
    const { email, slack } = await runExample(
      'examples/daily-digest-html/config.json',
      'examples/apps/daily-digest-html-success.mjs',
    );

    expect(email.sent[0]?.html).toContain('<h1>Daily digest</h1>');
    expect(email.sent[0]?.html).toContain('<table>');
    expect(email.sent[0]?.html).toContain('<pre><code>daily-report --send</code></pre>');
    expect(email.sent[0]?.html).not.toContain('success stderr should be omitted');
    expect(slack.messages[0]?.blocks?.[0]).toMatchObject({
      text: { type: 'mrkdwn', text: expect.stringContaining('```\nDaily digest') },
    });
  });

  it('failure formats pino stderr logs as escaped HTML', async () => {
    const { email } = await runExample(
      'examples/daily-digest-html/config.json',
      'examples/apps/daily-digest-failure.mjs',
    );

    expect(email.sent[0]?.html).toContain('report failed because *input* contained &lt;tags&gt;');
    expect(email.sent[0]?.html).toContain('not-json stderr fallback');
  });
});

describe('example workflow: structured-jsonl-markdown', () => {
  it('formats structured stdout jsonl into matching markdown sections', async () => {
    const { email, slack } = await runExample(
      'examples/structured-jsonl-markdown/config.json',
      'examples/apps/structured-jsonl-success.mjs',
    );

    expect(email.sent[0]?.text).toContain('# Structured report');
    expect(email.sent[0]?.text).toContain('| col-1-row-1 | col-2-row-1 |');
    expect(email.sent[0]?.text).toContain('some html');
    expect(email.sent[0]?.text).toContain('raw text escapes &lt;tags\\&gt;');
    expect(slack.messages[0]?.blocks?.[0]).toMatchObject({
      text: { type: 'mrkdwn', text: expect.stringContaining('```\nStructured report') },
    });
  });
});

describe('example workflow: structured-jsonl-html', () => {
  it('formats structured stdout jsonl into matching HTML sections', async () => {
    const { email, slack } = await runExample(
      'examples/structured-jsonl-html/config.json',
      'examples/apps/structured-jsonl-success.mjs',
    );

    expect(email.sent[0]?.html).toContain('<h1>Structured report</h1>');
    expect(email.sent[0]?.html).toContain('<td>col-1-row-1</td>');
    expect(email.sent[0]?.html).toContain('<strong>some markdown</strong>');
    expect(email.sent[0]?.html).toContain('raw text escapes &lt;tags&gt;');
    expect(slack.messages[0]?.blocks?.[0]).toMatchObject({
      text: { type: 'mrkdwn', text: expect.stringContaining('```\nStructured report') },
    });
  });
});
