import { splitBlocksWithText } from 'markdown-to-slack-blocks';
import type { DeliveryPayload, SlackConfig, SlackPayload, TemplateContext } from '../types.js';
import { renderOptional } from './render.js';

const applySlackDeliveryOptions = (
  payload: SlackPayload,
  slack: SlackConfig,
  target: string | undefined,
): SlackPayload => {
  if (target !== undefined) {
    payload.to = target;
  }
  if (slack.unfurlLinks !== undefined) {
    payload.unfurlLinks = slack.unfurlLinks;
  }
  if (slack.unfurlMedia !== undefined) {
    payload.unfurlMedia = slack.unfurlMedia;
  }
  return payload;
};

export const createSlackPayloads = async (context: TemplateContext): Promise<DeliveryPayload[]> => {
  const notification = context.status === 0 ? context.config.success : context.config.error;
  const slack = context.config.transports.slack;
  if (slack?.enabled !== true || notification.slack === undefined) {
    return [];
  }

  const renderedBlocks = await renderOptional(notification.slack.blocks, context);
  const renderedText = await renderOptional(notification.slack.text, context);
  const fallbackText =
    renderedText?.trim() ??
    (context.status === 0
      ? context.config.name
      : `Failed: ${context.config.name} (status ${context.status})`);
  const targets: Array<string | undefined> = slack.targets ?? [slack.defaultChannel];

  if (renderedBlocks === undefined || renderedBlocks.trim() === '') {
    return targets.map((target) => ({
      channel: 'slack',
      payload: applySlackDeliveryOptions({ text: fallbackText }, slack, target),
    }));
  }

  const parsed: unknown = JSON.parse(renderedBlocks);
  if (!Array.isArray(parsed)) {
    throw new Error('Slack blocks template must render a JSON array');
  }

  const batches = splitBlocksWithText(parsed);
  return targets.flatMap((target): DeliveryPayload[] => {
    if (slack.thread) {
      const parent: DeliveryPayload = {
        channel: 'slack',
        payload: applySlackDeliveryOptions({ text: fallbackText }, slack, target),
      };
      const replies: DeliveryPayload[] = batches.map((batch) => ({
        channel: 'slack',
        payload: applySlackDeliveryOptions(
          { text: batch.text || fallbackText, blocks: batch.blocks },
          slack,
          target,
        ),
      }));
      return [parent, ...replies];
    }

    return batches.map((batch, index) => ({
      channel: 'slack',
      payload: applySlackDeliveryOptions(
        { text: index === 0 ? fallbackText : batch.text, blocks: batch.blocks },
        slack,
        target,
      ),
    }));
  });
};
