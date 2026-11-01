// better-sqlite3 is compiled for Electron's Node ABI (see postinstall), so the
// tests run inside Electron acting as plain Node rather than the system Node.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));

const { status } = spawnSync(electron, [vitest, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(status ?? 1);
