import { mockTransport as mockEmailTransport } from '@betternotify/email';
import { mockSlackTransport } from '@betternotify/slack';
import * as markdownToSlackBlocks from 'markdown-to-slack-blocks';
import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultTransports,
  createDeliveryPayloads,
  deliverNotifications,
} from '../src/delivery.js';
import { createEmailSmtpTransport } from '../src/transports/email-smtp.js';
import { createSlackTransport } from '../src/transports/slack.js';
import type {
  RunAndNotifyConfig,
  SlackPayload,
  TemplateContext,
  TransportLike,
} from '../src/types.js';
import { loggerCalls } from './logger-mock.js';

const config: RunAndNotifyConfig = {
  name: 'run-and-notify',
  locale: 'en-US',
  dryRun: false,
  propagateExitCode: true,
  timeoutSeconds: 0,
  showStderrIfSuccess: false,
  hideCommandIfSuccess: false,
  stdout: { format: 'raw' },
  stderr: { format: 'raw' },
  transports: {
    smtp: {
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      from: 'bot@example.com',
      to: ['ops@example.com'],
    },
    slack: {
      enabled: true,
      tokenEnvVar: 'SLACK_BOT_TOKEN',
      defaultChannel: '#ops',
      thread: false,
    },
  },
  success: {
    email: {
      subject: 'success.subject.hbs',
      html: 'default.email.html.hbs',
      text: 'default.text.hbs',
    },
    slack: {
      blocks: 'default.slack.blocks.json.hbs',
    },
  },
  error: {
    email: {
      subject: 'error.subject.hbs',
      html: 'default.email.html.hbs',
    },
    slack: {
      blocks: 'default.slack.blocks.json.hbs',
    },
  },
};
const smtpConfig = config.transports.smtp;
const slackConfig = config.transports.slack;
if (smtpConfig === undefined || slackConfig === undefined) {
  throw new Error('delivery test config must define smtp and slack');
}
const env = process.env as NodeJS.ProcessEnv & {
  SMTP_PASS?: string;
  SLACK_BOT_TOKEN?: string;
  MISSING_SLACK_TOKEN?: string;
};

const context: TemplateContext = {
  config,
  status: 0,
  command: ['echo', 'hello'],
  cwd: process.cwd(),
  timedOut: false,
  executedAt: '2026-01-02T12:34:56Z',
  dryRun: false,
  stdout: {
    format: 'raw',
    raw: 'hello',
  },
  stderr: {
    format: 'raw',
    raw: 'warning',
  },
};

