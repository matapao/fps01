// Serves the browser game. The game's own files come from the release in memory (see release.js);
// three.js comes straight from node_modules, so the game needs no build step and no internet
// connection at the party.

import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// URL prefix → folder. The first matching prefix wins.
const MOUNTS = /** @type {[string, string][]} */ ([
  ['/vendor/three/addons/', 'node_modules/three/examples/jsm/'],
  ['/vendor/three/', 'node_modules/three/build/'],
  ['/shared/', 'shared/'],
  ['/data/', 'data/'],
  ['/', 'public/'],
]).map(([prefix, folder]) => /** @type {[string, string]} */ ([prefix, join(ROOT, folder)]));

// The page as the LAN server serves it: its scripts are the game's own modules, not a bundle, so it
// says where three.js is (a zirbel host serves the bundle, three.js inside it).
const IMPORT_MAP = `<script type="importmap">{ "imports": { "three": "/vendor/three/three.module.js", "three/addons/": "/vendor/three/addons/" } }</script>`;

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
};

/** @param {import('./server-types.ts').Release} release */
export function serveFiles(release) {
  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  return async function serve(request, response) {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }

    let path;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      if (path.includes('\0')) throw new Error('Invalid path');
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (path.endsWith('/')) path += 'index.html';

    const mount = MOUNTS.find(([prefix]) => path.startsWith(prefix));
    if (!mount) throw new Error('No static mount for absolute path');
    const [prefix, folder] = mount;
    const file = join(folder, path.slice(prefix.length));
    const within = relative(folder, file);
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      response.writeHead(403).end();
      return;
    }

    const name = relative(ROOT, file).split(sep).join('/');
    /** @type {Buffer | string | null | undefined} */
    let body = name.startsWith('node_modules/')
      ? await readFile(file).catch(() => null)
      : release.files.get(name);
    if (body && name === 'public/index.html')
      body = String(body).replace('<script type="module"', `${IMPORT_MAP}\n    <script type="module"`);
    if (!body) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': Buffer.byteLength(body),
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
}
