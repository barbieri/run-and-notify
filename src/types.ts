export type OutputFormat = 'raw' | 'jsonl' | 'markdown' | 'html' | 'pino';

export type OutputConfig = {
  format: OutputFormat;
};

export type EmailTemplateSet = {
  subject?: string;
  html?: string;
  text?: string;
};

export type SlackTemplateSet = {
  text?: string;
  blocks?: string;
};

export type NotificationConfig = {
  email?: EmailTemplateSet;
  slack?: SlackTemplateSet;
};

export type SmtpConfig = {
  enabled: boolean;
  host: string;
  port: number;
  secure?: boolean;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  auth?: {
    user?: string;
    passEnvVar?: string;
  };
};

export type SlackConfig = {
  enabled: boolean;
  tokenEnvVar: string;
  defaultChannel?: string;
  thread: boolean;
};

export type RunAndNotifyConfig = {
  name: string;
  locale: string;
  cwd?: string;
  dryRun: boolean;
  propagateExitCode: boolean;
  timeoutSeconds: number;
  showStderrIfSuccess: boolean;
  hideCommandIfSuccess: boolean;
  templatesDir?: string;
  stdout: OutputConfig;
  stderr: OutputConfig;
  transports: {
    smtp?: SmtpConfig;
    slack?: SlackConfig;
  };
  success: NotificationConfig;
  error: NotificationConfig;
};

export type ParsedOutput =
  | {
      format: 'raw';
      raw: string;
    }
  | {
      format: 'markdown';
      markdown: string;
    }
  | {
      format: 'html';
      html: string;
    }
  | {
      format: 'jsonl';
      lines: Array<Record<string, unknown>>;
    }
  | {
      format: 'pino';
      lines: PinoLogLine[];
    };

export type PinoLogLine = Record<string, unknown> & {
  level?: unknown;
  time?: unknown;
  pid?: unknown;
  hostname?: unknown;
  msg?: unknown;
};

export type CommandResult = {
  command: string[];
  cwd: string;
  status: number;
  signal?: NodeJS.Signals;
  timedOut: boolean;
  elapsedSeconds: number;
  executedAt: string;
  stdout: ParsedOutput;
  stderr: ParsedOutput;
};

export type TemplateContext = {
  config: RunAndNotifyConfig;
  stdout: ParsedOutput;
  stderr: ParsedOutput;
  status: number;
  command: string[];
  cwd: string;
  timedOut: boolean;
  executedAt: string;
  dryRun: boolean;
};

export type EmailPayload = {
  from: string;
  to: Array<{ email: string }>;
  cc?: Array<{ email: string }>;
  bcc?: Array<{ email: string }>;
  subject: string;
  html: string;
  text?: string;
};

export type SlackPayload = {
  text: string;
  blocks?: unknown[];
  to?: string;
  threadTs?: string;
};

export type DeliveryPayload =
  | {
      channel: 'emailSmtp';
      payload: EmailPayload;
    }
  | {
      channel: 'slack';
      payload: SlackPayload;
    };

export type TransportLike = {
  send(rendered: unknown, context: Record<string, unknown>): Promise<unknown>;
};
