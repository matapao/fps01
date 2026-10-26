import { isRecord } from '../shared/snapshot-parts.js';
// npm start runs this. It starts the game server (index.js), and starts it again when the players
// switch to a new version of the code, or if it crashes, passing everyone's score along.
// Changes to this file itself only take effect when you stop the game and start it again.

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('./index.js', import.meta.url));

let port = process.env['PORT']; // after the first start, the port it got, so restarts keep the address
/** @type {unknown} */
let state = null; // the latest scores, handed to the next server
let up = false; // whether a server has come up at least once
let failures = 0; // crashes in a row, to back off when it keeps failing
let reason = ''; // why the current server was started: '', 'update' or 'crash'

function start() {
  const startedAt = Date.now();
  let updating = false;
  const child = fork(SERVER, {
    env: {
      ...process.env,
      ...(port !== undefined && { PORT: port }),
      LANGAME_STATE: state ? JSON.stringify(state) : '',
      LANGAME_RESTARTED: reason,
    },
  });

  child.on('message', (message) => {
    if (!isRecord(message)) return;
    if (message['type'] === 'ready') {
      up = true;
      port = String(message['port']);
      if (reason === 'update') console.log("Updated. Everyone's browser reloads and rejoins by itself.\n");
      if (reason === 'crash') console.log('The game server is running again.\n');
    } else if (message['type'] === 'state') {
      state = message['state'];
    } else if (message['type'] === 'restart') {
      state = message['state'];
      updating = true;
      console.log(
        `\nUpdating to the new version (${message['by'] ? `${message['by']} pressed Update` : 'nobody was playing'})…`,
      );
    }
  });

  // 'close' comes after the server's last message, so a restart always has the final scores.
  child.on('close', (code, signal) => {
    if (updating) {
      reason = 'update';
      start();
      return;
    }
    if (!up) process.exit(code ?? 1); // it never started; it has already said why
    if (Date.now() - startedAt > 30_000) failures = 0;
    const wait = Math.min(10, 2 ** failures++);
    console.error(
      `\nThe game server stopped (${signal ?? `exit code ${code}`}). Starting it again in ${wait} s…`,
    );
    reason = 'crash';
    setTimeout(start, wait * 1000);
  });
}

start();
