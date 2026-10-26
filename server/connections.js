// LAN transport policy lives here; game rules and the zirbel transport do not depend on ws.
import WebSocket, { WebSocketServer } from 'ws';
export class LanSocket extends WebSocket {
  alive = true;
  /** @type {string | undefined} */
  dataHash;
}
import { MAX_MESSAGE_BYTES } from '../shared/messages.js';

/** @param {import('node:http').Server} server @param {(socket: LanSocket) => void} connect */
export function acceptConnections(server, connect) {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    WebSocket: LanSocket,
  });
  /** @param {import('node:http').IncomingMessage} request @param {import('node:stream').Duplex} socket @param {Buffer} head */
  const upgrade = (request, socket, head) => {
    socket.on('error', () => socket.destroy());
    let status = 0;
    if (request.url !== '/ws') status = 404;
    else if (!sameOrigin(request.headers.origin, request.headers.host)) status = 403;
    else if (sockets.clients.size >= 512) status = 503;
    if (status) {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client));
  };
  server.on('upgrade', upgrade);
  sockets.on('connection', (socket) => {
    // ws emits errors for invalid/oversized frames before closing the connection.
    socket.on('error', () => socket.terminate());
    socket.alive = true;
    socket.on('pong', () => {
      socket.alive = true;
    });
    connect(socket);
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!socket.alive) socket.terminate();
      else {
        socket.alive = false;
        socket.ping();
      }
    }
  }, 30_000);
  heartbeat.unref();
  sockets.once('close', () => {
    clearInterval(heartbeat);
    server.off('upgrade', upgrade);
  });
  return sockets;
}

/** @param {string | undefined} origin @param {string | undefined} host */
function sameOrigin(origin, host) {
  if (origin === undefined) return true; // Native clients have no browser origin.
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host;
  } catch {
    return false;
  }
}
