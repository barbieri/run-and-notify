import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { defaultsFromSchema, parseCli, parseConfig, readConfigSchema } from '../src/config.js';

const schema = readConfigSchema();
type ParsedCli = Extract<Awaited<ReturnType<typeof parseCli>>, { kind: 'parsed' }>;

function expectParsed(parsed: Awaited<ReturnType<typeof parseCli>>): asserts parsed is ParsedCli {
  expect(parsed.kind).toBe('parsed');
  if (parsed.kind !== 'parsed') {
    throw new Error('config should be defined');
  }
}

const captureConsoleError = async <T>(
  callback: () => Promise<T>,
): Promise<{ result: T; errors: string[] }> => {
  const errors: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  try {
    return { result: await callback(), errors };
  } finally {
    spy.mockRestore();
  }
};

describe('config', () => {
  it('validates config.example.json against the schema', () => {
    const config = parseConfig('config.example.json', schema, defaultsFromSchema(schema));
    expect(config.name).toBe('run-and-notify');
    expect(config.locale).toBe('en-US');
    expect(config.transports.smtp?.auth?.passEnvVar).toBe('SMTP_PASS');
  });

  it.each([
    'examples/full-raw/config.json',
    'examples/full-markdown/config.json',
    'examples/full-html/config.json',
    'examples/daily-digest-markdown/config.json',
    'examples/daily-digest-html/config.json',
    'examples/structured-jsonl-markdown/config.json',
    'examples/structured-jsonl-html/config.json',
    'examples/minimal/config.json',
  ])('validates example configuration %s against the schema', (configFile) => {
    expect(parseConfig(configFile, schema, defaultsFromSchema(schema)).stdout.format).toBeDefined();
  });

  it('builds dotted CLI overrides from the schema', async () => {
    const parsed = await parseCli([
      '--config=config.example.json',
      '--stdout.format=jsonl',
      '--hide-command-if-success',
      '--success.email.html=custom-success.html.hbs',
      '--transports.smtp.enabled=false',
      '--',
      'node',
      '-v',
    ]);

    expectParsed(parsed);
    expect(parsed.config.stdout.format).toBe('jsonl');
    expect(parsed.config.hideCommandIfSuccess).toBe(true);
    expect(parsed.config.success.email?.html).toBe('custom-success.html.hbs');
    expect(parsed.config.transports.smtp?.enabled).toBe(false);
    expect(parsed.command).toEqual(['node', '-v']);
  });

  it('uses positional arguments as the command when -- is omitted', async () => {
    const parsed = await parseCli(['--config=config.example.json', 'node']);

    expectParsed(parsed);
    expect(parsed.command).toEqual(['node']);
  });

  it('uses the yargs config alias before the command', async () => {
    const parsed = await parseCli(['-c', 'config.example.json', 'node']);

    expectParsed(parsed);
    expect(parsed.config.locale).toBe('en-US');
    expect(parsed.command).toEqual(['node']);
  });

  it('uses default config lookup and enables dry-run from CLI flag', async () => {
    const cwd = process.cwd();
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-and-notify-cli-'));
    try {
      process.chdir(emptyDir);
      const parsed = await parseCli(['--dry-run', 'node']);

      expectParsed(parsed);
      expect(parsed.config.dryRun).toBe(true);
      expect(parsed.command).toEqual(['node']);
    } finally {
      process.chdir(cwd);
    }
  });

  it('accepts the kebab-case CLI switch for disabling exit-code propagation', async () => {
    const parsed = await parseCli([
      '--config=config.example.json',
      '--no-propagate-exit-code',
      '--',
      'node',
      '-v',
    ]);

    expectParsed(parsed);
    expect(parsed.config.propagateExitCode).toBe(false);
  });

  it('accepts the schema-generated CLI override for exit-code propagation', async () => {
    const parsed = await parseCli([
      '--config=config.example.json',
      '--propagateExitCode=false',
      '--',
      'node',
      '-v',
    ]);

    expectParsed(parsed);
    expect(parsed.config.propagateExitCode).toBe(false);
  });

  it('accepts array overrides generated from the schema', async () => {
    const parsed = await parseCli([
      '--config=config.example.json',
      '--transports.smtp.to=one@example.com',
      '--transports.smtp.to=two@example.com',
      '--',
      'node',
      '-v',
    ]);

    expectParsed(parsed);
    expect(parsed.config.transports.smtp?.to).toEqual(['one@example.com', 'two@example.com']);
  });

  it('normalizes single string overrides for to, cc, and bcc to arrays', async () => {
    const parsed = await parseCli([
      '--config=config.example.json',
      '--transports.smtp.to=single@example.com',
      '--transports.smtp.cc=cc-single@example.com',
      '--transports.smtp.bcc=bcc-single@example.com',
      '--',
      'node',
      '-v',
    ]);

    expectParsed(parsed);
    expect(parsed.config.transports.smtp?.to).toEqual(['single@example.com']);
    expect(parsed.config.transports.smtp?.cc).toEqual(['cc-single@example.com']);
    expect(parsed.config.transports.smtp?.bcc).toEqual(['bcc-single@example.com']);
  });

  it('normalizes string to, cc, and bcc from config files to arrays of strings', () => {
    const configPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'run-and-notify-smtp-recipients-')),
      'config.json',
    );
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          transports: {
            smtp: {
              enabled: true,
              host: 'smtp.example.com',
              port: 587,
              from: 'bot@example.com',
              to: 'single@example.com',
              cc: 'cc@example.com',
              bcc: 'bcc@example.com',
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const config = parseConfig(configPath, schema, defaultsFromSchema(schema));

    expect(config.transports.smtp?.to).toEqual(['single@example.com']);
    expect(config.transports.smtp?.cc).toEqual(['cc@example.com']);
    expect(config.transports.smtp?.bcc).toEqual(['bcc@example.com']);
  });

  it('normalizes slack thread to false when omitted from config files', () => {
    const configPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'run-and-notify-slack-thread-')),
      'config.json',
    );
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          transports: {
            slack: {
              enabled: true,
              tokenEnvVar: 'SLACK_BOT_TOKEN',
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const config = parseConfig(configPath, schema, defaultsFromSchema(schema));

    expect(config.transports.slack?.thread).toBe(false);
  });

  it('normalizes multiple CLI overrides for cc and bcc to arrays of strings', async () => {
    const parsed = await parseCli([
      '--config=config.example.json',
      '--transports.smtp.cc=cc1@example.com',
      '--transports.smtp.cc=cc2@example.com',
      '--transports.smtp.bcc=bcc1@example.com',
      '--transports.smtp.bcc=bcc2@example.com',
      '--',
      'node',
      '-v',
    ]);

    expectParsed(parsed);
    expect(parsed.config.transports.smtp?.cc).toEqual(['cc1@example.com', 'cc2@example.com']);
    expect(parsed.config.transports.smtp?.bcc).toEqual(['bcc1@example.com', 'bcc2@example.com']);
  });

  it('derives CLI option types from oneOf schemas without array members', async () => {
    const parsed = await parseCli(['--custom=value'], {
      type: 'object',
      properties: {
        custom: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
    });

    expectParsed(parsed);
    expect(parsed.config).toEqual({ custom: 'value' });
  });

  it('accepts explicit Slack fallback text templates from CLI overrides', async () => {
    const parsed = await parseCli([
      '--success.slack.text=success.slack.text.hbs',
      '--error.slack.text=error.slack.text.hbs',
    ]);

    expectParsed(parsed);
    expect(parsed.config.success.slack?.text).toBe('success.slack.text.hbs');
    expect(parsed.config.error.slack?.text).toBe('error.slack.text.hbs');
  });

  it('leaves run-and-notify-looking flags after the command as command arguments', async () => {
    const parsed = await parseCli(['--config=config.example.json', 'node', '--dry-run']);

    expectParsed(parsed);
    expect(parsed.config.dryRun).toBe(false);
    expect(parsed.command).toEqual(['node', '--dry-run']);
  });

  it('lets yargs handle explicit command delimiters without treating command flags as overrides', async () => {
    const parsed = await parseCli(['--config=config.example.json', '--', 'node', '--dry-run']);

    expectParsed(parsed);
    expect(parsed.config.dryRun).toBe(false);
    expect(parsed.command).toEqual(['node', '--dry-run']);
  });

  it('uses schema defaults when no config file exists', async () => {
    const parsed = await parseCli(['missing-config-for-defaults.json']);

    expectParsed(parsed);
    expect(parsed.config.locale).toBe('en-US');
    expect(parsed.config.name).toBe('missing-config-for-defaults.json');
    expect(parsed.config.propagateExitCode).toBe(true);
    expect(parsed.config.hideCommandIfSuccess).toBe(false);
    expect(parsed.config.templatesDir).toBeUndefined();
    expect(parsed.config.success.email?.html).toBe('default.email.html.hbs');
    expect(parsed.config.success.slack?.blocks).toBe('default.slack.blocks.json.hbs');
    expect(parsed.config.stdout.format).toBe('raw');
    expect(parsed.config.stderr.format).toBe('raw');
  });

  it('uses schema defaults when parsing a missing config file directly', () => {
    const configPath = path.join(
      os.tmpdir(),
      `run-and-notify-missing-${process.pid}-${Date.now()}.json`,
    );

    const config = parseConfig(configPath, schema, defaultsFromSchema(schema));

    expect(config.name).toBe('run-and-notify');
    expect(config.hideCommandIfSuccess).toBe(false);
    expect(config.stdout.format).toBe('raw');
  });

  it('reports config file read errors other than missing files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-and-notify-config-error-'));
    const configFile = path.join(dir, 'config.json');
    fs.writeFileSync(configFile, '{', 'utf8');

    const { result, errors } = await captureConsoleError(() =>
      parseCli([`--config=${configFile}`]),
    );

    expect(result).toEqual({ kind: 'failed' });
    expect(errors.join('\n')).toContain("Expected property name or '}' in JSON");
  });

  it('reports direct config file validation errors', () => {
    const configPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'run-and-notify-invalid-config-')),
      'config.json',
    );
    fs.writeFileSync(configPath, `${JSON.stringify({ locale: '' }, null, 2)}\n`, 'utf8');

    expect(() => parseConfig(configPath, schema, defaultsFromSchema(schema))).toThrow(
      'Invalid configuration:\n/locale must NOT have fewer than 1 characters',
    );
  });

  it('returns help without loading or validating configuration for --help', async () => {
    const { result, errors } = await captureConsoleError(() => parseCli(['--help']));

    expect(result).toEqual({ kind: 'help' });
    const help = errors.join('\n');
    expect(help).toContain('run-and-notify [options] <command> [args...]');
    expect(help).toContain('--stdout.format');
    expect(help).toContain('[default: "raw"]');
    expect(help).toContain('--success.email.html');
    expect(help).toContain('[default: "default.email.html.hbs"]');
  });

  it('returns help without loading or validating configuration for -h', async () => {
    const { result, errors } = await captureConsoleError(() => parseCli(['-h']));

    expect(result).toEqual({ kind: 'help' });
    expect(errors.join('\n')).toContain('Options:');
  });

  it('reports unknown CLI arguments', async () => {
    const { result, errors } = await captureConsoleError(() =>
      parseCli(['--config=config.example.json', '--stdout.formatxml']),
    );

    expect(result).toEqual({ kind: 'failed' });
    expect(errors.join('\n')).toContain('Unknown option: stdout.formatxml');
  });

  it('reports unknown nested CLI arguments', async () => {
    const { result, errors } = await captureConsoleError(() =>
      parseCli(['--config=config.example.json', '--stdout.does-not-exist=true']),
    );

    expect(result).toEqual({ kind: 'failed' });
    expect(errors.join('\n')).toContain('Unknown option: stdout.does-not-exist');
  });

  it('reports yargs option parse failures with help context', async () => {
    const { result, errors } = await captureConsoleError(() => parseCli(['--stdout.format']));

    expect(result).toEqual({ kind: 'failed' });
    expect(errors.join('\n')).toContain('Not enough arguments following: stdout.format');
  });

  it('reports yargs missing required option failures with help context', async () => {
    const { result, errors } = await captureConsoleError(() =>
      parseCli([], {
        type: 'object',
        required: ['custom'],
        properties: {
          custom: {
            type: 'string',
            description: 'Custom required value.',
          },
        },
      }),
    );

    expect(result).toEqual({ kind: 'failed' });
    expect(errors.join('\n')).toContain('Missing required argument: custom');
  });

  it('leaves single-dash command arguments to yargs instead of unknown-option validation', async () => {
    const parsed = await parseCli(['-']);

    expectParsed(parsed);
    expect(parsed.command).toEqual(['-']);
  });

  it('derives a shell-friendly default name from command arguments containing spaces', async () => {
    const parsed = await parseCli(['echo', 'two words']);

    expectParsed(parsed);
    expect(parsed.config.name).toBe("echo 'two words'");
  });

  it('does not let yargs help defaults override config file values', async () => {
    const configPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'run-and-notify-yargs-defaults-')),
      'config.json',
    );
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          stdout: { format: 'jsonl' },
          transports: {
            smtp: {
              enabled: false,
              host: 'smtp.example.com',
              port: 587,
              from: 'bot@example.com',
              to: ['ops@example.com'],
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const parsed = await parseCli(['--config', configPath, 'node']);

    expectParsed(parsed);
    expect(parsed.config.stdout.format).toBe('jsonl');
    expect(parsed.command).toEqual(['node']);
  });

  it('reports non-enum schema validation errors without enum alternatives', async () => {
    await expect(parseCli(['--config=config.example.json', '--locale='])).rejects.toThrow(
      '/locale must NOT have fewer than 1 characters',
    );
  });

  it('rejects unsupported schema refs while building CLI options', async () => {
    await expect(
      parseCli([], {
        type: 'object',
        properties: {
          custom: { $ref: 'https://example.com/schema.json' },
        },
      }),
    ).rejects.toThrow('Unsupported schema ref https://example.com/schema.json');
  });

  it('rejects missing schema refs while building CLI options', async () => {
    await expect(
      parseCli([], {
        type: 'object',
        properties: {
          custom: { $ref: '#/definitions/missing' },
        },
        definitions: {},
      }),
    ).rejects.toThrow('Schema ref #/definitions/missing was not found');
  });

  it('ignores oneOf schema leaves when no member maps to a yargs option type', async () => {
    const parsed = await parseCli(['node'], {
      type: 'object',
      properties: {
        custom: {
          oneOf: [{ type: 'null' }, { type: 'null' }],
        },
      },
    });

    expectParsed(parsed);
    expect(parsed.command).toEqual(['node']);
  });

  it('ignores schema leaves that yargs cannot represent as options', async () => {
    const parsed = await parseCli(['node'], {
      type: 'object',
      properties: {
        custom: { type: 'null' },
      },
    });

    expectParsed(parsed);
    expect(parsed.command).toEqual(['node']);
  });

  it('supports custom schemas without configurable CLI options', async () => {
    const parsed = await parseCli(['node'], { type: 'object' });

    expectParsed(parsed);
    expect(parsed.command).toEqual(['node']);
  });

  it('preserves null hidden object defaults before schema validation rejects them', async () => {
    await expect(
      parseCli([], {
        type: 'object',
        properties: {
          custom: { type: 'object', default: null },
        },
      }),
    ).rejects.toThrow('/custom must be object');
  });

  it('preserves required empty object defaults from custom schemas', async () => {
    const parsed = await parseCli([], {
      type: 'object',
      required: ['custom'],
      properties: {
        custom: { type: 'object', properties: {} },
      },
    });

    expectParsed(parsed);
    expect(parsed.config).toEqual({ custom: {} });
  });

  it('reports enum alternatives for invalid stdout and stderr format CLI overrides', async () => {
    await expect(
      parseCli(['--config=config.example.json', '--stdout.format=xml', '--', 'node']),
    ).rejects.toThrow(
      '/stdout/format must be equal to one of the allowed values; allowed values: "raw", "jsonl", "markdown", "html"',
    );

    await expect(
      parseCli(['--config=config.example.json', '--stderr.format=xml', '--', 'node']),
    ).rejects.toThrow(
      '/stderr/format must be equal to one of the allowed values; allowed values: "raw", "jsonl", "markdown", "html"',
    );
  });

  it('ignores undefined override values', async () => {
    const parsed = await parseCli(['--config=config.example.json']);

    expectParsed(parsed);
    expect(parsed.config.locale).toBe('en-US');
  });

  it('keeps README field documentation aligned with schema top-level fields', () => {
    const schema = readConfigSchema();
    const readme = fs.readFileSync('README.md', 'utf8');

    for (const field of Object.keys(schema.properties ?? {})) {
      expect(readme).toContain(`\`${field}\``);
    }
  });
});
