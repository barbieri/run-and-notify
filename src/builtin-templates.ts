import fs from 'node:fs';

declare const BUILTIN_TEMPLATES: Record<string, string> | undefined; // only set by esbuild

let bundled: Record<string, string> | undefined;
try {
  bundled = BUILTIN_TEMPLATES; // only set by esbuild
} catch {}

export const templateSource = (filename: string): string => {
  /* v8 ignore start -- this is only true when running the esbuild version */
  const template = bundled?.[filename];
  if (template) {
    return template;
  }
  /* v8 ignore stop */

  // fallback when running directly via node --import=tsx
  return fs.readFileSync(new URL(`./builtin-templates/${filename}`, import.meta.url), 'utf8');
};

export const builtinTemplates = Object.fromEntries(
  [
    '_output-html.hbs',
    '_output-text.hbs',
    'default.email.html.hbs',
    'default.text.hbs',
    'default.slack.blocks.json.hbs',
    'success.slack.text.hbs',
    'error.slack.text.hbs',
    'success.subject.hbs',
    'error.subject.hbs',
  ].map((filename) => [filename, templateSource(filename)]),
);
