import { slackTransport } from '@betternotify/slack';
import type { RunAndNotifyConfig, TransportLike } from '../types.js';

const getEnvValue = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
};

const isSlackUserId = (value: string): boolean => /^[UW][A-Z0-9]+$/.test(value);

const openDirectMessage = async (userId: string, token: string): Promise<string> => {
  const response = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ users: userId }),
  });
  const result: unknown = await response.json();
  if (
    !response.ok ||
    result === null ||
    typeof result !== 'object' ||
    !('ok' in result) ||
    result.ok !== true ||
    !('channel' in result) ||
    result.channel === null ||
    typeof result.channel !== 'object' ||
    !('id' in result.channel) ||
    typeof result.channel.id !== 'string'
  ) {
    throw new Error(`Slack conversations.open failed for user ${userId}`);
  }
  return result.channel.id;
};

export const createSlackTransport = (
  config: NonNullable<RunAndNotifyConfig['transports']['slack']>,
): TransportLike => {
  const token = getEnvValue(config.tokenEnvVar);
  const transport: TransportLike = slackTransport({
    token,
    ...(config.defaultChannel !== undefined ? { defaultChannel: config.defaultChannel } : {}),
  });
  const directMessages = new Map<string, string>();
  return {
    async send(rendered, context) {
      if (
        rendered === null ||
        typeof rendered !== 'object' ||
        !('to' in rendered) ||
        typeof rendered.to !== 'string' ||
        !isSlackUserId(rendered.to)
      ) {
        return transport.send(rendered, context);
      }
      let conversationId = directMessages.get(rendered.to);
      if (conversationId === undefined) {
        conversationId = await openDirectMessage(rendered.to, token);
        directMessages.set(rendered.to, conversationId);
      }
      return transport.send({ ...rendered, to: conversationId }, context);
    },
  };
};
