import { describe, expect, it } from 'vitest';
import { parseOutput } from '../src/output.js';

describe('parseOutput', () => {
  it('parses jsonl and wraps invalid lines', () => {
    expect(parseOutput('{"ok":true}\ninvalid\n42\n', { format: 'jsonl' })).toEqual({
      format: 'jsonl',
      lines: [{ ok: true }, { raw: 'invalid' }, { value: 42 }],
    });
  });

  it('parses empty jsonl output as an empty lines array', () => {
    expect(parseOutput('', { format: 'jsonl' })).toEqual({
      format: 'jsonl',
      lines: [],
    });
  });

  it('keeps raw output as a complete string', () => {
    expect(parseOutput('a\nb\n', { format: 'raw' })).toEqual({
      format: 'raw',
      raw: 'a\nb',
    });
  });

  it('keeps markdown output as a complete string', () => {
    expect(parseOutput('# title\n\nbody', { format: 'markdown' })).toEqual({
      format: 'markdown',
      markdown: '# title\n\nbody',
    });
  });

  it('keeps html output as a complete string', () => {
    expect(parseOutput('<h1>title</h1>', { format: 'html' })).toEqual({
      format: 'html',
      html: '<h1>title</h1>',
    });
  });
});
