# run-and-notify

`run-and-notify` executes a command, captures stdout and stderr, renders Handlebars templates, and sends the result through Better-Notify transports. The default configuration targets SMTP email and Slack.

## Install

```bash
pnpm install
pnpm run build
```

Run a command by placing it after the run-and-notify options:

```bash
run-and-notify --config=config.json --stdout.format=jsonl pnpm run test
```

Configuration values can be overridden with dotted CLI flags such as `--cwd=/repo`, `--stdout.format=markdown`, `--dry-run`, `--no-propagate-exit-code`, or `--transports.smtp.enabled=false`. The command is a native yargs positional argument; options after the command are passed to the target command, and `--help` documents defaults from the JSON schema.

## Configuration

The canonical schema is [schemas/config.schema.json](./schemas/config.schema.json). `config.example.json` shows a complete SMTP and Slack setup.

Top-level fields:

- `name`: human-readable automation name used in default notification titles and subjects.
- `locale`: BCP 47 locale used by date and time helpers.
- `cwd`: optional working directory for the command.
- `dryRun`: when `true`, renders and logs notification payloads without sending them.
- `propagateExitCode`: when `true`, the CLI exits with the target command status after notifications are delivered. Defaults to `true`.
- `timeoutSeconds`: command timeout in seconds; `0` disables the timeout.
- `showStderrIfSuccess`: when `false`, success templates skip stderr unless they explicitly ignore this field.
- `hideCommandIfSuccess`: when `true`, success templates hide command metadata, visible separators, and the `Output` heading so only output content remains. Defaults to `false`.
- `templatesDir`: optional directory containing Handlebars templates and partials. When omitted, built-in templates bundled into the CLI are used.
- `stdout`: stdout parser settings.
- `stderr`: stderr parser settings.
- `transports`: Better-Notify transport settings.
- `success`: templates used when the command exits with status `0`.
- `error`: templates used when the command exits with a non-zero status.

`stdout.format` and `stderr.format` accept:

- `raw`: exposes `{ "format": "raw", "raw": "..." }`.
- `jsonl`: parses each line as JSON and wraps invalid lines as `{ "raw": "..." }`.
- `markdown`: exposes `{ "format": "markdown", "markdown": "..." }`.
- `html`: exposes `{ "format": "html", "html": "..." }`.
- `pino`: parses each line as a Pino JSON log record and exposes valid objects unchanged in `lines`; invalid or non-object lines are wrapped as `{ "raw": "..." }`. Built-in templates derive display labels/colors from `level`, use `msg` as the main text, format `time` as a localized date and short time, and render non-core fields as an indented object.

Only `jsonl` and `pino` expose `lines`. `raw`, `markdown`, and `html` preserve the full stream as a single string.

`transports.smtp` fields:

- `enabled`: enables SMTP email delivery.
- `host`: SMTP host.
- `port`: SMTP port, from `1` to `65535`.
- `secure`: use TLS from connection start.
- `from`: sender email address.
- `to`: one or more recipient email addresses (accepts a string or an array of strings).
- `cc`: optional CC recipient email addresses (accepts a string or an array of strings).
- `bcc`: optional BCC recipient email addresses (accepts a string or an array of strings).
- `auth.user`: optional SMTP username.
- `auth.passEnvVar`: environment variable containing the SMTP password.

The SMTP email delivery instance is scoped internally as `emailSmtp`/`email-smtp`, so future email transports can be added without overloading a generic email channel name.

`transports.slack` fields:

- `enabled`: enables Slack delivery through `@betternotify/slack`.
- `tokenEnvVar`: environment variable containing the Slack bot token passed to `slackTransport()`.
- `defaultChannel`: optional Slack channel ID or name used when the rendered payload does not set `to`.
- `thread`: when `true`, subsequent notifications are sent as replies inside a dedicated thread under the first notification. Defaults to `false`.

Template fields under `success.email` and `error.email`:

- `subject`: email subject template filename.
- `html`: email HTML template filename.
- `text`: plain text email template filename.

Template fields under `success.slack` and `error.slack`:

