import { logger } from '../logger.js';
import type { DeliveryPayload, RunAndNotifyConfig, TemplateContext } from '../types.js';
import type { DeliveryTransports } from './types.js';

const assertTransportResult = (result: unknown, channel: string): void => {
  if (result !== null && typeof result === 'object' && 'ok' in result && result.ok === false) {
    const error = 'error' in result ? result.error : undefined;
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    throw new Error(`${channel} transport failed: ${message}`);
  }
};

const getSlackMessageTs = (result: unknown): string | undefined => {
  if (result === null || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
    return undefined;
  }
  return (result as { data?: { ts?: string } }).data?.ts;
};

const attachSlackThread = (
  delivery: DeliveryPayload,
  config: RunAndNotifyConfig,
  threadTsByTarget: Map<string, string>,
): string | undefined => {
  if (delivery.channel !== 'slack' || !config.transports.slack?.thread) {
    return undefined;
  }
  const target = delivery.payload.to ?? config.transports.slack.defaultChannel ?? '';
  const threadTs = threadTsByTarget.get(target);
  if (threadTs !== undefined) {
    delivery.payload.threadTs = threadTs;
  }
  return threadTs === undefined ? target : undefined;
};

const captureSlackThread = (
  target: string | undefined,
  result: unknown,
  threadTsByTarget: Map<string, string>,
): void => {
  if (target === undefined) {
    return;
  }
  const parentTs = getSlackMessageTs(result);
  if (parentTs !== undefined) {
    threadTsByTarget.set(target, parentTs);
  }
};

const sendOneDelivery = async (
  delivery: DeliveryPayload,
  context: TemplateContext,
  transport: NonNullable<DeliveryTransports[keyof DeliveryTransports]>,
  parentTarget: string | undefined,
  threadTsByTarget: Map<string, string>,
): Promise<void> => {
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
  captureSlackThread(parentTarget, result, threadTsByTarget);
};

const slackTarget = (delivery: DeliveryPayload, config: RunAndNotifyConfig): string | undefined => {
  if (delivery.channel !== 'slack') return undefined;
  return delivery.payload.to ?? config.transports.slack?.defaultChannel ?? '';
};

export const sendDeliveryPayloads = async (
  payloads: DeliveryPayload[],
  context: TemplateContext,
  transports: DeliveryTransports,
): Promise<void> => {
  const threadTsByTarget = new Map<string, string>();
  const failedTargets = new Set<string>();
  const targetErrors: Error[] = [];
  const fanOut = context.config.transports.slack?.targets !== undefined;

  for (const delivery of payloads) {
    const transport = transports[delivery.channel];
    if (transport === undefined) {
      throw new Error(`No transport configured for ${delivery.channel}`);
    }
    const target = slackTarget(delivery, context.config);
    if (target !== undefined && failedTargets.has(target)) {
      continue;
    }

    const parentTarget = attachSlackThread(delivery, context.config, threadTsByTarget);

    try {
      await sendOneDelivery(delivery, context, transport, parentTarget, threadTsByTarget);
    } catch (error) {
      if (!fanOut || target === undefined) {
        throw error;
      }
      failedTargets.add(target);
      targetErrors.push(new Error(`Slack target ${target} failed`, { cause: error }));
    }
  }
  if (targetErrors.length > 0) {
    throw new AggregateError(
      targetErrors,
      `Slack delivery failed for ${targetErrors.length} target(s)`,
    );
  }
};
