import type { OutputConfig, ParsedOutput } from '../types.js';

export type OutputFormatter = (value: string, config: OutputConfig) => ParsedOutput;
