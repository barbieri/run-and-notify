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

  it('parses pino output as log records and wraps invalid lines', () => {
    expect(
      parseOutput(
        [
          '{"level":50,"time":1767357296000,"pid":123,"hostname":"worker-1","reqId":"abc","msg":"failed <job>"}',
          'not json',
        ].join('\n'),
        { format: 'pino' },
      ),
    ).toEqual({
      format: 'pino',
      lines: [
        {
          level: 50,
          time: 1767357296000,
          pid: 123,
          hostname: 'worker-1',
          reqId: 'abc',
          msg: 'failed <job>',
        },
        {
          raw: 'not json',
        },
      ],
    });
  });

  it('keeps pino string levels, unknown levels, message fields, and non-object JSON', () => {
    const parsed = parseOutput(
      [
        '{"level":"debug","msg":"debugging","traceId":"trace-1"}',
        '{"level":35,"message":"custom level"}',
        '{"msg":"missing level"}',
        '{"level":30}',
        '42',
      ].join('\n'),
      { format: 'pino' },
    );

    expect(parsed).toMatchObject({
      format: 'pino',
      lines: [
        {
          level: 'debug',
          msg: 'debugging',
          traceId: 'trace-1',
        },
        {
          level: 35,
          message: 'custom level',
        },
        {
          msg: 'missing level',
        },
        {
          level: 30,
        },
        {
          raw: '42',
        },
      ],
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
