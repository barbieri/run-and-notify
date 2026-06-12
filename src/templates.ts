import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars, { type HelperOptions } from 'handlebars';
import { markdownToBlocks } from 'markdown-to-slack-blocks';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { builtinTemplates } from './builtin-templates.js';
import { outputToText } from './output.js';
import type { ParsedOutput, TemplateContext } from './types.js';

const turndown = new TurndownService({ codeBlockStyle: 'fenced' });

turndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    const table = node as {
      querySelectorAll(selector: string): Iterable<{
        querySelectorAll(selector: string): Iterable<{ textContent: string }>;
      }>;
    };
    const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
      Array.from(row.querySelectorAll('th,td')).map((cell) =>
        cell.textContent.replace(/\s+/g, ' ').trim(),
      ),
    );
    const [header, ...body] = rows;
    if (header === undefined) {
      return '';
    }

    const separator = header.map(() => '---');
    return `\n\n${[header, separator, ...body]
      .map((row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`)
      .join('\n')}\n\n`;
  },
});

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeMarkdown = (value: string): string =>
  value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1');

const asString = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

export const formatShellToken = (value: unknown): string => {
  const token = asString(value);
  if (!/\s/.test(token)) {
    return token;
  }
  return `'${token.replace(/'/g, "'\\''")}'`;
};

export const formatShellCommand = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map(formatShellToken).join(' ');
  }
  return formatShellToken(value);
};

export const formatSlackCodeBlock = (value: unknown): string => {
  const content =
    value !== null && typeof value === 'object' && 'format' in value
      ? outputToText(value as Parameters<typeof outputToText>[0])
      : asString(value);

  return `\`\`\`\n${content}\n\`\`\``;
};

const formatJsonValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
};

const formatJsonlLineForMarkdown = (line: Record<string, unknown>): string => {
  const entries = Object.entries(line);
  if (entries.length === 0) {
    return '- message:';
  }
  if (entries.length === 1) {
    return `- ${escapeMarkdown(formatJsonValue(entries[0]?.[1]))}`;
  }

  const messageEntry = entries.find(([key]) => key === 'msg' || key === 'message');
  const primaryEntry: [string, unknown] = messageEntry ?? ['message', ''];
  const childEntries =
    messageEntry === undefined ? entries : entries.filter(([key]) => key !== primaryEntry[0]);

  return [
    `- **${escapeMarkdown(primaryEntry[0])}:** ${escapeMarkdown(formatJsonValue(primaryEntry[1]))}`,
    ...childEntries.map(
      ([key, value]) => `  - **${escapeMarkdown(key)}:** ${escapeMarkdown(formatJsonValue(value))}`,
    ),
  ].join('\n');
};

