/** Verify that every maintained application/tool JavaScript module enters a real strict compiler gate. */
import { isRecord } from '../shared/snapshot-parts.js';
import { readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const profiles = ['tsconfig.checked-js.json', 'tsconfig.checked-js.node.json'];
const covered = new Set();
for (const profile of profiles) {
  /** @type {unknown} */
  const result = JSON.parse(
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', profile, '--showConfig'], {
      cwd: root,
      encoding: 'utf8',
    }),
  );
  assert.ok(isRecord(result), `${profile} must resolve a compiler configuration`);
  const options = result['compilerOptions'];
  assert.ok(isRecord(options), `${profile} must resolve compiler options`);
  assert.equal(options['allowJs'], true, `${profile} must include JavaScript source`);
  assert.equal(options['checkJs'], true, `${profile} must check JavaScript source`);
  const files = result['files'];
  assert.ok(
    Array.isArray(files) && files.every((file) => typeof file === 'string'),
    `${profile} must resolve an explicit compiler file set`,
  );
  for (const file of files) covered.add(relative(root, resolve(root, file)).replaceAll('\\', '/'));
}
const owned = ['shared', 'server', 'public/js', 'zirbel', 'tools'].flatMap((dir) =>
  readdirSync(new URL('../' + dir + '/', import.meta.url), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(?:js|mjs)$/.test(name))
    .map((name) => dir + '/' + name),
);
assert.deepEqual(
  owned.filter((name) => !covered.has(name)).sort(),
  [],
  'Every maintained JavaScript module must be included in a strict compiler gate.',
);
console.log(`JavaScript coverage gate: all ${owned.length} maintained modules are checked.`);
