import fs from 'node:fs';
import process from 'node:process';
import { Ajv } from 'ajv/dist/ajv.js';
import type { ErrorObject } from 'ajv/dist/types/index.js';
import dotenv from 'dotenv';
import cloneDeep from 'lodash/cloneDeep.js';
import getPath from 'lodash/get.js';
import kebabCase from 'lodash/kebabCase.js';
import merge from 'lodash/merge.js';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';
import schemaJson from '../schemas/config.schema.json' with { type: 'json' };
import type { RunAndNotifyConfig } from './types.js';

type CliParseResult =
  | { kind: 'help' }
  | { kind: 'failed' }
  | {
      kind: 'parsed';
      config: RunAndNotifyConfig;
      command: string[];
    };

export type JsonSchema = Readonly<{
  $ref?: string;
  type?: string;
  description?: string;
  default?: unknown;
  properties?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: readonly unknown[];
  required?: readonly string[];
}>;

export const readConfigSchema = (): JsonSchema => schemaJson as JsonSchema;

export const defaultsFromSchema = (schema: JsonSchema): unknown => {
  if (schema.default !== undefined) {
    return cloneDeep(schema.default);
  }
  if (schema.type === 'object') {
    const value: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      const childDefault = defaultsFromSchema(child);
      if (childDefault !== undefined) {
        value[key] = childDefault;
      }
    }
    return value;
  }
  return undefined;
};

const resolveSchema = (schema: JsonSchema, root: JsonSchema): JsonSchema => {
  if (schema.$ref === undefined) {
    return schema;
  }

  const prefix = '#/definitions/';
  if (!schema.$ref.startsWith(prefix)) {
    throw new Error(`Unsupported schema ref ${schema.$ref}`);
  }

  const name = schema.$ref.slice(prefix.length);
  const resolved = root.definitions?.[name];
  if (resolved === undefined) {
    throw new Error(`Schema ref ${schema.$ref} was not found`);
  }
  return resolved;
};

const optionTypeFromSchema = (
  schema: JsonSchema,
): 'array' | 'boolean' | 'number' | 'string' | undefined => {
  if (schema.type === 'integer' || schema.type === 'number') {
    return 'number';
  }
  if (schema.type === 'array' || schema.type === 'boolean' || schema.type === 'string') {
    return schema.type;
  }
  return undefined;
};

const optionPathToKebab = (optionPath: readonly string[]): string =>
  optionPath.map(kebabCase).join('.');

const parseOptionName = (argument: string): string | undefined => {
  if (!argument.startsWith('--') || argument === '--') {
    return undefined;
  }
  const [name = ''] = argument.slice(2).split('=', 1);
  return name.startsWith('no-') ? name.slice(3) : name;
};

const getKnownOptionNames = (parser: ReturnType<typeof yargs>): Set<string> => {
  const options =
    // Unfortunately @types/yargs does not expose this function
    (
      parser as unknown as {
        getOptions: () => {
          alias: Record<string, string[]>;
          key: Record<string, unknown>;
        };
      }
    ).getOptions();
  const allowed = new Set(Object.keys(options.key));
  for (const [key, aliases] of Object.entries(options.alias)) {
    allowed.add(key);
    for (const alias of aliases) {
      allowed.add(alias);
    }
  }
  return allowed;
};

const getUnknownOption = (
  argv: readonly string[],
  parser: ReturnType<typeof yargs>,
): string | undefined => {
  const allowed = getKnownOptionNames(parser);

  for (const argument of argv) {
    if (argument === '--') {
      break;
    }
    if (!argument.startsWith('-')) {
      break;
    }
    if (argument === '-c' || argument === '-h') {
      continue;
    }

    const optionName = parseOptionName(argument);
    if (
      optionName !== undefined &&
      !allowed.has(optionName) &&
      !allowed.has(optionPathToKebab([optionName]))
    ) {
      return optionName;
    }
  }

  return undefined;
};

const addSchemaLeafOption = (
  parser: ReturnType<typeof yargs>,
  optionPath: readonly string[],
  schema: JsonSchema,
  defaults: unknown,
  isRequired: boolean,
): ReturnType<typeof yargs> => {
  const type = optionTypeFromSchema(schema);
  if (type === undefined) {
    return parser;
  }

  const defaultValue = getPath(defaults, optionPath);
  return parser.option(optionPathToKebab(optionPath), {
    ...(type === 'array' ? { array: true, nargs: 1 } : { type }),
    ...(schema.enum?.length ? { choices: schema.enum as string[] } : {}),
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    describe: schema.description,
    demandOption: isRequired && defaultValue === undefined,
    requiresArg: type !== 'boolean',
  });
};

const recursivelyAdjustYargsValue = (
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  isRequired: boolean,
): unknown => {
  if (typeof value !== 'object') {
    return value;
  }
  if (!value) {
    return value;
  }
  if (Array.isArray(value)) {
    return value;
  }

  const entries = Object.entries(value).filter(([_key, v]) => v !== undefined);
  if (entries.length === 0) {
    if (isRequired) {
      return {}; // example: transports is required but defaults to {}
    }
    return undefined;
  }

  const childSchemas = schema.properties ?? {};
  return Object.fromEntries(
    entries.flatMap(([k, v]) => {
      const rawChildSchema = childSchemas[k];
      if (rawChildSchema === undefined) {
        return [];
      }
      const childSchema = resolveSchema(rawChildSchema, root);
      const isChildRequired = isRequired && !!schema.required?.includes(k);
      return [[k, recursivelyAdjustYargsValue(v, childSchema, root, isChildRequired)]];
    }),
  );
};

