import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
/** Verify active tooling choices against the shared contract; never installs or rewrites files. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Use Node 24 or newer (nvm use).');

const root = new URL('../../', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
assert.deepEqual(await json('.prettierrc.json'), await json('docs/engineering/prettier.json'));
assert.equal(
  await readFile(new URL('.editorconfig', root), 'utf8'),
  await readFile(new URL('docs/engineering/editorconfig', root), 'utf8'),
);
assert.equal((await readFile(new URL('.nvmrc', root), 'utf8')).trim(), '24');
const manifest = await json('package.json');
assert.equal(manifest.engines.node, '>=24');
const versions = {
  typescript: '7.0.2',
  prettier: '3.9.10',
  esbuild: '0.28.2',
  '@types/node': '24.19.2',
  three: '0.186.1',
  '@types/three': '0.186.0',
  ws: '8.22.0',
  '@types/ws': '8.18.2',
  'puppeteer-core': '25.14.0',
};
for (const [name, version] of Object.entries(versions)) {
  const actual = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
  if (actual !== undefined) assert.equal(actual, version, `${name}: align the owning manifest and lockfile`);
}
assert.ok(manifest.scripts.format.includes('docs/engineering/style.mjs'));
assert.ok(manifest.scripts['format:check'].includes('docs/engineering/style.mjs'));
console.log('Shared tooling: active formatter, editor, Node baseline and dependency versions agree.');

const lock = await json('package-lock.json');
assert.equal(lock.lockfileVersion, 3);
assert.deepEqual(lock.packages[''].dependencies ?? {}, manifest.dependencies ?? {});
assert.deepEqual(lock.packages[''].devDependencies ?? {}, manifest.devDependencies ?? {});
const profiles = await json('docs/engineering/strict-profiles.json');
const baseline = (await json('docs/engineering/tsconfig.portable.json')).compilerOptions;
const tsc = fileURLToPath(new URL('node_modules/typescript/bin/tsc', root));
// Required profiles are a floor. Newly added adapter/build profiles must keep the same flags.
const ownedRoots = {
  zirbel: ['packages', 'tools'],
  fps01: ['public/js', 'server', 'shared', 'src', 'test', 'tools', 'zirbel'],
  browserdefense: ['src', 'server', 'scripts'],
  derby01: ['src', 'test', 'tools'],
};
const selected = new Set(profiles[manifest.name] ?? []);
const excluded = new Set(['node_modules', 'dist', 'vendor', '.git', 'fixtures']);
async function discoverProfiles(directory, recurse) {
  let entries;
  try {
    entries = await readdir(new URL(directory + '/', root), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = directory === '.' ? entry.name : directory + '/' + entry.name;
    if (entry.isFile() && /^tsconfig(?:\.[^.]+)*\.json$/.test(entry.name)) selected.add(path);
    else if (recurse && entry.isDirectory() && !excluded.has(entry.name)) await discoverProfiles(path, true);
  }
}
await discoverProfiles('.', false);
for (const directory of ownedRoots[manifest.name] ?? []) await discoverProfiles(directory, true);
for (const profile of [...selected].sort()) {
  const resolved = JSON.parse(
    execFileSync(process.execPath, [tsc, '--showConfig', '-p', profile], {
      cwd: fileURLToPath(root),
      encoding: 'utf8',
    }),
  ).compilerOptions;
  for (const [flag, value] of Object.entries(baseline)) {
    if (typeof value === 'boolean' && flag !== 'skipLibCheck')
      assert.equal(resolved[flag], value, `${profile}: ${flag}`);
  }
}
assert.ok(profiles[manifest.name]?.length, 'Every project must declare its strict compiler profiles');
console.log(
  `Shared strict profiles (${selected.size}) and npm lockfile declarations agree with the active project.`,
);

// The canonical build and both consumer installs must match the same distributable.
const browserRef = manifest.devDependencies?.['@zirbel/engineering'];
if (browserRef !== undefined) {
  const artifact = await json('docs/engineering/browser-package.json');
  const digest = async (path, algorithm, encoding) =>
    createHash(algorithm)
      .update(await readFile(new URL(path, root)))
      .digest(encoding);
  let packageRoot;
  if (browserRef.startsWith('file:')) {
    assert.equal(browserRef, `file:${artifact.archive}`);
    assert.equal('sha512-' + (await digest(artifact.archive, 'sha512', 'base64')), artifact.integrity);
    assert.equal(lock.packages['node_modules/@zirbel/engineering'].integrity, artifact.integrity);
    packageRoot = 'node_modules/@zirbel/engineering/';
  } else {
    assert.equal(browserRef, artifact.version);
    packageRoot = 'packages/engineering/';
  }
  const owner = await json(packageRoot + 'package.json');
  assert.equal(owner.name, artifact.name);
  assert.equal(owner.version, artifact.version);
  assert.equal(owner.dependencies['puppeteer-core'], versions['puppeteer-core']);
  for (const [file, expected] of Object.entries(artifact.files)) {
    assert.equal(
      await digest(packageRoot + file, 'sha256', 'hex'),
      expected,
      `${file}: rebuild and synchronize the shared browser package`,
    );
  }
  console.log('Shared browser build, archive and installed consumer integrity agree.');
}
