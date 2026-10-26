// One reproducible local/CI gate. Builds use a temporary directory and cannot replace a release.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGame } from './build.js';

const root = fileURLToPath(new URL('..', import.meta.url));
/** @param {string[]} args */
const run = (...args) => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });

for (const folder of ['server', 'shared', 'public', 'zirbel', 'tools', 'test']) {
  for (const entry of readdirSync(join(root, folder), { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) run('--check', join(entry.parentPath, entry.name));
  }
}
console.log('JavaScript syntax checked.');
run('node_modules/typescript/bin/tsc', '--noEmit', '-p', '.');
run('node_modules/typescript/bin/tsc', '-p', 'tsconfig.checked-js.json');
run('node_modules/typescript/bin/tsc', '-p', 'tsconfig.checked-js.node.json');
run('node_modules/typescript/bin/tsc', '-p', 'tsconfig.checked-js.portable.json');
run('--test', '--test-concurrency=2', '--test-timeout=60000');
const temp = mkdtempSync(join(tmpdir(), 'fps-check-'));
try {
  await buildGame(join(temp, 'fps01'));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log('All quality checks passed.');
