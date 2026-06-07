import { createEmailSmtpPayload } from './delivery/email-smtp.js';
import { sendDeliveryPayloads } from './delivery/send.js';
import { createSlackPayloads } from './delivery/slack.js';
import type { DeliveryTransports } from './delivery/types.js';
import { logger } from './logger.js';
import { createEmailSmtpTransport } from './transports/email-smtp.js';
import { createSlackTransport } from './transports/slack.js';
import type { DeliveryPayload, RunAndNotifyConfig, TemplateContext } from './types.js';

export const createDeliveryPayloads = async (
  context: TemplateContext,
): Promise<DeliveryPayload[]> => {
  const [emailPayload, slackPayloads] = await Promise.all([
    createEmailSmtpPayload(context),
    createSlackPayloads(context),
  ]);

  return [emailPayload, ...slackPayloads].filter(
    (payload): payload is DeliveryPayload => payload !== undefined,
  );
};

export const createDefaultTransports = async (
  config: RunAndNotifyConfig,
): Promise<DeliveryTransports | undefined> => {
  const transports: DeliveryTransports = {};

  if (config.transports.smtp?.enabled === true) {
    transports.emailSmtp = createEmailSmtpTransport(config.transports.smtp);
  }

  if (config.transports.slack?.enabled === true) {
    transports.slack = createSlackTransport(config.transports.slack);
  }

  if (!Object.keys(transports).length) {
    return undefined;
  }
  return transports;
};

export const deliverNotifications = async (
  context: TemplateContext,
  transports: DeliveryTransports,
): Promise<DeliveryPayload[]> => {
  const payloads = await createDeliveryPayloads(context);
  if (context.dryRun) {
    logger.info({ payloads }, 'dry run enabled, skipping %d sends', payloads.length);
    return payloads;
  }

  await sendDeliveryPayloads(payloads, context, transports);
  return payloads;
};
