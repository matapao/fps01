import { isRecord } from '../shared/snapshot-parts.js';
// Starts the game server: the web page on http://<this computer>:7777 and the games on /ws.
// npm start runs it under run.js, which restarts it when the players switch to new code.

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { TICK_RATE } from '../shared/constants.js';
import { Lobbies } from './lobbies.js';
import { acceptConnections } from './connections.js';
import { loadRelease } from './release.js';
import { serveFiles } from './static.js';
import { watchForUpdates } from './updates.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Out of the way of the usual dev-server ports (3000, 5173, 8080), and easy to type at a party.
const DEFAULT_PORT = 7777;

// Without a host, Node listens on every network interface, IPv4 and IPv6. restore: the games the last
// server had. With update, the server watches its own code and offers new versions to the players.
// When they switch, it closes every connection and calls update({ state, by }) to be started again.
/** @param {import('./server-types.ts').ServerOptions} options */
export async function startServer({
  port = DEFAULT_PORT,
  host,
  respawnMs,
  protectionMs,
  reportMetric,
  restore,
  update,
} = {}) {
  const release = await loadRelease(ROOT);
  const server = createServer(serveFiles(release));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(undefined));
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server did not bind a TCP port');
  const actualPort = address.port;
  const addresses = lanAddresses().map((ip) => `http://${ip}:${actualPort}`);
  const lobbies = new Lobbies({
    addresses,
    version: release.version,
    game: { respawnMs, protectionMs },
    reportMetric,
    restore,
  });
  const sockets = acceptConnections(server, (socket) => lobbies.connect(socket));
  const ticker = setInterval(() => lobbies.tick(1 / TICK_RATE), 1000 / TICK_RATE);

  /** @type {ReturnType<typeof watchForUpdates> | null} */
  let watcher = null;
  const handle = {
    port: actualPort,
    addresses,
    lobbies,
    version: release.version,
    async close() {
      clearInterval(ticker);
      watcher?.stop();
      lobbies.stop();
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    },
  };

  if (update) {
    const currentWatcher = watchForUpdates({
      root: ROOT,
      version: release.version,
      offer: (version) => lobbies.offerUpdate(version !== null),
    });
    watcher = currentWatcher;
    let switching = false;
    lobbies.onUpdate = async (by) => {
      if (switching) return;
      switching = true;
      if (!(await currentWatcher.confirm())) {
        switching = false; // the code changed again; the watcher offers the newer version once it's checked
        return;
      }
      lobbies.broadcast({ type: 'updating', by });
      const state = lobbies.saveState();
      server.close(); // no new connections: browsers must reconnect to the new server, not this one
      // A clean close lets the message above arrive first; browsers reconnect and reload by themselves.
      for (const socket of sockets.clients) socket.close(1012, 'Updating');
      await delay(300);
      await handle.close();
      update({ state, by });
    };
  }

  return handle;
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .flatMap((address) =>
      address && address.family === 'IPv4' && !address.internal ? [address.address] : [],
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env['PORT'] ? Number(process.env['PORT']) : DEFAULT_PORT;
  // Under npm start, run.js supervises this process over an IPC channel.
  const sendIpc = process.send?.bind(process);
  try {
    const server = await startServer({
      port,
      restore: parseState(process.env['LANGAME_STATE']),
      update: sendIpc
        ? ({ state, by }) => sendIpc({ type: 'restart', state, by }, () => process.exit(0))
        : undefined,
    });
    if (sendIpc) {
      sendIpc({ type: 'ready', port: server.port });
      // The supervisor keeps the latest games and scores, so they survive a crash too.
      setInterval(
        () => process.connected && sendIpc({ type: 'state', state: server.lobbies.saveState() }),
        2000,
      ).unref();
      process.on('disconnect', () => process.exit(0)); // the supervisor has stopped
    }
    if (!process.env['LANGAME_RESTARTED']) {
      console.log('\nfps01 is running.\n');
      console.log(`  On this computer:  http://localhost:${server.port}`);
      for (const address of server.addresses) console.log(`  On the LAN:        ${address}`);
      console.log('\nGive the LAN address to the other players. Press Ctrl+C to stop.');
      if (sendIpc)
        console.log('When the code changes, players get an Update button to switch to the new version.');
      console.log('');
    }
  } catch (error) {
    if (!isRecord(error) || error['code'] !== 'EADDRINUSE') throw error;
    console.error(`Port ${port} is already in use. Start on another port with: PORT=${port + 1} npm start`);
    process.exit(1);
  }
}

/** @param {string | undefined} json @returns {unknown} */
function parseState(json) {
  try {
    return json ? JSON.parse(json) : undefined;
  } catch {
    return undefined;
  }
}
