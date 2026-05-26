type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'child';

export type LoggerCall = {
  level: LogLevel;
  args: unknown[];
};

export const loggerCalls: LoggerCall[] = [];

const record =
  (level: LogLevel) =>
  (...args: unknown[]): void => {
    loggerCalls.push({ level, args });
  };

export const mockLogger = {
  trace: record('trace'),
  debug: record('debug'),
  info: record('info'),
  warn: record('warn'),
  error: record('error'),
  fatal: record('fatal'),
  child: (...args: unknown[]) => {
    loggerCalls.push({ level: 'child', args });
    return mockLogger;
  },
};

export const clearLoggerCalls = (): void => {
  loggerCalls.length = 0;
};
