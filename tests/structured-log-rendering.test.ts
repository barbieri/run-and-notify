import { describe, expect, it } from 'vitest';
import { parseOutput } from '../src/output.js';
import { createHandlebars, renderTemplateFile } from '../src/templates.js';
import type { OutputFormat, RunAndNotifyConfig, TemplateContext } from '../src/types.js';

const config: RunAndNotifyConfig = {
  name: 'structured logs',
  locale: 'en-US',
  dryRun: true,
  propagateExitCode: true,
  timeoutSeconds: 0,
  showStderrIfSuccess: false,
  hideCommandIfSuccess: false,
  stdout: { format: 'jsonl' },
  stderr: { format: 'jsonl' },
  transports: {},
  success: {},
  error: {},
};

const contextFor = (stderr: string, format: OutputFormat = 'jsonl'): TemplateContext => ({
  config,
  status: 7,
  command: ['node', 'failing.mjs'],
  cwd: '/tmp/project',
  timedOut: false,
  executedAt: '2026-01-02T12:34:56Z',
  dryRun: true,
  stdout: parseOutput('{"level":30,"message":"Report started"}', { format }),
  stderr: parseOutput(stderr, { format }),
});

const render = async (context: TemplateContext) => {
  const handlebars = await createHandlebars(undefined);
  const [html, text, blocks] = await Promise.all(
    ['default.email.html.hbs', 'default.text.hbs', 'default.slack.blocks.json.hbs'].map(
      (filename) => renderTemplateFile(handlebars, undefined, filename, context),
    ),
  );
  return { html: html ?? '', text: text ?? '', blocks: JSON.parse(blocks ?? '[]') as unknown };
};

const blockText = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map(blockText).join('\n');
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) =>
        key === 'text' && typeof entry === 'string' ? entry : blockText(entry),
      )
      .join('\n');
  }
  return '';
};

const failureLogs = [
  { level: 10, msg: 'Trace event' },
  { level: 'DEBUG', msg: 'Debug event' },
  { level: 30, time: 1767357296000, msg: 'Info event' },
  { level: 'WARN', timestamp: '2026-01-02T12:35:00Z', message: 'Retry request', attempt: 2 },
  {
    level: 50,
    time: 1767357320000,
    app: 'demo',
    module: 'fetch',
    name: 'worker',
    v: 1,
    pid: 0,
    hostname: 'host-1',
    msg: 'Request failed <unsafe>',
    err: {
      type: 'Error',
      message: 'bad <response>',
      stack: 'Error: bad <response>\n    at fetch (demo.mjs:12:3)\n    at main (demo.mjs:20:1)',
    },
    url: 'https://example.com',
  },
  { level: 'fatal', msg: 'Fatal event' },
  { title: 'Summary', count: 3, items: ['one', 'two'] },
]
  .map((line) => JSON.stringify(line))
  .concat('raw fallback <stderr>')
  .join('\n');

