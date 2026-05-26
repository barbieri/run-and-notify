import { splitLines } from './split-lines.js';
import type { OutputFormatter } from './types.js';

export const jsonlFormatter: OutputFormatter = (value) => ({
  format: 'jsonl',
  lines: splitLines(value).map((line) => {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      return { raw: line };
    }
  }),
});