describe('delivery', () => {
  it('renders email and Slack payloads', async () => {
    const payloads = await createDeliveryPayloads(context);

    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      channel: 'emailSmtp',
      payload: {
        from: 'bot@example.com',
        subject: 'run-and-notify',
      },
    });
    expect(payloads[1]).toMatchObject({
      channel: 'slack',
      payload: {
        to: '#ops',
        text: 'run-and-notify (succeeded 0): echo hello',
        blocks: expect.arrayContaining([{ type: 'divider' }]),
      },
    });
  });

  it('populates to, cc and bcc in the email payload when configured', async () => {
    const customConfig = {
      ...config,
      transports: {
        ...config.transports,
        smtp: {
          ...smtpConfig,
          to: ['ops@example.com'],
          cc: ['cc1@example.com', 'cc2@example.com'],
          bcc: ['bcc1@example.com'],
        },
      },
    };
    const payloads = await createDeliveryPayloads({
      ...context,
      config: customConfig,
    });

    expect(payloads[0]).toMatchObject({
      channel: 'emailSmtp',
      payload: {
        from: 'bot@example.com',
        to: [{ email: 'ops@example.com' }],
        cc: [{ email: 'cc1@example.com' }, { email: 'cc2@example.com' }],
        bcc: [{ email: 'bcc1@example.com' }],
        subject: 'run-and-notify',
      },
    });
  });

  it('uses fallback text for threaded Slack replies when batch text is empty', async () => {
    const splitSpy = vi
      .spyOn(markdownToSlackBlocks, 'splitBlocksWithText')
      .mockReturnValue([{ text: '', blocks: [{ type: 'divider' }] }]);
    try {
      const customConfig = {
        ...config,
        transports: {
          ...config.transports,
          slack: {
            ...slackConfig,
            thread: true,
          },
        },
      };
      const payloads = await createDeliveryPayloads({
        ...context,
        config: customConfig,
      });

      expect(payloads[2]).toMatchObject({
        channel: 'slack',
        payload: {
          text: 'run-and-notify (succeeded 0): echo hello',
          blocks: [{ type: 'divider' }],
        },
      });
    } finally {
      splitSpy.mockRestore();
    }
  });

  it('generates threaded Slack payloads without defaultChannel when omitted', async () => {
    const customConfig = {
      ...config,
      transports: {
        ...config.transports,
        slack: {
          enabled: true,
          tokenEnvVar: 'SLACK_BOT_TOKEN',
          thread: true,
        },
      },
    };
    const payloads = await createDeliveryPayloads({
      ...context,
      config: customConfig,
    });

    expect(payloads[1]).toEqual({
      channel: 'slack',
      payload: {
        text: 'run-and-notify (succeeded 0): echo hello',
      },
    });
    expect(payloads[2]).toMatchObject({
      channel: 'slack',
      payload: {
        text: expect.any(String),
        blocks: expect.arrayContaining([{ type: 'divider' }]),
      },
    });
    expect(payloads[2]?.payload).not.toHaveProperty('to');
  });

  it('generates threaded Slack payloads (parent text and reply blocks)', async () => {
    const customConfig = {
      ...config,
      transports: {
        ...config.transports,
        slack: {
          ...slackConfig,
          thread: true,
        },
      },
    };
    const payloads = await createDeliveryPayloads({
      ...context,
      config: customConfig,
    });

    // There should be 1 email payload, 1 Slack parent payload, and 1 Slack reply payload (with blocks)
    expect(payloads).toHaveLength(3);

    // Email payload
    expect(payloads[0]?.channel).toBe('emailSmtp');

    // Slack parent payload (no blocks)
    expect(payloads[1]).toEqual({
      channel: 'slack',
      payload: {
        to: '#ops',
        text: 'run-and-notify (succeeded 0): echo hello',
      },
    });

    // Slack reply payload (contains blocks)
    expect(payloads[2]).toMatchObject({
      channel: 'slack',
      payload: {
        to: '#ops',
        text: expect.any(String),
        blocks: expect.arrayContaining([{ type: 'divider' }]),
      },
    });
  });

  it('delivers threaded Slack notifications injecting captured threadTs', async () => {
    const customConfig = {
      ...config,
      transports: {
        ...config.transports,
        slack: {
          ...slackConfig,
          thread: true,
        },
      },
    };

    const email = mockEmailTransport();

    // A mock transport that records messages sent to it and returns a specific message ts on send
    const messagesSent: SlackPayload[] = [];
    const mockSlack: TransportLike = {
      send: vi.fn().mockImplementation(async (payload) => {
        messagesSent.push(payload as SlackPayload);
        return { ok: true, data: { ts: '12345.67890', channel: '#ops' } };
      }),
    };

    await deliverNotifications(
      {
        ...context,
        config: customConfig,
      },
      {
        emailSmtp: email,
        slack: mockSlack,
      },
    );

    // Should have sent 2 messages to Slack:
    // 1. The parent message (no blocks, no threadTs)
    // 2. The reply message (with blocks, threadTs: '12345.67890')
    expect(messagesSent).toHaveLength(2);
    expect(messagesSent[0]).toEqual({
      to: '#ops',
      text: 'run-and-notify (succeeded 0): echo hello',
    });
    expect(messagesSent[1]).toEqual({
      to: '#ops',
      text: expect.any(String),
      blocks: expect.arrayContaining([{ type: 'divider' }]),
      threadTs: '12345.67890',
    });
  });

  it('renders Slack fallback text from template when configured', async () => {
    const payloads = await createDeliveryPayloads({
      ...context,
      config: {
        ...context.config,
        success: {
          ...context.config.success,
          slack: {
            ...context.config.success.slack,
            text: 'success.slack.text.hbs',
          },
        },
      },
    });

    expect(payloads[1]).toMatchObject({
      channel: 'slack',
      payload: {
        text: 'run-and-notify',
      },
    });
  });

  it('renders text-only Slack payloads when no blocks template is configured', async () => {
    const payloads = await createDeliveryPayloads({
      ...context,
      config: {
        ...context.config,
        success: {
          slack: {
            text: 'success.slack.text.hbs',
          },
        },
      },
    });

    expect(payloads).toEqual([
      {
        channel: 'slack',
        payload: {
          text: 'run-and-notify',
          to: '#ops',
        },
      },
    ]);
  });

  it('renders failed email notifications with a dark red header', async () => {
    const payloads = await createDeliveryPayloads({
      ...context,
      status: 2,
    });

    expect(payloads[0]).toMatchObject({
      channel: 'emailSmtp',
      payload: {
        html: expect.stringContaining('background: #7f1d1d'),
      },
    });
  });

  it('sends each payload through Better-Notify mock transports', async () => {
    const email = mockEmailTransport();
    const slack = mockSlackTransport();

    await deliverNotifications(context, { emailSmtp: email, slack });

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.subject).toBe('run-and-notify');
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]?.text).toBe('run-and-notify (succeeded 0): echo hello');
    expect(loggerCalls).toContainEqual(
      expect.objectContaining({
        level: 'info',
        args: [
          expect.objectContaining({ channel: 'emailSmtp', payload: expect.any(Object) }),
          'sending %s notification',
          'emailSmtp',
        ],
      }),
    );
    expect(loggerCalls).toContainEqual(
      expect.objectContaining({
        level: 'info',
        args: [
          expect.objectContaining({ channel: 'slack', payload: expect.any(Object) }),
          'sending %s notification',
          'slack',
        ],
      }),
    );
  });

  it('splits large Slack block payloads into multiple sends', async () => {
    const manyBlocks = Array.from({ length: 45 }, (_, index) => index);
    const payloads = await createDeliveryPayloads({
      ...context,
      manyBlocks,
      config: {
        ...context.config,
        templatesDir: 'tests/fixtures',
        success: { slack: { blocks: 'many-slack-blocks.json.hbs' } },
      },
    } as TemplateContext & { manyBlocks: number[] });

    const slackPayloads = payloads.filter((payload) => payload.channel === 'slack');
    const blockCounts = slackPayloads
      .map((payload) => payload.payload.blocks?.length)
      .sort((left = 0, right = 0) => left - right);
    expect(slackPayloads).toHaveLength(2);
    expect(blockCounts).toEqual([5, 40]);
  });

  it('reports missing channel transport as delivery failure', async () => {
    await expect(
      deliverNotifications(context, { emailSmtp: mockEmailTransport() }),
    ).rejects.toThrow('No transport configured for slack');
  });

  it('reports Better-Notify transport failures that return ok false', async () => {
    const failing: TransportLike = {
      send: vi.fn().mockResolvedValue({ ok: false, error: new Error('provider rejected') }),
    };

    await expect(
      deliverNotifications(context, { emailSmtp: mockEmailTransport(), slack: failing }),
    ).rejects.toThrow('slack transport failed: provider rejected');
  });

  it('reports Better-Notify transport failures with structured non-error payloads', async () => {
    const failing: TransportLike = {
      send: vi.fn().mockResolvedValue({ ok: false, error: { code: 'PROVIDER' } }),
    };

    await expect(
      deliverNotifications(context, { emailSmtp: mockEmailTransport(), slack: failing }),
    ).rejects.toThrow('slack transport failed: {"code":"PROVIDER"}');
  });

  it('reports Better-Notify transport failures without error payloads', async () => {
    const failing: TransportLike = {
      send: vi.fn().mockResolvedValue({ ok: false }),
    };

    await expect(
      deliverNotifications(context, { emailSmtp: mockEmailTransport(), slack: failing }),
    ).rejects.toThrow('slack transport failed: undefined');
  });

  it('requires email subject and html templates when email is enabled', async () => {
    await expect(
      createDeliveryPayloads({
        ...context,
        config: {
          ...context.config,
          success: { email: { text: 'default.text.hbs' } },
        },
      }),
    ).rejects.toThrow('Email notification requires subject and html templates');
  });

  it('requires Slack blocks templates to render JSON arrays', async () => {
    await expect(
      createDeliveryPayloads({
        ...context,
        config: {
          ...context.config,
          success: { slack: { blocks: 'success.subject.hbs' } },
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects Slack blocks templates that render JSON objects instead of arrays', async () => {
    await expect(
      createDeliveryPayloads({
        ...context,
        config: {
          ...context.config,
          templatesDir: 'tests/fixtures',
          success: { slack: { blocks: 'slack-object.json.hbs' } },
        },
      }),
    ).rejects.toThrow('Slack blocks template must render a JSON array');
  });

  it('creates SMTP transport with env-var auth mapping', () => {
    env.SMTP_PASS = 'secret';

    expect(
      createEmailSmtpTransport({
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        secure: true,
        from: 'bot@example.com',
        to: ['ops@example.com'],
        auth: { user: 'bot', passEnvVar: 'SMTP_PASS' },
      }),
    ).toEqual(expect.objectContaining({ send: expect.any(Function) }));
  });

  it('creates SMTP transport without auth env mapping when passEnvVar is absent', () => {
    expect(
      createEmailSmtpTransport({
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        from: 'bot@example.com',
        to: ['ops@example.com'],
        auth: { user: 'bot' },
      }),
    ).toEqual(expect.objectContaining({ send: expect.any(Function) }));
  });

  it('creates Slack transport with env-var token mapping', () => {
    env.SLACK_BOT_TOKEN = 'xoxb-token';

    expect(
      createSlackTransport({
        enabled: true,
        tokenEnvVar: 'SLACK_BOT_TOKEN',
        defaultChannel: '#ops',
        thread: false,
      }),
    ).toEqual(expect.objectContaining({ send: expect.any(Function) }));
  });

  it('creates Slack transport without a default channel when omitted', () => {
    env.SLACK_BOT_TOKEN = 'xoxb-token';

    expect(
      createSlackTransport({
        enabled: true,
        tokenEnvVar: 'SLACK_BOT_TOKEN',
        thread: false,
      }),
    ).toEqual(expect.objectContaining({ send: expect.any(Function) }));
  });

  it('throws when required env vars are missing', () => {
    delete env.MISSING_SLACK_TOKEN;

    expect(() =>
      createSlackTransport({
        enabled: true,
        tokenEnvVar: 'MISSING_SLACK_TOKEN',
        thread: false,
      }),
    ).toThrow('Missing required environment variable MISSING_SLACK_TOKEN');
  });

  it('throws when provider packages do not expose expected transports', async () => {
    expect(() =>
      createEmailSmtpTransport({ ...smtpConfig, auth: { passEnvVar: 'MISSING_SMTP_PASS' } }),
    ).toThrow('Missing required environment variable MISSING_SMTP_PASS');
  });

  it('creates no default transports when every transport is disabled', async () => {
    await expect(
      createDefaultTransports({
        ...config,
        transports: {
          smtp: { ...smtpConfig, enabled: false },
          slack: { ...slackConfig, enabled: false },
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('creates default Better-Notify transports for enabled SMTP and Slack configs', async () => {
    env.SLACK_BOT_TOKEN = 'xoxb-token';

    await expect(createDefaultTransports(config)).resolves.toMatchObject({
      emailSmtp: expect.objectContaining({ send: expect.any(Function) }),
      slack: expect.objectContaining({ send: expect.any(Function) }),
    });
  });

  it('dry-run renders payloads without sending through transports', async () => {
    const email = mockEmailTransport();
    const slack = mockSlackTransport();

    const payloads = await deliverNotifications(
      { ...context, dryRun: true },
      { emailSmtp: email, slack },
    );

    expect(payloads).toHaveLength(2);
    expect(email.sent).toHaveLength(0);
    expect(slack.messages).toHaveLength(0);
    expect(loggerCalls).toContainEqual({
      level: 'info',
      args: [expect.objectContaining({ payloads }), 'dry run enabled, skipping %d sends', 2],
    });
  });
});
