import type { SmtpTransportOptions } from '@betternotify/smtp';
import { smtpTransport } from '@betternotify/smtp';
import type { RunAndNotifyConfig, TransportLike } from '../types.js';

const getEnvValue = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
};

export const createEmailSmtpTransport = (
  config: NonNullable<RunAndNotifyConfig['transports']['smtp']>,
): TransportLike => {
  const { auth } = config;
  const smtpOptions: SmtpTransportOptions = {
    host: config.host,
    port: config.port,
    ...(config.secure !== undefined ? { secure: config.secure } : {}),
  };
  if (auth !== undefined && (auth.user !== undefined || auth.passEnvVar !== undefined)) {
    smtpOptions.auth = {
      ...(auth.user !== undefined ? { user: auth.user } : {}),
      ...(auth.passEnvVar !== undefined ? { pass: getEnvValue(auth.passEnvVar) } : {}),
    } as NonNullable<SmtpTransportOptions['auth']>;
  }

  return smtpTransport(smtpOptions);
};
