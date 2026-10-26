import { isRecord } from '../shared/snapshot-parts.js';
// Builds the game for zirbel as fps01: dist/zirbel/fps01/, a folder any zirbel.host serves as a game
// (zirbel-host --games dist/zirbel), or packs into a catalog bundle. The page, the room's authority
// and the agent modules are each bundled into one file with three.js, minified; /zirbel-net.js stays
// outside, for the host to serve. The blocks (data/), their schemas and the asset catalogue go beside
// them as they are: the game reads its data at run time, so a new revision of the data needs no build.
//
//   npm run zirbel

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = readManifest();
const OUT = join(ROOT, 'dist', 'zirbel', manifest.id); // hosts find a game by its folder's name: the id
const AGENT = ['play', 'look', 'check']; // src/agent/<name>.ts, built to agent/<name>.js for the platform's agents

// The browser's code imports the shared modules as the LAN server serves them (/shared/…).
/** @type {import('esbuild').Plugin} */
const shared = {
  name: 'shared',
  setup(b) {
    b.onResolve({ filter: /^\/shared\// }, (args) => ({ path: join(ROOT, args.path) }));
  },
};

/** @param {string} out */
export async function buildGame(out = OUT) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  /** @type {Record<string, string>} */
  const entryPoints = {
    'js/main': join(ROOT, 'public', 'js', 'main.js'),
    authority: join(ROOT, 'zirbel', 'authority.js'),
  };
  for (const name of AGENT)
    if (existsSync(join(ROOT, 'src', 'agent', `${name}.ts`)))
      entryPoints[`agent/${name}`] = join(ROOT, 'src', 'agent', `${name}.ts`);
  await build({
    entryPoints,
    outdir: out,
    bundle: true,
    format: 'esm',
    target: 'es2020',
    minify: true,
    legalComments: 'linked', // three.js's licence, in js/main.js.LEGAL.txt
    external: ['/zirbel-net.js'],
    plugins: [shared],
    logLevel: 'warning',
  });

  // The page, as it is: its paths are relative, and three.js is in js/main.js.
  const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
  if (/(src|href)="\//.test(html) || html.includes('importmap'))
    throw new Error('index.html must have relative paths and no import map');
  writeFileSync(join(out, 'index.html'), html);
  cpSync(join(ROOT, 'public', 'style.css'), join(out, 'style.css'));
  cpSync(join(ROOT, 'public', 'audio'), join(out, 'audio'), { recursive: true });
  cpSync(join(ROOT, 'public', 'audio.html'), join(out, 'audio.html'));

  // The data, its schemas and the asset catalogue, at the same paths as in the source.
  for (const path of ['data', 'assets', 'zirbel.build.json', 'LICENSE'])
    if (existsSync(join(ROOT, path))) cpSync(join(ROOT, path), join(out, path), { recursive: true });
  mkdirSync(join(out, 'vendor', 'three'), { recursive: true });
  cpSync(join(ROOT, 'node_modules', 'three', 'LICENSE'), join(out, 'vendor', 'three', 'LICENSE'));

  /** @type {unknown} */
  const metadata = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (!isRecord(metadata) || typeof metadata['version'] !== 'string')
    throw new Error('Package has no version');
  manifest['version'] = metadata['version'];
  writeFileSync(join(out, 'zirbel.json'), JSON.stringify(manifest, null, 2) + '\n');

  let bytes = 0;
  let files = 0;
  for (const file of walk(out)) {
    bytes += statSync(file).size;
    files++;
  }
  console.log(
    `built ${relative(ROOT, out)}: ${manifest.title} ${manifest['version']}, ${files} files, ${(bytes / 1024).toFixed(0)} KB`,
  );
}

/** @param {string} dir @returns {Generator<string>} */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildGame();

function readManifest() {
  /** @type {unknown} */
  const value = JSON.parse(readFileSync(join(ROOT, 'zirbel.json'), 'utf8'));
  if (!isRecord(value) || typeof value['id'] !== 'string' || typeof value['title'] !== 'string')
    throw new Error('Invalid game manifest');
  return { ...value, id: value['id'], title: value['title'], version: value['version'] };
}
