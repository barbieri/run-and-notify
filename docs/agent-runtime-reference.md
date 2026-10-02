# Runtime and product reference

Consult this reference when changing command behavior, formats, templates, config, transports, delivery, or packaging. Keep durable behavior documented here.

## Project overview

`run-and-notify` changes to the given `--cwd=/path` (if any), executes the command and then uses https://better-notify.com/ to send the output via multiple channels.

If the process succeeds, then we'll use the `success` object to determine the templates for each channel. If it fails (non-zero output), it will use `error`, which also lists the templates for each channel.

The command execution captures stdout and stderr as complete strings, then parses them by format. Optionally it understands and parses the following formats for both `--stdout.format` and `--stderr.format` (both defaults to `raw`):
- `jsonl`: json lines, each line will be parsed to JSON, if it fails then a line in the shape: `{"raw": "<LINE HERE>"}` is created. The template object will be: `{"lines": [{"someKey": "parsed line here"}, {"raw": {"unparsed line"}}]}`
- `pino`: json lines with Pino log fields. Each valid object is exposed unchanged under `lines`; invalid or non-object lines are wrapped as `{"raw": "<LINE HERE>"}`. Built-in templates derive display labels/colors from `level`, use `msg` as the main text, format `time` as a localized date and short time, and render non-core fields as an indented object.
- `markdown`: the whole output is converted into a single `{"markdown": "all lines concatenated"}`
- `html`: the whole output is converted into a single `{"html": "all lines concatenated"}`
- `raw`: the whole output is converted into a single `{"raw": "all lines concatenated"}`

