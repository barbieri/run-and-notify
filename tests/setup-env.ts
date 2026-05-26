import { beforeEach, vi } from 'vitest';
import { clearLoggerCalls, mockLogger } from './logger-mock.js';

const env = process.env as NodeJS.ProcessEnv & {
  LOG_LEVEL?: string;
  TZ?: string;
};

env.LOG_LEVEL = 'silent';

env.TZ = 'UTC';

vi.mock('../src/logger.js', () => ({
  logger: mockLogger,
}));

beforeEach(() => {
  clearLoggerCalls();
});
