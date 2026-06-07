import { logger } from '../logger.js';
import type { DeliveryPayload, TemplateContext } from '../types.js';
import type { DeliveryTransports } from './types.js';

const assertTransportResult = (result: unknown, channel: string): void => {
  if (result !== null && typeof result === 'object' && 'ok' in result && result.ok === false) {
    const error = 'error' in result ? result.error : undefined;
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    throw new Error(`${channel} transport failed: ${message}`);
  }
};

export const sendDeliveryPayloads = async (
  payloads: DeliveryPayload[],
  context: TemplateContext,
  transports: DeliveryTransports,
): Promise<void> => {
  let threadTs: string | undefined;

  for (const delivery of payloads) {
    const transport = transports[delivery.channel];
    if (transport === undefined) {
      throw new Error(`No transport configured for ${delivery.channel}`);
    }

    if (delivery.channel === 'slack' && threadTs !== undefined) {
      delivery.payload.threadTs = threadTs;
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

    if (
      delivery.channel === 'slack' &&
      context.config.transports.slack?.thread &&
      threadTs === undefined &&
      result !== null &&
      typeof result === 'object' &&
      'ok' in result &&
      result.ok === true
    ) {
      threadTs = (result as { data?: { ts?: string } }).data?.ts;
    }
  }
};
