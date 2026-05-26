import type { OutputFormatter } from './types.js';

const normalize = (value: string): string =>
  value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');

export const rawFormatter: OutputFormatter = (value) => ({
  format: 'raw',
  raw: normalize(value),
});
