import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fingerprint, loadRelease } from '../../server/release.js';

test('a release keeps the browser files in memory, and any change to the code changes its version', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'langame-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'package.json': '{}',
    'server/a.js': 'export const a = 1;',
    'src/runtime.ts': 'export const runtime = 1;',
    'shared/b.js': 'export const b = 2;',
    'public/index.html': '<!doctype html>',
    'public/js/c.js': 'export const c = 3;',
    'data/e.json': '{}',
    'test/d.test.js': '',
  };
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }

  const release = await loadRelease(root);
  assert.deepEqual([...release.files.keys()].sort(), [
    'data/e.json',
    'public/index.html',
    'public/js/c.js',
    'shared/b.js',
  ]);
  assert.equal(await fingerprint(root), release.version);

  await writeFile(join(root, 'server/a.js'), 'export const a = 2;');
  assert.notEqual(await fingerprint(root), release.version, 'server code counts');
  await writeFile(join(root, 'server/a.js'), files['server/a.js']);
  assert.equal(await fingerprint(root), release.version, 'undoing the change brings the version back');

  await writeFile(join(root, 'src/runtime.ts'), 'export const runtime = 2;');
  assert.notEqual(await fingerprint(root), release.version, 'portable runtime source counts');
  await writeFile(join(root, 'src/runtime.ts'), files['src/runtime.ts']);
  assert.equal(await fingerprint(root), release.version, 'restoring runtime source restores the version');

  await writeFile(join(root, 'test/d.test.js'), 'changed');
  await writeFile(join(root, 'public/.DS_Store'), 'junk');
  await writeFile(join(root, 'public/js/c.js~'), 'backup');
  assert.equal(await fingerprint(root), release.version, 'tests and editor leftovers do not count');

  await writeFile(join(root, 'public/js/c.js'), 'export const c = 4;');
  assert.equal(
    release.files.get('public/js/c.js').toString(),
    files['public/js/c.js'],
    'the release keeps what it loaded',
  );
});
