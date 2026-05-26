import pino from 'pino';

const env = process.env as NodeJS.ProcessEnv & {
  RUN_AND_NOTIFY_LOG_LEVEL?: string;
};

export const logger = pino({
  level: env.RUN_AND_NOTIFY_LOG_LEVEL ?? 'info',
});