const formatDate = (value: Date, locale: string, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(locale, options).format(value);

const formatUnixEpochMilliseconds = (value: unknown, locale: string): string =>
  formatDate(new Date(Number(value)), locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const pinoLevelNames: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

const pinoLevelColors: Record<string, string> = {
  trace: '#64748b',
  debug: '#2563eb',
  info: '#16a34a',
  warn: '#ca8a04',
  error: '#dc2626',
  fatal: '#9333ea',
};

const pinoCoreFields = new Set([
  'level',
  'time',
  'timestamp',
  'pid',
  'hostname',
  'name',
  'msg',
  'v',
]);

type PinoTemplateLine = Record<string, unknown> & {
  msg?: unknown;
  raw?: unknown;
  time?: unknown;
  timestamp?: unknown;
};

const formatPinoLevelLabel = (level: unknown): string => {
  if (typeof level === 'number') {
    return pinoLevelNames[level] ?? `level ${level}`;
  }
  if (typeof level === 'string' && level.length > 0) {
    return level.toLowerCase();
  }
  return 'info';
};

const formatPinoLevelColor = (level: unknown): string =>
  pinoLevelColors[formatPinoLevelLabel(level)] ?? '#64748b';

const formatPinoMessage = (line: PinoTemplateLine): string => {
  if (typeof line.msg === 'string') {
    return line.msg;
  }
  if (typeof line.raw === 'string') {
    return line.raw;
  }
  return '';
};

const pinoTimeValue = (line: PinoTemplateLine): unknown => line.time ?? line.timestamp;

const pinoExtraFields = (line: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(line).filter(([key]) => !pinoCoreFields.has(key)));

const formatPinoLineForMarkdown = (
  line: ParsedOutput & { format: 'pino' },
  locale: string,
): string =>
  line.lines
    .map((pinoLine) => {
      const time = pinoTimeValue(pinoLine);
      const heading = [
        `- **${escapeMarkdown(formatPinoLevelLabel(pinoLine.level).toUpperCase())}:** ${escapeMarkdown(formatPinoMessage(pinoLine))}`,
      ];
      if (time !== undefined) {
        heading.push(`  - **time:** ${escapeMarkdown(formatUnixEpochMilliseconds(time, locale))}`);
      }
      if (pinoLine.pid !== undefined) {
        heading.push(`  - **pid:** ${escapeMarkdown(formatJsonValue(pinoLine.pid))}`);
      }
      if (pinoLine.hostname !== undefined) {
        heading.push(`  - **hostname:** ${escapeMarkdown(formatJsonValue(pinoLine.hostname))}`);
      }
      const fieldEntries = Object.entries(pinoExtraFields(pinoLine));
      if (fieldEntries.length > 0) {
        heading.push(
          '  - **fields:**',
          ...fieldEntries.map(
            ([key, value]) =>
              `    - **${escapeMarkdown(key)}:** ${escapeMarkdown(formatJsonValue(value))}`,
          ),
        );
      }
      return heading.join('\n');
    })
    .join('\n');

const outputToSlackMarkdown = (output: ParsedOutput, locale = 'en-US'): string => {
  if (output.format === 'raw') {
    return formatSlackCodeBlock(output.raw);
  }
  if (output.format === 'markdown') {
    return output.markdown;
  }
  if (output.format === 'html') {
    return turndown.turndown(output.html);
  }
  if (output.format === 'pino') {
    return formatPinoLineForMarkdown(output, locale);
  }

  return output.lines.map(formatJsonlLineForMarkdown).join('\n');
};

const shouldHideCommandOnSuccess = (context: TemplateContext): boolean =>
  context.status === 0 && context.config.hideCommandIfSuccess;

const buildDefaultSlackMarkdown = (context: TemplateContext): string => {
  const hideCommand = shouldHideCommandOnSuccess(context);
  if (hideCommand) {
    const sections = [outputToSlackMarkdown(context.stdout, context.config.locale)];
    if (outputToText(context.stderr).length > 0 && context.config.showStderrIfSuccess) {
      sections.push('**Errors**', outputToSlackMarkdown(context.stderr, context.config.locale));
    }
    return sections.join('\n\n');
  }

  const title = context.status === 0 ? context.config.name : `Failed: ${context.config.name}`;
  const sections = [
    `**${escapeMarkdown(title)}**`,
    `**Status:** ${context.status}`,
    `**Command:** \`${formatShellCommand(context.command)}\``,
    `**CWD:** \`${formatShellToken(context.cwd)}\``,
    '---',
    '**Output**',
    outputToSlackMarkdown(context.stdout, context.config.locale),
  ];

  if (
    outputToText(context.stderr).length > 0 &&
    (context.status !== 0 || context.config.showStderrIfSuccess)
  ) {
    sections.push('**Errors**', outputToSlackMarkdown(context.stderr, context.config.locale));
  }

  return sections.join('\n\n');
};

const buildDefaultSlackBlocks = (context: TemplateContext): unknown[] =>
  markdownToBlocks(buildDefaultSlackMarkdown(context));

const getLocale = (self: unknown, options: HelperOptions): string => {
  if (self !== null && typeof self === 'object' && 'config' in self) {
    const context = self as TemplateContext;
    return context.config.locale;
  }

  /* v8 ignore next -- @preserve */
  return options.data?.root?.config.locale ?? 'en-US';
};

const registerPartial = (instance: typeof Handlebars, filename: string, source: string): void => {
  const partialName = filename.replace(/\.hbs$/, '');
  instance.registerPartial(partialName, source);
  if (partialName.startsWith('_')) {
    instance.registerPartial(partialName.slice(1), source);
  }
};

export const createHandlebars = async (
  templatesDir: string | undefined,
): Promise<typeof Handlebars> => {
  const instance = Handlebars.create();
  for (const [filename, source] of Object.entries(builtinTemplates)) {
    registerPartial(instance, filename, source);
  }

  if (templatesDir === undefined) {
    return registerHelpers(instance);
  }

  const entries = await fs
    .readdir(templatesDir, { withFileTypes: true })
    .catch((error: unknown) => {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return [];
      }
      throw error;
    });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.hbs')) {
      continue;
    }

    const filePath = path.join(templatesDir, entry.name);
    const source = await fs.readFile(filePath, 'utf8');
    registerPartial(instance, entry.name, source);
  }

  return registerHelpers(instance);
};

