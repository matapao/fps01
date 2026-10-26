import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

test('the authority bundles for a browser without the renderer or LAN I/O', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../zirbel/authority.js', import.meta.url))],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
    external: ['/zirbel-net.js'],
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some((path) => path.endsWith('server/game.js')));
  assert.ok(
    inputs.every((path) => !path.includes('public/js/') && !path.includes('node_modules/')),
    'the authority owns rules, not rendering or transport dependencies',
  );
});
