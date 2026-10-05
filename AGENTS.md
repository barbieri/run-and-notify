# AGENTS.md — run-and-notify

This file is the canonical guide for humans and coding agents working in this repository. Keep it accurate.

## Self-update protocol (required)

Record durable project behavior in its owning documentation source. Runtime and product details live in [the runtime reference](./docs/agent-runtime-reference.md); keep this file focused on agent workflow, QA, and navigation.

Read the runtime reference before changing command execution, output formats,
templates, transports, configuration behavior, or packaging.

Before finishing a task that changes config behavior, check that [README.md](./README.md) documents every field and constraint in `schemas/config.schema.json`. Treat the schema as canonical.

## Agent workflow and PR readiness

- For nontrivial implementation, load `.agents/skills/poteto-mode/SKILL.md` before work and run `.agents/skills/thermos/SKILL.md` before handoff. Review a PR against its merge-base with `.agents/skills/code-review/SKILL.md` when an originating spec exists. Its GitHub issue source is `docs/agents/issue-tracker.md`.
- For Codex, use native subagents for upstream `Task` roles. In Thermos,
  give one reviewer `.agents/skills/thermo-nuclear-review/SKILL.md` and another
  `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md`, then synthesize
  their findings.
- Before publishing, inspect every commit and the final diff. Fold a correction to code introduced earlier on this branch into the introducing commit with a fixup and autosquash. Keep an independent improvement or a fix to base-branch code as a separate commit. Use `.agents/skills/git-history-cleanup/SKILL.md` for a private linear series that needs broader regrouping.
- Add a test only when it proves distinct behavior or a regression that existing tests do not cover. Keep existing QA and coverage gates.
- After a failed check, PR review, or chat feedback, reflect on any durable lesson and update its owning documentation in the relevant original commit. Use `.agents/skills/reflect/SKILL.md` when its trigger applies. Never self-update non-owned installed skills under `~/.agent/skills/`, `~/.agents/skills/`, or project `.agents/skills/` tracked by a skill lock. For owned skills, edit source in `barbieri-playground/skills`, open a PR for Gustavo to review, and update consumers only after merge.

## Tooling

- **Node** see `.nvmrc`
- **TypeScript** `tsconfig.json` extends `@tsconfig/strictest` with `"types": ["node"]`
- **pnpm** via Corepack (`packageManager` pins the version)
- **Biome** — formatting and lint (`biome.json`: JavaScript/TypeScript **single quotes**)
- **Vitest** — run `pnpm run test`. Runtime source coverage is enforced at 100% statements/branches/functions/lines.
- **Pino** — used for structured CLI logs, including dry-run payload inspection.
- Tests mock `src/logger.ts` globally through `tests/setup-env.ts`; warn/error/fatal log calls are part of the tested contract when functions emit them.

## Formatting and QA (required before finishing work)

- **Quotes**: TypeScript/JavaScript use **single quotes** (`javascript.formatter.quoteStyle: "single"` in `biome.json`). JSON config/schema files keep standard double-quoted JSON.
- **Check locally**: run `pnpm run qa` (runs `check`, `build`, `test`, `typecheck` in parallel). Fix all issues before calling the task done.
- **Auto-fix**: `pnpm run check:fix` applies Biome format + safe lint fixes; re-run `pnpm run qa` after.
- **Pre-commit**: Husky runs `pnpm run qa` — do not commit with failing QA.
- Agents must run `pnpm run qa` after their changes and fix any failures before handing work back.

## JSON and validation

- All machine-readable artifacts are **JSON**, pretty-printed with 2-space indent and trailing newline.
- Validate with **Ajv** against `schemas/*.schema.json` before persisting.
- `config.example.json` is checked in tests against `schemas/config.schema.json`.

## Code conventions

- ESM (`"type": "module"`), `.js` extensions in TypeScript imports.
- Minimize scope of changes; match existing style (Biome-formatted, single quotes in `.ts`).
- Do not commit secrets, `tmp/`, or browser profile data.
- Do not reinvent helpers exported by [lodash](https://lodash.com/docs/).
- Command line parsing should use [yargs](https://yargs.js.org/docs/), do not introduce custom parsers on top.

## Commands

```bash
pnpm install
pnpm run qa             # required gate: check + build + test + typecheck
pnpm run build          # tsc + minified CLI bundles (dist/bundle/*.mjs)
pnpm run build:cli      # esbuild only (minified CLI bundle)
pnpm run check          # biome check --error-on-warnings
pnpm run check:fix      # biome check --write --error-on-warnings
pnpm run typecheck
pnpm run test
```

## npm publish

- **`prepublishOnly`** runs `pnpm run build` (minified `dist/bundle/*.mjs` with shebangs).
- `scripts/build-cli.mjs` must keep `dist/bundle/run-and-notify.mjs` executable (`755`) because it is the npm `bin` target.
- **`files`** ships bundles, `schemas/`, examples, and docs only (no `src/` or dev tooling).
- **`bin`**: `run-and-notify` → `dist/bundle/*.mjs`.
- **`prepare`** runs Husky only in a git clone with dev deps, not on end-user `npm install`.