const registerHelpers = (instance: typeof Handlebars): typeof Handlebars => {
  instance.registerHelper('dateFromISO8601', function (this: unknown, value: unknown, options) {
    return formatDate(new Date(asString(value)), getLocale(this, options), { dateStyle: 'medium' });
  });
  instance.registerHelper('timeFromISO8601', function (this: unknown, value: unknown, options) {
    return formatDate(new Date(asString(value)), getLocale(this, options), { timeStyle: 'medium' });
  });
  instance.registerHelper('datetimeFromISO8601', function (this: unknown, value: unknown, options) {
    return formatDate(new Date(asString(value)), getLocale(this, options), {
      dateStyle: 'medium',
      timeStyle: 'medium',
    });
  });
  instance.registerHelper('dateFromUnixEpoch', function (this: unknown, value: unknown, options) {
    return formatDate(new Date(Number(value) * 1000), getLocale(this, options), {
      dateStyle: 'medium',
    });
  });
  instance.registerHelper('timeFromUnixEpoch', function (this: unknown, value: unknown, options) {
    return formatDate(new Date(Number(value) * 1000), getLocale(this, options), {
      timeStyle: 'medium',
    });
  });
  instance.registerHelper(
    'datetimeFromUnixEpoch',
    function (this: unknown, value: unknown, options) {
      return formatDate(new Date(Number(value) * 1000), getLocale(this, options), {
        dateStyle: 'medium',
        timeStyle: 'medium',
      });
    },
  );
  instance.registerHelper(
    'datetimeFromUnixEpochMilliseconds',
    function (this: unknown, value: unknown, options) {
      return formatUnixEpochMilliseconds(value, getLocale(this, options));
    },
  );
  instance.registerHelper('markdownToHtml', (value: unknown) =>
    marked.parse(asString(value), { async: false }),
  );
  instance.registerHelper('htmlToMarkdown', (value: unknown) => turndown.turndown(asString(value)));
  instance.registerHelper('rawToHtml', (value: unknown) =>
    escapeHtml(asString(value)).replace(/\n/g, '<br>\n'),
  );
  instance.registerHelper('escapeHtml', (value: unknown) => escapeHtml(asString(value)));
  instance.registerHelper('escapeMarkdown', (value: unknown) => escapeMarkdown(asString(value)));
  instance.registerHelper('json', (value: unknown) =>
    JSON.stringify(value).replace(/([,:])/g, '$1 '),
  );
  instance.registerHelper('jsonValue', (value: unknown) => formatJsonValue(value));
  instance.registerHelper('jsonString', (value: unknown) => JSON.stringify(asString(value)));
  instance.registerHelper('pinoLevelColor', (value: unknown) => formatPinoLevelColor(value));
  instance.registerHelper('pinoLevelLabel', (value: unknown) => formatPinoLevelLabel(value));
  instance.registerHelper('pinoMessage', (value: unknown) =>
    value !== null && typeof value === 'object' ? formatPinoMessage(value as PinoTemplateLine) : '',
  );
  instance.registerHelper('pinoTime', (value: unknown) =>
    value !== null && typeof value === 'object'
      ? pinoTimeValue(value as PinoTemplateLine)
      : undefined,
  );
  instance.registerHelper('pinoFields', (value: unknown) =>
    value !== null && typeof value === 'object'
      ? pinoExtraFields(value as Record<string, unknown>)
      : {},
  );
  instance.registerHelper('shellToken', (value: unknown) => formatShellToken(value));
  instance.registerHelper('shellCommand', (value: unknown) => formatShellCommand(value));
  instance.registerHelper('slackCodeBlock', (value: unknown) => formatSlackCodeBlock(value));
  instance.registerHelper('nl', () => '\n');
  instance.registerHelper('concat', (...args: unknown[]) =>
    args.slice(0, -1).map(asString).join(''),
  );
  instance.registerHelper('eq', (left: unknown, right: unknown) => left === right);
  instance.registerHelper('outputToSlack', (value: unknown) => {
    if (value !== null && typeof value === 'object' && 'format' in value) {
      return outputToSlackMarkdown(value as ParsedOutput);
    }
    return asString(value);
  });
  instance.registerHelper('defaultSlackBlocks', function (this: TemplateContext) {
    return JSON.stringify(buildDefaultSlackBlocks(this));
  });
  instance.registerHelper('hideCommandIfSuccess', function (this: TemplateContext) {
    return shouldHideCommandOnSuccess(this);
  });
  instance.registerHelper('hasOutput', (value: unknown) => {
    if (value !== null && typeof value === 'object' && 'format' in value) {
      return outputToText(value as Parameters<typeof outputToText>[0]).length > 0;
    }
    return asString(value).length > 0;
  });

  return instance;
};

const readTemplateSource = async (
  templatesDir: string | undefined,
  filename: string,
): Promise<string> => {
  if (templatesDir === undefined) {
    const builtin = builtinTemplates[filename];
    if (builtin === undefined) {
      throw new Error(`Built-in template ${filename} was not found`);
    }
    return builtin;
  }

  const filePath = path.resolve(templatesDir, filename);
  const root = path.resolve(templatesDir);
  if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
    throw new Error(`Template ${filename} resolves outside templatesDir`);
  }

  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    /* v8 ignore next -- @preserve */
    if (nodeError.code === 'ENOENT') {
      const builtin = builtinTemplates[filename];
      if (builtin !== undefined) {
        return builtin;
      }
    }
    throw error;
  }
};

export const renderTemplateFile = async (
  handlebars: typeof Handlebars,
  templatesDir: string | undefined,
  filename: string,
  context: TemplateContext,
): Promise<string> => {
  const source = await readTemplateSource(templatesDir, filename);
  return handlebars.compile(source)(context);
};
