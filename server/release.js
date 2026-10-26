// A release is the game's code as it was when the server started: a version (a hash of every
// source file) and the browser's files, kept in memory. Serving from memory means that editing the
// code while people play never hands someone a page that the running server doesn't match.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

// What counts as the game's code, and its data. Tests and docs don't; new dependencies need npm
// install and a restart by hand.
const FOLDERS = ['server', 'shared', 'src', 'public', 'data'];
// The folders the browser loads files from.
const SERVED = ['public/', 'shared/', 'data/'];

/** @param {string} root */
export async function loadRelease(root) {
  const sources = await readSources(root);
  const files = new Map([...sources].filter(([path]) => SERVED.some((folder) => path.startsWith(folder))));
  return { version: versionOf(sources), files };
}

// The version of the code on disk right now.
/** @param {string} root */
export async function fingerprint(root) {
  return versionOf(await readSources(root));
}

/** @param {Map<string, Buffer>} sources */
function versionOf(sources) {
  const hash = createHash('sha256');
  for (const [path, body] of sources) hash.update(`${path}\0${body.length}\0`).update(body);
  return hash.digest('hex').slice(0, 12);
}

// Path (relative to root, with forward slashes) → contents, in a stable order.
/** @param {string} root */
async function readSources(root) {
  const paths = ['package.json'];
  for (const folder of FOLDERS) {
    for (const entry of await readdir(join(root, folder), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && !ignored(entry.name))
        paths.push(relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));
    }
  }
  paths.sort();
  const sources = new Map();
  for (const path of paths) {
    // Editors write temporary files that can vanish between listing and reading.
    const body = await readFile(join(root, path)).catch((error) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    });
    if (body) sources.set(path, body);
  }
  return sources;
}

// Editors and file browsers leave these around; they aren't part of the game.
/** @param {string} name */
function ignored(name) {
  return name.startsWith('.') || name.endsWith('~');
}
