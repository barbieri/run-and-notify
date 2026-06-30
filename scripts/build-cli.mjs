import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const BUNDLE_DIR = 'dist/bundle';

const TEMPLATES_DIR = 'src/builtin-templates';
const BUILTIN_TEMPLATES = Object.fromEntries(
  fs
    .readdirSync(TEMPLATES_DIR, { encoding: 'utf-8' })
    .map((file) => [file, fs.readFileSync(path.join(TEMPLATES_DIR, file), { encoding: 'utf-8' })]),
);

await esbuild.build({
  entryPoints: {
    'run-and-notify': 'src/run-and-notify.ts',
  },
  outdir: BUNDLE_DIR,
  outExtension: { '.js': '.mjs' },
  platform: 'node',
  format: 'esm',
  target: 'node24.15.0',
  bundle: true,
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  define: {
    BUILTIN_TEMPLATES: JSON.stringify(BUILTIN_TEMPLATES),
  },
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
      '',
    ].join('\n'),
  },
});

fs.chmodSync(path.join(BUNDLE_DIR, 'run-and-notify.mjs'), 0o755);

console.log(`Wrote minified CLI bundles to ${BUNDLE_DIR}/`);