describe('built-in structured log rendering', () => {
  it.each(['jsonl', 'pino'] as const)(
    'renders failing %s logs with themed levels, message aliases, timestamps, and readable errors',
    async (format) => {
      const result = await render(contextFor(failureLogs, format));
      const slack = blockText(result.blocks);
      for (const token of ['text-muted', 'info', 'success', 'warning', 'error']) {
        expect(result.html).toContain(`border-left: 6px solid var(--${token})`);
      }
      expect(result.html).toContain('Request failed &lt;unsafe&gt;');
      expect(result.html).toContain('bad &lt;response&gt;');
      expect(result.html).not.toContain('<unsafe>');
      expect(result.html).toContain('white-space: pre-wrap');
      expect(result.html).toMatch(/\n +at fetch \(demo\.mjs:12:3\)/);
      expect(result.html).not.toContain('\\n    at fetch');
      expect(result.html).toContain('Jan 2, 2026');
      expect(result.html).toContain('raw fallback &lt;stderr&gt;');
      for (const output of [result.text, slack]) {
        expect(output).toMatch(/\berror:/i);
        expect(output).toMatch(/\bwarn:/i);
        expect(output).toContain('Retry request');
        expect(output).toContain('Report started');
        expect(output).toContain('bad <response>');
        expect(output).toContain('at fetch (demo.mjs:12:3)');
        expect(output).toContain('at main (demo.mjs:20:1)');
        expect(output).toContain('raw fallback <stderr>');
        expect(output).toContain('Jan 2, 2026');
        expect(output).toContain('worker');
        expect(output).toContain('host-1');
        expect(output).toContain('https://example.com');
        expect(output).not.toContain('[object Object]');
        expect(output).not.toContain('\\n    at fetch');
        expect(output).not.toContain('var(--');
        expect(output).not.toMatch(/#[\da-f]{6}\b/i);
      }
    },
  );

  it('keeps non-log JSONL records as key/value data alongside log cards', async () => {
    const result = await render(contextFor(failureLogs));
    expect(result.html).toContain('[&quot;one&quot;,&quot;two&quot;]');
    for (const output of [result.html, result.text, blockText(result.blocks)]) {
      expect(output).toContain('title');
      expect(output).toContain('Summary');
      expect(output).toContain('count');
      expect(output).toContain('3');
    }
  });

  it('retains single-field record keys and does not invent a message heading in Slack', async () => {
    const result = await render(contextFor('{"count":42}\n{"title":"Summary","total":3}\n{}'));
    const slack = blockText(result.blocks);
    expect(slack).toContain('count:');
    expect(slack).toContain('42');
    expect(slack).toContain('title:');
    expect(slack).toContain('Summary');
    expect(slack).toContain('total:');
    expect(slack).toContain('{}');
    expect(slack).not.toContain('message:');
  });

  it('renders raw-only failure stderr but omits an Errors section for empty JSONL stderr', async () => {
    const raw = await render(contextFor('not JSON <failed>'));
    const empty = await render(contextFor(''));
    expect(raw.html).toContain('Errors');
    expect(raw.html).toContain('not JSON &lt;failed&gt;');
    expect(raw.text).toContain('not JSON <failed>');
    expect(blockText(raw.blocks)).toContain('not JSON <failed>');
    expect(empty.html).not.toContain('Errors</h2>');
    expect(empty.text).not.toContain('## Errors');
    expect(blockText(empty.blocks)).not.toContain('Errors');
  });

  it('shows failure stderr regardless of success visibility and applies that option on success', async () => {
    const context = contextFor('{"level":"error","message":"stderr event"}');
    const hidden = await render({ ...context, status: 0 });
    const visible = await render({
      ...context,
      status: 0,
      config: { ...config, showStderrIfSuccess: true },
    });
    const failed = await render(context);
    for (const output of [hidden.html, hidden.text, blockText(hidden.blocks)]) {
      expect(output).toContain('Report started');
      expect(output).not.toContain('stderr event');
    }
    for (const result of [visible, failed]) {
      for (const output of [result.html, result.text, blockText(result.blocks)]) {
        expect(output).toContain('stderr event');
        expect(output).toContain('Errors');
      }
    }
  });

  it('keeps malformed timestamps and message-only or timestamp-only log records visible', async () => {
    const result = await render(
      contextFor(
        [
          { level: 'error', time: 'not-a-date', message: 'Bad timestamp' },
          { timestamp: '2026-01-02T12:34:56Z', module: 'clock' },
          { msg: 'Message without level' },
          { level: '40', message: 'Numeric string level' },
          { level: 'warning', message: 'Warning alias' },
        ]
          .map((line) => JSON.stringify(line))
          .join('\n'),
      ),
    );
    for (const output of [result.html, result.text, blockText(result.blocks)]) {
      expect(output).toContain('Bad timestamp');
      expect(output).toContain('not-a-date');
      expect(output).toContain('Jan 2, 2026');
      expect(output).toContain('clock');
      expect(output).toContain('Message without level');
      expect(output).toContain('Numeric string level');
      expect(output).toContain('Warning alias');
    }
  });

  it('retains secondary fields, zero timestamps, non-string messages, and nested error causes', async () => {
    const result = await render(
      contextFor(
        JSON.stringify({
          level: 35,
          time: 0,
          timestamp: 'secondary timestamp',
          msg: 42,
          message: 'secondary message',
          raw: 'secondary raw field',
          name: 'worker',
          v: 0,
          err: { cause: { stack: 'Nested failure\n    at cause (cause.js:1:2)' } },
        }),
      ),
    );
    for (const output of [result.html, result.text, blockText(result.blocks)]) {
      expect(output).toMatch(/level 35/i);
      expect(output).toContain('42');
      expect(output).toMatch(/1969|1970/);
      expect(output).toContain('secondary timestamp');
      expect(output).toContain('secondary message');
      expect(output).toContain('secondary raw field');
      expect(output).toContain('Nested failure');
      expect(output).toContain('at cause (cause.js:1:2)');
    }
  });

  it('preserves unusual timestamp values, empty errors, and multiline raw records', async () => {
    const result = await render(
      contextFor(
        [
          { level: 'error', msg: 'Empty error object', err: {} },
          { time: { reason: 'not a timestamp' }, message: 'Object timestamp' },
          { time: '1767357296000', msg: 'Numeric string timestamp' },
          { timestamp: '  ', msg: 'Blank timestamp' },
          { raw: 'First raw line\nSecond raw line' },
        ]
          .map((line) => JSON.stringify(line))
          .join('\n'),
      ),
    );
    for (const output of [result.html, result.text, blockText(result.blocks)]) {
      expect(output).toContain('Empty error object');
      expect(output).toContain('{}');
      expect(output).toContain('not a timestamp');
      expect(output).toContain('Numeric string timestamp');
      expect(output).toContain('Jan 2, 2026');
      expect(output).toContain('Blank timestamp');
      expect(output).toContain('First raw line');
      expect(output).toContain('Second raw line');
    }
    expect(result.html).toContain('&quot;  &quot;');
    expect(result.text).toContain('"  "');
    expect(blockText(result.blocks)).toContain('"  "');
  });

  it('exposes structured views to custom templates without changing parsed records', async () => {
    const handlebars = await createHandlebars(undefined);
    const template = handlebars.compile(
      '{{#each (structuredLines output)}}{{message}}{{else}}no structured records{{/each}}',
    );
    expect(template({ output: parseOutput('plain output', { format: 'raw' }), config })).toBe(
      'no structured records',
    );
    const output = parseOutput('{"level":50,"msg":"Custom view"}', { format: 'jsonl' });
    expect(template({ output, config })).toBe('Custom view');
    expect(output).toEqual({ format: 'jsonl', lines: [{ level: 50, msg: 'Custom view' }] });
  });

  it('keeps embedded fences literal without hiding the following Slack log record', async () => {
    const result = await render(
      contextFor(
        [
          {
            level: 50,
            msg: 'Failure with Markdown in the stack',
            err: {
              stack: 'Error: payload\n```\n[CRITICAL ERROR]: https://example.com\n````\n@everyone',
            },
          },
          { level: 60, msg: 'NEXT RECORD' },
        ]
          .map((line) => JSON.stringify(line))
          .join('\n'),
      ),
    );
    const slack = blockText(result.blocks);
    const codeBlocks = (
      result.blocks as Array<{ elements?: Array<{ type: string; elements?: unknown[] }> }>
    )
      .flatMap((block) => block.elements ?? [])
      .filter((element) => element.type === 'rich_text_preformatted');
    expect(slack).toContain('[CRITICAL ERROR]: https://example.com');
    expect(slack).toContain('@everyone');
    expect(slack).toContain('FATAL:');
    expect(slack).toContain('NEXT RECORD');
    expect(blockText(codeBlocks)).toContain('[CRITICAL ERROR]: https://example.com');
    expect(blockText(codeBlocks)).not.toContain('NEXT RECORD');
    expect(JSON.stringify(result.blocks)).not.toContain('<!everyone>');
  });

  it('uses the warning theme color for the conventional warning level alias', async () => {
    const result = await render(contextFor('{"level":"warning","message":"Retry warning"}'));
    expect(result.html).toContain('border-left: 6px solid var(--warning)');
    expect(result.text).toContain('warn: Retry warning');
    expect(blockText(result.blocks)).toContain('WARN:');
  });
});
