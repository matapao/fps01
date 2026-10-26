// Watches the game's code while it runs. When the files change and then stay put for a moment, it
// checks the new version (the server starts, and the browser's scripts parse) and offers it to the
// players, who choose when to switch. index.js does the switch itself.

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { fingerprint } from './release.js';

const run = promisify(execFile);

// offer(version) is called with a new version once it passes the checks, and with null when the
// files change again (or back) so that the version on offer is no longer what's on disk.
/** @param {{root: string, version: string, offer: (version: string | null) => void, log?: (message: string) => void, every?: number, settle?: number}} options */
export function watchForUpdates({ root, version, offer, log = console.log, every = 1000, settle = 1500 }) {
  let seen = version; // the newest version on disk
  let seenAt = 0; // when it showed up
  /** @type {string | null} */
  let offered = null;
  /** @type {Map<string, string | null>} */
  const verdicts = new Map(); // version → null when it's good, or what's wrong with it
  let busy = false;

  function withdraw() {
    if (offered === null) return;
    offered = null;
    offer(null);
  }

  async function poll() {
    const current = await fingerprint(root);
    if (current !== seen) {
      // Probably still being edited: wait until the files settle.
      seen = current;
      seenAt = Date.now();
      withdraw();
      return;
    }
    if (current === version || current === offered || Date.now() - seenAt < settle) return;
    if (!verdicts.has(current)) {
      const problem = await check(root);
      if ((await fingerprint(root)) !== current) return; // changed during the check; check again once it settles
      verdicts.set(current, problem);
      if (problem)
        log(
          `\nThe game's code changed, but the new version has an error, so it isn't offered:\n${problem}\n`,
        );
    }
    if (verdicts.get(current)) return;
    offered = current;
    log(
      '\nA new version is ready. Anyone can press U in the game (or click Update) to switch everyone over.\n',
    );
    offer(current);
  }

  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await poll();
    } catch {
      // A file vanished or moved mid-read; the next poll sees how things ended up.
    } finally {
      busy = false;
    }
  }, every);

  return {
    // The version on offer, if the files on disk still match it, or null.
    async confirm() {
      if (offered === null) return null;
      return (await fingerprint(root).catch(() => null)) === offered ? offered : null;
    },
    stop() {
      clearInterval(timer);
    },
  };
}

// Null when the new version starts and its browser scripts parse, or else what went wrong.
/** @param {string} root */
async function check(root) {
  const entry = JSON.stringify(pathToFileURL(join(root, 'server/index.js')).href);
  // Starts the new server on a spare port, then stops it.
  const boot = `const { startServer } = await import(${entry});
const server = await startServer({ port: 0, host: '127.0.0.1' });
await server.close();
process.exit(0);`;
  const scripts = (await readdir(join(root, 'public'), { recursive: true })).filter((path) =>
    path.endsWith('.js'),
  );
  const runs = [
    ['--input-type=module', '--eval', boot],
    ...scripts.map((path) => ['--check', join(root, 'public', path)]),
  ].map((args) => run(process.execPath, args, { cwd: root, timeout: 20_000 }));
  const failure = (await Promise.allSettled(runs)).find((result) => result.status === 'rejected');
  if (!failure) return null;
  const { stderr, message } = failure.reason;
  return (stderr?.trim() || message).split('\n').slice(0, 8).join('\n');
}
