import { splitBlocksWithText } from 'markdown-to-slack-blocks';
import { logger } from './logger.js';
import { createHandlebars, formatShellCommand, renderTemplateFile } from './templates.js';
import { createEmailSmtpTransport } from './transports/email-smtp.js';
import { createSlackTransport } from './transports/slack.js';
import type {
  DeliveryPayload,
  EmailPayload,
  RunAndNotifyConfig,
  SlackPayload,
  TemplateContext,
  TransportLike,
} from './types.js';

type DeliveryTransports = {
  emailSmtp?: TransportLike;
  slack?: TransportLike;
};

const assertTransportResult = (result: unknown, channel: string): void => {
  if (result !== null && typeof result === 'object' && 'ok' in result && result.ok === false) {
    const error = 'error' in result ? result.error : undefined;
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    throw new Error(`${channel} transport failed: ${message}`);
  }
};

const renderOptional = async (
  filename: string | undefined,
  context: TemplateContext,
): Promise<string | undefined> => {
  if (filename === undefined) {
    return undefined;
  }

  const handlebars = await createHandlebars(context.config.templatesDir);
  return renderTemplateFile(handlebars, context.config.templatesDir, filename, context);
};

const createEmailPayload = async (
  context: TemplateContext,
): Promise<DeliveryPayload | undefined> => {
  const notification = context.status === 0 ? context.config.success : context.config.error;
  const email = context.config.transports.smtp;
  if (email?.enabled !== true || notification.email === undefined) {
    return undefined;
  }

  const html = await renderOptional(notification.email.html, context);
  const subject = await renderOptional(notification.email.subject, context);
  const text = await renderOptional(notification.email.text, context);
  if (html === undefined || subject === undefined) {
    throw new Error('Email notification requires subject and html templates');
  }

  const payload: EmailPayload = {
    from: email.from,
    to: email.to.map((recipient) => ({ email: recipient })),
    subject: subject.trim(),
    html,
  };
  if (text !== undefined) {
    payload.text = text;
  }
  return { channel: 'emailSmtp', payload };
};

const createSlackPayloads = async (context: TemplateContext): Promise<DeliveryPayload[]> => {
  const notification = context.status === 0 ? context.config.success : context.config.error;
  const slack = context.config.transports.slack;
  if (slack?.enabled !== true || notification.slack === undefined) {
    return [];
  }

  const renderedBlocks = await renderOptional(notification.slack.blocks, context);
  const state = context.status === 0 ? 'succeeded' : 'failed';
  const renderedText = await renderOptional(notification.slack.text, context);
  const fallbackText =
    renderedText?.trim() ??
    `${context.status === 0 ? context.config.name : `Failed: ${context.config.name}`} (${state} ${context.status}): ${formatShellCommand(context.command)}`;

  if (renderedBlocks === undefined || renderedBlocks.trim() === '') {
    const payload: SlackPayload = { text: fallbackText };
    if (slack.defaultChannel !== undefined) {
      payload.to = slack.defaultChannel;
    }
    return [{ channel: 'slack', payload }];
  }

  const parsed: unknown = JSON.parse(renderedBlocks);
  if (!Array.isArray(parsed)) {
    throw new Error('Slack blocks template must render a JSON array');
  }

  return splitBlocksWithText(parsed).map((batch, index) => {
    const payload: SlackPayload = {
      text: index === 0 ? fallbackText : batch.text,
      blocks: batch.blocks,
    };
    if (slack.defaultChannel !== undefined) {
      payload.to = slack.defaultChannel;
    }
    return { channel: 'slack', payload };
  });
};

export const createDeliveryPayloads = async (
  context: TemplateContext,
): Promise<DeliveryPayload[]> => {
  const [emailPayload, slackPayloads] = await Promise.all([
    createEmailPayload(context),
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

  for (const delivery of payloads) {
    const transport = transports[delivery.channel];
    if (transport === undefined) {
      throw new Error(`No transport configured for ${delivery.channel}`);
    }
    logger.info(
      { channel: delivery.channel, payload: delivery.payload },
      'sending %s notification',
      delivery.channel,
    );
    const result = await transport.send(delivery.payload, {
      route: context.status === 0 ? 'run.success' : 'run.error',
      channel: delivery.channel,
      input: context,
    });
    assertTransportResult(result, delivery.channel);
  }

  return payloads;
};
