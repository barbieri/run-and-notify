import type { PinoLogLine } from '../types.js';
import { splitLines } from './split-lines.js';
import type { OutputFormatter } from './types.js';

const formatRawLine = (line: string): PinoLogLine => ({
  raw: line,
});

const parsePinoLine = (line: string): PinoLogLine => {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return formatRawLine(line);
    }

    return parsed as PinoLogLine;
  } catch {
    return formatRawLine(line);
  }
};

export const pinoFormatter: OutputFormatter = (value) => ({
  format: 'pino',
  lines: splitLines(value).map(parsePinoLine),
});
