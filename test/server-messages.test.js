import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import './fixtures/data.js';
import { Game } from '../server/game.js';
import { SnapshotReader, SnapshotWriter } from '../shared/wire.js';
registerHooks({
  resolve(specifier, context, next) {
    return specifier.startsWith('/shared/')
      ? next(new URL(`..${specifier}`, import.meta.url).href, context)
      : next(specifier, context);
  },
});
const { readServerMessage } = await import('../shared/server-messages.js');

test('browser accepts actual authority snapshots through JSON and the incremental wire with unchanged state', () => {
  let now = 1000;
  const received = [];
  const socket = {
    readyState: 1,
    OPEN: 1,
    send(text) {
      received.push(JSON.parse(text));
    },
  };
  const game = new Game({ now: () => now });
  try {
    game.add(socket);
    game.join(socket, '1234567890abcdef12345678', 'Player One');
    now += 100;
    game.snapshot();
    const snapshot = received.find((message) => message.type === 'snapshot');
    assert.ok(snapshot, 'the actual authority emitted a snapshot');
    assert.deepEqual(readServerMessage(JSON.stringify(snapshot)), snapshot);
    const writer = new SnapshotWriter();
    const reader = new SnapshotReader();
    const decoded = reader.read(writer.write(snapshot));
    assert.ok(decoded);
    assert.deepEqual(readServerMessage(decoded), decoded);
    const self = received.find((message) => message.type === 'self');
    assert.ok(self);
    assert.deepEqual(
      readServerMessage(JSON.stringify(self)),
      self,
      'unlimited ammo survives its JSON null representation',
    );
    for (const message of received) {
      if (['world', 'welcome', 'spawn'].includes(message.type))
        assert.deepEqual(readServerMessage(message), message, `accept actual ${message.type}`);
    }
  } finally {
    game.stop();
  }
});

test('malformed host messages never enter typed presentation handlers and valid input recovers', () => {
  for (const message of [
    { type: 'moved', feet: [1, 2] },
    { type: 'push', velocity: [1, NaN, 3] },
    { type: 'snapshot', players: [{ id: 1 }], projectiles: [] },
    { type: 'build', entry: ['d', 1, 2, 3] },
    { type: 'round', mode: 'unsupported', state: 'start' },
    { type: '__proto__' },
    { type: 'data', hash: 'bad', blocks: {} },
    { type: 'killcam', killer: 1, hp: '100', armor: 0 },
  ])
    assert.equal(readServerMessage(message), null, JSON.stringify(message));
  const valid = { type: 'moved', feet: [1, 2, 3] };
  assert.deepEqual(readServerMessage(valid), valid);
});

test('LAN menu messages preserve absent scope and nullable release, room, and updater fields', () => {
  for (const message of [
    { type: 'full' },
    { type: 'full', scope: 'players' },
    { type: 'nogame', code: null },
    { type: 'nogame', code: 'ABCD' },
    { type: 'updating', by: null },
    { type: 'updating', by: 'Player One' },
    { type: 'hello', addresses: [], version: null },
  ])
    assert.deepEqual(readServerMessage(message), message);
});
