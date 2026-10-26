import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setImmediate as settle } from 'node:timers/promises';
import { after, test } from 'node:test';
import { SNAPSHOT } from '../shared/wire.js';

const original = Object.fromEntries(
  ['location', 'addEventListener', 'removeEventListener', 'sessionStorage'].map((key) => [
    key,
    globalThis[key],
  ]),
);
const pageListeners = new Set();
Object.assign(globalThis, {
  location: { pathname: '/fps01/@v1/', search: '?room=TEST', origin: 'https://host.test' },
  addEventListener: (event, fn) => {
    if (event === 'pagehide') pageListeners.add(fn);
  },
  removeEventListener: (event, fn) => {
    if (event === 'pagehide') pageListeners.delete(fn);
  },
  sessionStorage: { getItem: () => null, removeItem() {} },
});
after(() => {
  Object.assign(globalThis, original);
  delete globalThis.transportFixture;
});

const modules = {
  '/zirbel-net.js':
    'export const HOST=254; export const launchParams=()=>({}); export const connect=()=>globalThis.transportFixture.connect();',
  '../../zirbel/room.js': 'export default function start(){return globalThis.transportFixture.start();}',
};
registerHooks({
  resolve(specifier, context, next) {
    if (modules[specifier])
      return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
    return specifier.startsWith('/shared/')
      ? next(new URL(`..${specifier}`, import.meta.url).href, context)
      : next(specifier, context);
  },
});
const { openSocket } = await import('../public/js/transport.js');

function fixture() {
  const calls = { connect: 0, start: 0, stop: 0, close: 0 };
  const handlers = new Map();
  const net = {
    hostId: 254,
    room: 'TEST',
    isHost: () => true,
    on(event, fn) {
      handlers.set(event, fn);
    },
    send() {},
    close() {
      calls.close++;
      handlers.get('close')?.();
    },
    emit(event, ...args) {
      handlers.get(event)?.(...args);
    },
  };
  globalThis.transportFixture = {
    connect() {
      calls.connect++;
      return net;
    },
    start() {
      calls.start++;
      return {
        stop() {
          calls.stop++;
        },
      };
    },
  };
  return { calls, net };
}

test('closing during imports cannot later open a connection or start an authority', async () => {
  const { calls } = fixture();
  const socket = openSocket();
  socket.close();
  await settle();
  await settle();
  assert.equal(socket.readyState, WebSocket.CLOSED);
  assert.deepEqual(calls, { connect: 0, start: 0, stop: 0, close: 0 });
  assert.equal(pageListeners.size, 0);
});

test('closing releases the connection, page listener and authority exactly once', async () => {
  const { calls, net } = fixture();
  const socket = openSocket();
  await settle();
  net.emit('open');
  assert.equal(socket.readyState, WebSocket.OPEN);
  assert.equal(pageListeners.size, 1);
  let messages = 0;
  socket.addEventListener('message', () => messages++);
  socket.close();
  socket.close();
  net.emit('host');
  net.emit('open');
  net.emit('message', 254, 2, { text: () => '{"type":"hello"}' });
  assert.deepEqual(calls, { connect: 1, start: 1, stop: 1, close: 1 });
  assert.equal(pageListeners.size, 0);
  assert.equal(messages, 0, 'closed sockets ignore delayed messages');
});

test('corrupt binary snapshots close cleanly so a reconnect can get a fresh keyframe', async () => {
  const { calls, net } = fixture();
  const socket = openSocket();
  await settle();
  net.emit('open');
  net.emit('message', 254, SNAPSHOT, { rest: () => Uint8Array.of(1, 255) });
  assert.equal(socket.readyState, WebSocket.CLOSED);
  assert.equal(calls.stop, 1);
  assert.equal(calls.close, 1);
  assert.equal(pageListeners.size, 0);
});
