import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { templateSource } from '../src/builtin-templates.js';
import { parseOutput } from '../src/output.js';
import {
  createHandlebars,
  formatShellCommand,
  formatShellToken,
  formatSlackCodeBlock,
  renderTemplateFile,
} from '../src/templates.js';
import type { ParsedOutput, RunAndNotifyConfig, TemplateContext } from '../src/types.js';

const config: RunAndNotifyConfig = {
  name: 'run-and-notify',
  locale: 'en-US',
  dryRun: false,
  propagateExitCode: true,
  timeoutSeconds: 0,
  showStderrIfSuccess: true,
  hideCommandIfSuccess: false,
  stdout: { format: 'raw' },
  stderr: { format: 'raw' },
  transports: {},
  success: {},
  error: {},
};

const makeContext = (templatesDir: string): TemplateContext => ({
  config: { ...config, templatesDir },
  stdout: parseOutput('raw <stdout>', { format: 'raw' }),
  stderr: parseOutput('{"timestamp":"2026-01-02T12:34:56Z","msg":"hello *world*"}', {
    format: 'jsonl',
  }),
  status: 0,
  command: ['node', 'script.mjs'],
  cwd: '/tmp/project',
  timedOut: false,
  executedAt: '2026-01-02T12:34:56Z',
  dryRun: false,
});

const makeBuiltinContext = (
  stdout: ParsedOutput,
  stderr: ParsedOutput = parseOutput('', {
    format: 'raw',
  }),
): TemplateContext => ({
  config,
  stdout,
  stderr,
  status: 0,
  command: ['node', 'script.mjs'],
  cwd: '/tmp/project',
  timedOut: false,
  executedAt: '2026-01-02T12:34:56Z',
  dryRun: false,
});