const addSchemaOptions = (
  parser: ReturnType<typeof yargs>,
  schema: JsonSchema,
  root: JsonSchema,
  defaults: unknown,
  isRequired: boolean,
  prefix: readonly string[],
): ReturnType<typeof yargs> => {
  const optionName = optionPathToKebab(prefix);
  let next =
    prefix.length === 0
      ? parser
      : parser.option(optionName, {
          default: getPath(defaults, prefix),
          hidden: true,
        });

  for (const [key, rawChild] of Object.entries(schema.properties ?? {})) {
    const child = resolveSchema(rawChild, root);
    const isChildRequired = isRequired && !!schema.required?.includes(key);
    const childOptionPath = prefix.concat(key);
    if (child.type === 'object') {
      next = addSchemaOptions(next, child, root, defaults, isChildRequired, childOptionPath);
      continue;
    }

    next = addSchemaLeafOption(next, childOptionPath, child, defaults, isChildRequired);
  }
  return next;
};

const loadJsonFile = (filePath: string): Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
};

const formatAllowedValues = (values: unknown[]): string =>
  values.map((value) => JSON.stringify(value)).join(', ');

const formatValidationError = (error: ErrorObject): string => {
  const location = error.instancePath;
  const enumAllowedValues =
    error.keyword === 'enum'
      ? (error.params as { allowedValues: unknown[] }).allowedValues
      : undefined;
  const allowedValues =
    enumAllowedValues === undefined
      ? ''
      : `; allowed values: ${formatAllowedValues(enumAllowedValues)}`;

  return `${location} ${error.message as string}${allowedValues}`;
};

const formatValidationErrors = (errors: ErrorObject[]): string =>
  errors.map(formatValidationError).join('\n');

export const parseConfig = (
  configPath: string,
  schema: JsonSchema,
  defaults: unknown,
): RunAndNotifyConfig => {
  const loadedConfig = loadJsonFile(configPath);
  const config = merge({}, defaults, loadedConfig);
  // biome-ignore lint/complexity/useLiteralKeys: conflicts with tsc
  if (typeof config['name'] !== 'string' || config['name'] === '') {
    // biome-ignore lint/complexity/useLiteralKeys: conflicts with tsc
    config['name'] = 'run-and-notify';
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile<RunAndNotifyConfig>(schema);
  if (!validate(config)) {
    const details = formatValidationErrors(validate.errors as ErrorObject[]);
    throw new Error(`Invalid configuration:\n${details}`);
  }

  return config;
};

export const parseCli = async (
  argv = hideBin(process.argv),
  schema = readConfigSchema(),
): Promise<CliParseResult> => {
  const defaults = defaultsFromSchema(schema) as Record<string, unknown>;
  let failure: string | undefined;
  let parser: ReturnType<typeof yargs>;
  parser = addSchemaOptions(
    yargs(argv)
      .scriptName('run-and-notify')
      .usage('$0 [options] <command> [args...]')
      .command('$0 [command..]', 'Execute a command and send notifications.', (builder) =>
        builder.positional('command', {
          array: true,
          describe: 'Command and arguments to execute.',
          type: 'string',
        }),
      )
      .config(defaults)
      .config('config', (configPath) => parseConfig(configPath, schema, defaults))
      .alias('config', 'c')
      .option('dry-run', {
        describe: 'Render and log notifications without sending through transports.',
        type: 'boolean',
      })
      .help(false)
      .option('help', {
        alias: 'h',
        describe: 'Show help.',
        type: 'boolean',
      })
      .parserConfiguration({
        'camel-case-expansion': true, // automatically converts back from kebab
        'strip-dashed': true, // and keep only the camelCase
        'dot-notation': true, // automatically handles nested options
        'boolean-negation': true, // boolean get --no-OPTION automatically
        'halt-at-non-option': true,
      })
      .strict()
      .fail((message) => {
        failure = message;
      }),
    schema,
    schema,
    defaults,
    true,
    [],
  );

  const parsed = await parser.parse();
  if (failure !== undefined) {
    console.error(await parser.getHelp());
    console.error(failure);
    return { kind: 'failed' };
  }

  const unknownOption = getUnknownOption(argv, parser);
  if (unknownOption) {
    console.error(await parser.getHelp());
    console.error(`Unknown option: ${unknownOption}`);
    return { kind: 'failed' };
  }

  // biome-ignore lint/complexity/useLiteralKeys: conflicts with tsc
  if (parsed['help']) {
    console.error(await parser.getHelp());
    return { kind: 'help' };
  }

  dotenv.config({ quiet: true });

  // biome-ignore lint/complexity/useLiteralKeys: conflicts with tsc
  if (!parsed['name']) {
    // biome-ignore lint/complexity/useLiteralKeys: conflicts with tsc
    parsed['name'] =
      parsed._.map((p) => ((p as string).includes(' ') ? `'${p}'` : p)).join(' ') ||
      'run-and-notify';
  }

  const config = recursivelyAdjustYargsValue(parsed, schema, schema, true) as RunAndNotifyConfig;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile<RunAndNotifyConfig>(schema);
  if (!validate(config)) {
    const details = formatValidationErrors(validate.errors as ErrorObject[]);
    throw new Error(`Invalid configuration:\n${details}`);
  }

  return {
    kind: 'parsed',
    config,
    command: parsed._ as string[],
  };
};
