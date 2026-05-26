import process from 'node:process';
import { runCommand } from './command.js';
import { parseCli } from './config.js';
import { createDefaultTransports, deliverNotifications } from './delivery.js';
import { logger } from './logger.js';
import type { TemplateContext } from './types.js';

export const main = async (argv = process.argv.slice(2)): Promise<number> => {
  const childEnv = { ...process.env };
  const parsed = await parseCli(argv);
  if (parsed.kind === 'help') {
    return 0;
  }
  if (parsed.kind === 'failed') {
    return 1;
  }

  let transports: Exclude<Awaited<ReturnType<typeof createDefaultTransports>>, undefined>;
  try {
    const createdTransports = await createDefaultTransports(parsed.config);
    if (createdTransports === undefined) {
      throw new Error('No enabled transports configured');
    }
    transports = createdTransports;
  } catch (error) {
    /* v8 ignore next */
    logger.fatal({ err: error }, 'transport failure: %s', error);
    return 1;
  }

  const result = await runCommand(parsed.command, parsed.config, { env: childEnv });
  const context: TemplateContext = {
    config: parsed.config,
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    command: result.command,
    cwd: result.cwd,
    timedOut: result.timedOut,
    executedAt: result.executedAt,
    dryRun: parsed.config.dryRun,
  };

  try {
    await deliverNotifications(context, transports);
  } catch (error) {
    /* v8 ignore next */
    logger.fatal({ err: error }, 'transport failure: %s', error);
    return 1;
  }

  return parsed.config.propagateExitCode ? result.status : 0;
};

/* v8 ignore next 11 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error: unknown) => {
      logger.fatal({ err: error }, 'crashed: %s', error);
      process.exitCode = 1;
    });
}
