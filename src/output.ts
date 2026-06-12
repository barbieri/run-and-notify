import { htmlFormatter } from './formatters/html.js';
import { jsonlFormatter } from './formatters/jsonl.js';
import { markdownFormatter } from './formatters/markdown.js';
import { pinoFormatter } from './formatters/pino.js';
import { rawFormatter } from './formatters/raw.js';
import type { OutputFormatter } from './formatters/types.js';
import type { OutputConfig, OutputFormat, ParsedOutput } from './types.js';

const formatters: Record<OutputFormat, OutputFormatter> = {
  html: htmlFormatter,
  jsonl: jsonlFormatter,
  markdown: markdownFormatter,
  pino: pinoFormatter,
  raw: rawFormatter,
};

export const parseOutput = (value: string, config: OutputConfig): ParsedOutput =>
  formatters[config.format](value, config);

export const outputToText = (output: ParsedOutput): string => {
  switch (output.format) {
    case 'raw':
      return output.raw;
    case 'markdown':
      return output.markdown;
    case 'html':
      return output.html;
    case 'jsonl':
      return output.lines.map((line) => JSON.stringify(line).replace(/([,:])/g, '$1 ')).join('\n');
    case 'pino':
      return output.lines.map((line) => JSON.stringify(line).replace(/([,:])/g, '$1 ')).join('\n');
  }
};
