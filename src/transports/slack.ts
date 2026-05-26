import { slackTransport } from '@betternotify/slack';
import type { RunAndNotifyConfig, TransportLike } from '../types.js';

const getEnvValue = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
};

export const createSlackTransport = (
  config: NonNullable<RunAndNotifyConfig['transports']['slack']>,
): TransportLike =>
  slackTransport({
    token: getEnvValue(config.tokenEnvVar),
    ...(config.defaultChannel !== undefined ? { defaultChannel: config.defaultChannel } : {}),
  });