- `text`: optional Slack fallback text template filename. When omitted, success fallback text is `config.name`; failure fallback text is `Failed: {name} (status {code})`.
- `blocks`: Slack blocks template filename; it must render a JSON array. Slack fallback text uses the `text` template when configured, otherwise the defaults above.

By default, `success` and `error` use built-in email and Slack templates. You can override any template with config or CLI flags such as `--success.email.html=custom-success.html.hbs`.

## Templates

Templates are loaded from `templatesDir` and may use partials from the same directory. If `templatesDir` is omitted, templates are loaded from built-ins imported into the bundled CLI. Built-in templates are registered first, so custom template directories may override any built-in by filename while still using built-in partials. The rendering context contains `config`, `stdout`, `stderr`, `status`, `command`, `cwd`, `timedOut`, `executedAt`, and `dryRun`.

Built-in email templates render `raw` as escaped preformatted text, `markdown` as HTML, `html` as provided HTML, `jsonl` as itemized records, and `pino` as level-colored log cards with extra fields indented. Built-in Slack block templates render Markdown through `markdown-to-slack-blocks`, split large block batches before sending, separate execution context with a divider when command metadata is visible, render `raw` as preformatted rich text, render `markdown` as Slack blocks, convert `html` to Markdown first, render `jsonl` as nested itemized records, and render `pino` as level/msg bullets with indented Pino fields.

Registered helpers:

- `dateFromISO8601`, `timeFromISO8601`, `datetimeFromISO8601`, `datetimeFromUnixEpochMilliseconds`
- `dateFromUnixEpoch`, `timeFromUnixEpoch`, `datetimeFromUnixEpoch`
- `markdownToHtml`, `htmlToMarkdown`, `rawToHtml`
- `escapeHtml`, `escapeMarkdown`, `json`, `jsonValue`, `jsonString`, `concat`, `outputToSlack`, `slackCodeBlock`, `hasOutput`, `hideCommandIfSuccess`
- `shellCommand`, `shellToken`: formats command arrays and paths with space-delimited shell-friendly output, single-quoting values that contain whitespace.

## Environment

Copy `.env.example` when developing locally. The default examples reference these variables:

- `SMTP_PASS`: password used by `transports.smtp.auth.passEnvVar`.
- `SLACK_BOT_TOKEN`: token used by `transports.slack.tokenEnvVar`.

Variables loaded from the local `.env` file are used by `run-and-notify` itself, but are omitted from the target command environment so local provider secrets are not leaked to child processes by default. Variables that already exist before `run-and-notify` starts, such as an explicitly exported `SMTP_PASS`, `SLACK_BOT_TOKEN`, `LOG_LEVEL`, or any other environment variable, are still propagated to the child command.

## Examples

Complete example configurations and templates live under `examples/<name>/`, with sample target commands under `examples/apps/`.

- `full-raw`: raw stdout and stderr, including command metadata and execution timestamp.
- `minimal`: only transport configuration; uses parser, notification, and built-in template defaults.
- `full-markdown`: markdown stdout and stderr with fenced code blocks.
- `full-html`: HTML stdout and stderr, converted to markdown and wrapped in Slack code blocks.
- `daily-digest-markdown`: markdown success digest; failure renders JSONL pino stderr lines.
- `daily-digest-html`: HTML success digest; failure renders JSONL pino stderr lines.
- `structured-jsonl-markdown`: structured JSONL stdout rendered as markdown.
- `structured-jsonl-html`: structured JSONL stdout rendered as HTML.

## Exit Codes

If the command succeeds and notifications are delivered, `run-and-notify` exits `0`. If the command fails, notifications use the `error` templates and the CLI exits with the command status by default. Set `propagateExitCode` to `false`, pass `--propagateExitCode=false`, or pass `--no-propagate-exit-code` to return `0` after successful notification delivery even when the target command failed. If no transport is enabled, transport setup fails, or delivery through any configured transport fails, the CLI exits `1`; the target command is not executed unless at least one transport is ready.

Timed out commands are terminated and reported with status `124`.

`--dry-run` still requires enabled transport configuration, executes the target command, and renders provider payloads, but skips `send()` calls and logs what would have been sent.

## Development

```bash
pnpm run qa
```

The QA gate runs Biome checks, build, tests, and typecheck.
