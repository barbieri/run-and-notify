import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

const pathExists = (path) => {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

/** Husky only when developing from a git clone (not on npm install of the published package). */
if (pathExists('.git') && pathExists('node_modules/husky/package.json')) {
  const result = spawnSync('husky', { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