describe('template helpers', () => {
  it('loads built-in template files as a development fallback', () => {
    expect(templateSource('success.subject.hbs')).toBe('{{config.name}}\n');
  });

  it('renders date/time helpers, conversion helpers, escaping helpers, partials, and JSON helpers', async () => {
    const templatesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-and-notify-templates-'));
    await fs.writeFile(path.join(templatesDir, '_line.hbs'), 'partial: {{value}}', 'utf8');
    await fs.writeFile(path.join(templatesDir, 'ignored.txt'), 'ignored', 'utf8');
    await fs.writeFile(
      path.join(templatesDir, 'helpers.hbs'),
      [
        '{{dateFromISO8601 executedAt}}',
        '{{timeFromISO8601 executedAt}}',
        '{{datetimeFromISO8601 executedAt}}',
        '{{dateFromUnixEpoch 1767357296}}',
        '{{timeFromUnixEpoch 1767357296}}',
        '{{datetimeFromUnixEpoch 1767357296}}',
        '{{{markdownToHtml "**bold**"}}}',
        '{{htmlToMarkdown "<p>hello <strong>html</strong></p>"}}',
        '{{{rawToHtml stdout.raw}}}',
        '{{escapeHtml stdout.raw}}',
        '{{escapeMarkdown stderr.lines.[0].msg}}',
        '{{json stderr.lines.[0]}}',
        '{{jsonString stdout.raw}}',
        '{{{shellCommand command}}}',
        '{{{shellCommand spacedCommand}}}',
        '{{{shellToken spacedCwd}}}',
        '{{{slackCodeBlock stdout}}}',
        '{{concat "a" "b" "c"}}',
        '{{outputToSlack stdout}}',
        '{{outputToSlack missing}}',
        '{{hasOutput stdout}}',
        '{{hasOutput missing}}',
        '{{> line value="ok"}}',
      ].join('\n'),
      'utf8',
    );

    const handlebars = await createHandlebars(templatesDir);
    const context: TemplateContext & {
      spacedCommand: string[];
      spacedCwd: string;
    } = {
      ...makeContext(templatesDir),
      spacedCommand: ['node', 'script with spaces.mjs', "John's report"],
      spacedCwd: '/tmp/project with spaces',
    };
    const rendered = await renderTemplateFile(handlebars, templatesDir, 'helpers.hbs', context);

    expect(rendered).toContain('Jan 2, 2026');
    expect(rendered).toContain('<strong>bold</strong>');
    expect(rendered).toContain('hello **html**');
    expect(rendered).toContain('raw &lt;stdout&gt;');
    expect(rendered).toContain('hello \\*world\\*');
    expect(rendered).toContain('&quot;raw &lt;stdout&gt;&quot;');
    expect(rendered).toContain('node script.mjs');
    expect(rendered).toContain("node 'script with spaces.mjs' 'John'\\''s report'");
    expect(rendered).toContain("'/tmp/project with spaces'");
    expect(rendered).toContain('```\nraw <stdout>\n```');
    expect(rendered).toContain('abc');
    expect(rendered).toContain('partial: ok');
  });

  it('formats shell tokens and command lines with spaces as delimiters', () => {
    expect(formatShellToken('plain')).toBe('plain');
    expect(formatShellToken('/tmp/with spaces')).toBe("'/tmp/with spaces'");
    expect(formatShellCommand(['node', 'script with spaces.mjs', "John's report"])).toBe(
      "node 'script with spaces.mjs' 'John'\\''s report'",
    );
    expect(formatShellCommand('npm test')).toBe("'npm test'");
  });

  it('formats Slack code blocks from strings and parsed output objects', () => {
    expect(formatSlackCodeBlock('hello')).toBe('```\nhello\n```');
    expect(formatSlackCodeBlock(parseOutput('{"msg":"hello"}', { format: 'jsonl' }))).toBe(
      '```\n{"msg": "hello"}\n```',
    );
  });

  it('allows missing template directories, rejects path traversal, and rethrows other read errors', async () => {
    const handlebars = await createHandlebars('missing-template-directory');

    await expect(
      renderTemplateFile(handlebars, 'examples', '../config.example.json', makeContext('')),
    ).rejects.toThrow('resolves outside templatesDir');

    await expect(createHandlebars('package.json')).rejects.toThrow();
  });

  it('renders built-in templates when templatesDir is omitted or a custom file is missing', async () => {
    const customTemplatesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-and-notify-empty-'));
    const builtinHandlebars = await createHandlebars(undefined);
    const customHandlebars = await createHandlebars(customTemplatesDir);

    await expect(
      renderTemplateFile(builtinHandlebars, undefined, 'missing.hbs', makeContext('')),
    ).rejects.toThrow('Built-in template missing.hbs was not found');

    await expect(
      renderTemplateFile(
        customHandlebars,
        customTemplatesDir,
        'default.text.hbs',
        makeContext(customTemplatesDir),
      ),
    ).resolves.toContain('# Command succeeded');

    await expect(
      renderTemplateFile(customHandlebars, customTemplatesDir, 'missing.hbs', makeContext('')),
    ).rejects.toThrow();
  });

  it('renders default email raw output as escaped preformatted text', async () => {
    const handlebars = await createHandlebars(undefined);
    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.email.html.hbs',
      makeBuiltinContext(parseOutput('plain <tag>', { format: 'raw' })),
    );

    expect(rendered).toContain('<pre');
    expect(rendered).toContain('plain &lt;tag&gt;');
  });

  it('renders default email markdown output as HTML', async () => {
    const handlebars = await createHandlebars(undefined);
    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.email.html.hbs',
      makeBuiltinContext(parseOutput('# Report\n\n**done**', { format: 'markdown' })),
    );

    expect(rendered).toContain('<h1>Report</h1>');
    expect(rendered).toContain('<strong>done</strong>');
  });

  it('renders default email HTML output as provided HTML', async () => {
    const handlebars = await createHandlebars(undefined);
    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.email.html.hbs',
      makeBuiltinContext(
        parseOutput('<section><strong>done</strong></section>', { format: 'html' }),
      ),
    );

    expect(rendered).toContain('<section><strong>done</strong></section>');
  });

  it('renders default email JSONL output as item cards', async () => {
    const handlebars = await createHandlebars(undefined);
    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.email.html.hbs',
      makeBuiltinContext(
        parseOutput('{"title":"Report","items":["one","two"]}', { format: 'jsonl' }),
      ),
    );

    expect(rendered).toContain('<article');
    expect(rendered).toContain('<dt');
    expect(rendered).toContain('title');
    expect(rendered).toContain('[&quot;one&quot;,&quot;two&quot;]');
  });

  it('hides success command metadata, output headers, and separators when configured', async () => {
    const handlebars = await createHandlebars(undefined);
    const context = {
      ...makeBuiltinContext(parseOutput('plain output', { format: 'raw' })),
      config: { ...config, hideCommandIfSuccess: true },
    };

    const email = await renderTemplateFile(
      handlebars,
      undefined,
      'default.email.html.hbs',
      context,
    );
    const text = await renderTemplateFile(handlebars, undefined, 'default.text.hbs', context);
    const slack = await renderTemplateFile(
      handlebars,
      undefined,
      'default.slack.blocks.json.hbs',
      context,
    );
    const slackBlocks = JSON.parse(slack) as unknown[];
    const slackJson = JSON.stringify(slackBlocks);

    expect(email).toContain('plain output');
    expect(email).not.toContain('<header');
    expect(email).not.toContain('Command:');
    expect(email).not.toContain('Output</h2>');
    expect(text).toBe('plain output\n');
    expect(slackBlocks).not.toContainEqual({ type: 'divider' });
    expect(slackJson).toContain('plain output');
    expect(slackJson).not.toContain('Status');
    expect(slackJson).not.toContain('Command');
    expect(slackJson).not.toContain('Output');
  });

  it('keeps command metadata visible for failures even when success hiding is configured', async () => {
    const handlebars = await createHandlebars(undefined);
    const context = {
      ...makeBuiltinContext(parseOutput('plain output', { format: 'raw' })),
      config: { ...config, hideCommandIfSuccess: true },
      status: 1,
    };

    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.slack.blocks.json.hbs',
      context,
    );
    const blocks = JSON.parse(rendered) as unknown[];
    const renderedJson = JSON.stringify(blocks);

    expect(blocks).toContainEqual({ type: 'divider' });
    expect(renderedJson).toContain('Status');
    expect(renderedJson).toContain('Command');
    expect(renderedJson).toContain('Output');
  });

  it('renders success stderr without command metadata when both success hiding and stderr visibility are enabled', async () => {
    const handlebars = await createHandlebars(undefined);
    const context = {
      ...makeBuiltinContext(
        parseOutput('plain output', { format: 'raw' }),
        parseOutput('plain error', { format: 'raw' }),
      ),
      config: { ...config, hideCommandIfSuccess: true, showStderrIfSuccess: true },
    };

    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.slack.blocks.json.hbs',
      context,
    );
    const renderedJson = JSON.stringify(JSON.parse(rendered));

    expect(renderedJson).toContain('plain output');
    expect(renderedJson).toContain('Errors');
    expect(renderedJson).toContain('plain error');
    expect(renderedJson).not.toContain('Command');
  });

  it('renders default Slack raw output as a code block', async () => {
    const handlebars = await createHandlebars(undefined);
    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.slack.blocks.json.hbs',
      makeBuiltinContext(parseOutput('plain output', { format: 'raw' })),
    );
    const blocks = JSON.parse(rendered) as Array<{
      type: string;
      elements?: Array<{ type: string; elements?: Array<{ text?: string }> }>;
    }>;

    expect(blocks).toContainEqual({ type: 'divider' });
    expect(blocks.at(-1)).toMatchObject({
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_preformatted',
          elements: [{ text: 'plain output' }],
        },
      ],
    });
  });

  it('renders default Slack markdown output as markdown without a code block', async () => {
    const handlebars = await createHandlebars(undefined);
    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.slack.blocks.json.hbs',
      makeBuiltinContext(parseOutput('*done*', { format: 'markdown' })),
    );
    const blocks = JSON.parse(rendered) as Array<{ text?: { text?: string } }>;
    const renderedJson = JSON.stringify(blocks);

    expect(renderedJson).toContain('done');
    expect(renderedJson).not.toContain('rich_text_preformatted');
  });

  it('renders default Slack HTML output as markdown', async () => {
    const handlebars = await createHandlebars(undefined);
    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.slack.blocks.json.hbs',
      makeBuiltinContext(parseOutput('<p><strong>done</strong></p>', { format: 'html' })),
    );
    const blocks = JSON.parse(rendered) as Array<{ text?: { text?: string } }>;
    const renderedJson = JSON.stringify(blocks);

    expect(renderedJson).toContain('done');
    expect(renderedJson).not.toContain('<strong>');
  });

  it('converts empty HTML tables to empty markdown output', async () => {
    const templatesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-and-notify-templates-'));
    await fs.writeFile(
      path.join(templatesDir, 'empty-table.hbs'),
      '{{htmlToMarkdown html}}',
      'utf8',
    );
    const handlebars = await createHandlebars(templatesDir);

    await expect(
      renderTemplateFile(handlebars, templatesDir, 'empty-table.hbs', {
        ...makeContext(templatesDir),
        html: '<table></table>',
      } as TemplateContext & { html: string }),
    ).resolves.toBe('');
  });

  it('renders default Slack JSONL output as itemized markdown', async () => {
    const handlebars = await createHandlebars(undefined);
    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.slack.blocks.json.hbs',
      makeBuiltinContext(parseOutput('{"title":"Report","count":2}', { format: 'jsonl' })),
    );
    const blocks = JSON.parse(rendered) as Array<{
      type: string;
      elements?: Array<{ type: string; indent?: number; elements?: unknown[] }>;
    }>;
    const renderedJson = JSON.stringify(blocks);

    expect(renderedJson).toContain('rich_text_list');
    expect(renderedJson).toContain('title:');
    expect(renderedJson).toContain('Report');
    expect(renderedJson).toContain('count:');
    expect(renderedJson).not.toContain('rich_text_preformatted');
  });

  it('renders default Slack JSONL output with single-field and nested multi-field records', async () => {
    const handlebars = await createHandlebars(undefined);
    const rendered = await renderTemplateFile(
      handlebars,
      undefined,
      'default.slack.blocks.json.hbs',
      makeBuiltinContext(
        parseOutput(
          [
            '{"level":50,"timestamp":"2026-01-02T12:34:56Z","msg":"report failed"}',
            '{"raw":"not-json stderr fallback"}',
            '{"level":40,"timestamp":"2026-01-02T12:35:20Z","code":"DIGEST_RETRY"}',
            '{}',
          ].join('\n'),
          { format: 'jsonl' },
        ),
      ),
    );
    const blocks = JSON.parse(rendered) as Array<{
      type: string;
      elements?: Array<{ type: string; indent?: number; elements?: unknown[] }>;
    }>;
    const renderedJson = JSON.stringify(blocks);

    expect(renderedJson).toContain('msg:');
    expect(renderedJson).toContain('report failed');
    expect(renderedJson).toContain('not-json stderr fallback');
    expect(renderedJson).toContain('message:');
    expect(renderedJson).toContain('DIGEST_RETRY');
    expect(renderedJson).toContain('"indent":1');
  });
});
