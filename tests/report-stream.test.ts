import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);

describe('CLI report capture', () => {
  it('keeps the report byte-for-byte on stdout and dry-run logs on stderr', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'report-stream-'));
    try {
      const config = path.join(cwd, 'config.json');
      await fs.writeFile(
        config,
        JSON.stringify({
          name: 'Synthetic report',
          dryRun: false,
          stdout: { format: 'markdown' },
          transports: {
            smtp: {
              enabled: true,
              host: 'smtp.example.com',
              port: 587,
              from: 'bot@example.com',
              to: ['reader@example.com'],
            },
          },
        }),
      );
      const report = '# Summary\n\nA readable report.\n';
      const { stdout, stderr } = await exec(
        process.execPath,
        [
          '--import',
          path.resolve('node_modules/tsx/dist/loader.mjs'),
          path.resolve('src/run-and-notify.ts'),
          '--config',
          config,
          '--dry-run',
          '--',
          process.execPath,
          '-e',
          `process.stdout.write(${JSON.stringify(report)})`,
        ],
        { cwd, env: { ...process.env, RUN_AND_NOTIFY_LOG_LEVEL: 'info' } },
      );
      expect(stdout).toBe(report);
      expect(stderr).toContain('"level":30');
      // The dry-run notification logs its rendered payloads; assert the report
      // text actually reaches the delivery payload, not just that the HTML shell
      // carries a theme.
      expect(stderr).toContain('A readable report.');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
