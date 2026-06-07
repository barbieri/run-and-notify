import { splitBlocksWithText } from 'markdown-to-slack-blocks';
import type { DeliveryPayload, SlackPayload, TemplateContext } from '../types.js';
import { renderOptional } from './render.js';

export const createSlackPayloads = async (context: TemplateContext): Promise<DeliveryPayload[]> => {
  const notification = context.status === 0 ? context.config.success : context.config.error;
  const slack = context.config.transports.slack;
  if (slack?.enabled !== true || notification.slack === undefined) {
    return [];
  }

  const renderedBlocks = await renderOptional(notification.slack.blocks, context);
  const renderedText = await renderOptional(notification.slack.text, context);
  const fallbackText =
    (renderedText?.trim() ?? context.status === 0)
      ? context.config.name
      : `Failed: ${context.config.name}`;

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

  const batches = splitBlocksWithText(parsed);
  if (slack.thread) {
    const parent: DeliveryPayload = {
      channel: 'slack',
      payload: {
        text: fallbackText,
        ...(slack.defaultChannel !== undefined ? { to: slack.defaultChannel } : {}),
      },
    };
    const replies = batches.map((batch) => {
      const payload: SlackPayload = {
        text: batch.text || fallbackText,
        blocks: batch.blocks,
        ...(slack.defaultChannel !== undefined ? { to: slack.defaultChannel } : {}),
      };
      return { channel: 'slack' as const, payload };
    });
    return [parent, ...replies];
  }

  return batches.map((batch, index) => {
    const payload: SlackPayload = {
      text: index === 0 ? fallbackText : batch.text,
      blocks: batch.blocks,
    };
    if (slack.defaultChannel !== undefined) {
      payload.to = slack.defaultChannel;
    }
    return { channel: 'slack' as const, payload };
  });
};