The templates will be processed using [handlebars](https://handlebarsjs.com/api-reference/) with a context containing three objects: `config`, `stdout` and `stderr`, the `status` (process exit code), as well as the following helpers to aid formatting:
- `dateFromISO8601`: parse the Date object from ISO8601 and formats to a localized date (using config's `locale`)
- `timeFromISO8601`: parse the Date object from ISO8601 and formats to a localized time (using config's `locale`)
- `datetimeFromISO8601`: parse the Date object from ISO8601 and formats to a localized date and time (using config's `locale`)
- `dateFromUnixEpoch`: parse the Date object from the number of seconds since UNIX epoch and formats to a localized date (using config's `locale`)
- `timeFromUnixEpoch`: parse the Date object from the number of seconds since UNIX epoch and formats to a localized time (using config's `locale`)
- `datetimeFromUnixEpoch`: parse the Date object from the number of seconds since UNIX epoch and formats to a localized date and time (using config's `locale`)
- `datetimeFromUnixEpochMilliseconds`: parse a number of milliseconds since UNIX epoch and format to a localized date and short time (using config's `locale`)
- `markdownToHtml`: converts the value from Markdown to HTML.
- `htmlToMarkdown`: converts the HTML to Markdown.
- `rawToHtml`: converts the value from raw text to HTML, escaping symbols such as `<`, `>`, `&`.

The configuration file defines values to be used by default, they can be overridden using the command line flags, that are processed using `yargs`. The configuration is defined by a strictly typed JSON schema at `schemas/config.schema.json`. The command line override of config should use `--NAME=VALUE`, where `NAME` is the [lodash.set](https://lodash.com/docs/4.17.15#set) path (we use that function to set). The command line parser should build options directly from the JSON schema, using each field's `description` and `default` for help output. The target command is a native yargs variadic positional argument; options after the command are target command arguments.

CLI overrides are prevalidated against yargs' registered option table from `getOptions()` before yargs parses them; unknown nested keys such as `--stdout.does-not-exist` must fail with `Unknown argument: stdout.does-not-exist`.

The repository must always provide configurations for different formats, in order to simplify the examples assume both stderr and stdout use the same format:
- `jsonl`: use a template that nicely formats to markdown as a list. If more than one key in the object, then add the field name in bold followed by `:` and then the value, with sub bullets for the each key.
- `markdown`: convert to HTML.
- `html`: convert to Markdown.
- `raw`: convert to HTML.

Keep meaningful coverage for each supported output format and template helper.
Add a test only when existing tests do not prove the behavior or regression.

Example workflows live under `examples/<workflow>/` with a complete `config.json` and local templates, and sample target commands live under `examples/apps/`. Test each distinct workflow behavior by executing the sample app through Better-Notify mock transports. Do not add a duplicate test solely because a new example has the same behavior.

The templates are always referenced as filenames, which are dynamically loaded by the tool. Templates can use partials.

Template rendering first registers built-in Handlebars templates from `src/builtin-templates.ts`, then overlays files from `templatesDir` when configured; all `.hbs` files in that directory are registered as partials by basename, and underscore-prefixed partials are also registered without the underscore.

Built-in output templates are format-aware: email renders `raw` as escaped `<pre>`, `markdown` as HTML, `html` as provided HTML, `jsonl` as itemized records, and `pino` as level-colored log cards; Slack renders Markdown through `markdown-to-slack-blocks`, splits large block batches, separates execution context with a divider, renders `raw` as preformatted rich text, `markdown` as Slack blocks, `html` converted to markdown, `jsonl` as nested itemized records, and `pino` as level/msg bullets with indented fields.

Built-in templates live as maintainable `.hbs` files under `src/builtin-templates/` and are imported by `src/builtin-templates.ts` with `with { type: "text" }`; esbuild must keep `.hbs` configured with the `text` loader, and development/test code keeps a filesystem fallback for those files.

Config defines [transports](https://better-notify.com/docs/transports), by default smtpTransport() and slackTransport(). Sensitive information (passwords, tokens) should be read from environment variables defined in the configuration that will have a `EnvVar` suffix: Example:

```json
    "smtp": {
      "host": "smtp.example.com",
      "port": 587,
      "auth": {
        "user": "username",
        "passEnvVar": "SMTP_PASS",
      },
    }
```

```js
    // Produces this:
    smtpTransport({
      host: 'smtp.example.com',
      port: 587,
      auth: {
        user: 'username',
        pass: process.env.SMTP_PASS,
      },
    })
```

Environment variables loaded from local `.env` by `dotenv` are for `run-and-notify` provider setup only and must be omitted from the spawned target command environment. `main()` snapshots `process.env` before `parseCli()` loads dotenv and uses that snapshot for the child command. Variables already present before `run-and-notify` starts are explicit user environment and remain propagated to the child command.

Only JSON-compatible configuration options should exist when converting from each Better Notify TypeScript to JSON Schema (ie: no `onError`, `onRetry`...).

If no transport is enabled or transport setup fails, then the `run-and-notify` binary should exit with status 1 before executing the target command. If transports fail while sending, it should also exit with status 1.

By default the binary propagates the target command exit status after notifications are delivered. `propagateExitCode: false` or `--no-propagate-exit-code` makes command failures return `0` when notification delivery succeeds; transport/rendering failures still return `1`.

SMTP delivery uses `@betternotify/smtp` `smtpTransport()`. Slack delivery uses `@betternotify/slack` `slackTransport()` with `tokenEnvVar` and optional `defaultChannel`; use existing Better-Notify transports and channels unless a provider does not exist.

`transports.slack.unfurlLinks` and `transports.slack.unfurlMedia` are optional booleans proxied onto every Slack delivery payload as `unfurlLinks` / `unfurlMedia` for `@betternotify/slack` (mapped to Slack `unfurl_links` / `unfurl_media`). Omit them to leave Slack defaults; set both to `false` to disable classic link/media previews.

During config load (`parseConfig` / `parseCli`), normalize `transports.smtp.to`, `cc`, and `bcc` from string or string[] to `string[]`; normalize `transports.slack.thread` to a boolean (defaults to `false`). When `transports.slack.thread` is `true`, delivery sends a parent Slack message with fallback text only, then replies with blocks and injects the parent message `ts` as `threadTs` on subsequent Slack sends.

Config defines [channels](https://better-notify.com/docs/concepts/channels). The input will always be the config, stdout and stderr objects that are needed to render the templates. Each channel will check the stdout/stderr formats in order to define how to format the final payload, for instance Slack will render `blocks()` with sections using the `type: "mrkdwn"` and fenced code blocks for command output/error bodies. Email will always format to HTML using an user-configurable template, by default it will just format each block, checking config.showStderrIfSuccess before formatting the stderr.

Email templates support `subject`, `html`, and `text`; Slack templates support `blocks` plus an optional `text` fallback template. When Slack `text` is omitted, success fallback text is `config.name` and failure fallback text is `Failed: {name} (status {code})`. Template defaults live in the schema and point at built-in template filenames, so `templatesDir` can be omitted for the default behavior.

The config.showStderrIfSuccess that will toggle whenever `stderr` is formatted at all if process exit 0, it's `false` by default and no stderr is used if everything went fine.

The config.hideCommandIfSuccess flag defaults to `false`; when `true`, built-in success templates render only output content and omit command metadata blocks, visible separators, and the `Output` heading. Failures always keep command metadata visible.

The command execution does not support any kind of sandboxing. It must enforce a configurable timeout (in seconds) if given and `>0`.

`--help` and `-h` must render help and exit before loading or validating configuration, so a missing or invalid config file cannot break help output.

`--dry-run` still requires enabled transport configuration, executes and renders normally, logs the delivery payloads with Pino, skips Better-Notify `send()` calls, and returns the command status unless rendering fails.

Configuration/schema code imports `schemas/config.schema.json` directly for standalone bundling. Do not read the schema from disk at runtime.

When loading optional files such as `config.json`, read directly and handle `ENOENT`; do not preflight with file-existence checks because that introduces a TOCTOU race.

Output formatters live in `src/formatters/*` and are selected through a dispatcher object. Avoid manual switch/case parsing for new output formats.

Transport instances are split by provider in `src/transports/*`; SMTP email is scoped as `emailSmtp`/`email-smtp` rather than generic `email`.

Delivery payload construction is split by provider in `src/delivery/*`; keep `src/delivery.ts` as the public facade for `createDeliveryPayloads`, `createDefaultTransports`, and `deliverNotifications`.

Use Pino structured logs with placeholders (`%s`, `%o`, etc.) and positional parameters. Do not interpolate log message strings.

When rendering command lines or cwd values in templates, use `shellCommand command` and `shellToken cwd`. Command arguments are space-delimited; values containing whitespace are wrapped in single quotes with embedded single quotes escaped for shell copy/paste.

Use `slackCodeBlock` in Slack block templates whenever rendering command output or error bodies.
