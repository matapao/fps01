// The room's authority on zirbel (zirbel/room.js), over a stand-in for zirbel-net: a seat that says
// hello hears what the room has; the first to play starts the game in the room it picked, and
// everyone after joins it; a reload keeps the seat's name, colour and score; a seat gone for good is
// forgotten; a page with other data is handed the room's; a new authority goes on from what a page
// saw; a seat whose link is down misses snapshots, and nothing else; and a page that reads bytes
// gets its snapshots as bytes, only what changed, while a page of a version before them gets JSON.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { HASH, useData } from '../shared/data.js';
import { FIXTURE } from './fixtures/data.js';
import { SNAPSHOT, STATE, SnapshotReader, writeState } from '../shared/wire.js';

// What room.js uses of zirbel-net, which a host serves at /zirbel-net.js.
const NET =
  "export const SERVER = 254; const WORDS = ['One', 'Two', 'Three', 'Four']; export const playerName = (seat) => `Player ${WORDS[seat - 1]}`;";
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === '/zirbel-net.js'
      ? { url: `data:text/javascript,${encodeURIComponent(NET)}`, shortCircuit: true }
      : next(specifier, context),
});
const { default: authority, seatToken } = await import('../zirbel/room.js');

const UP = 1; // a page to the authority
const DOWN = 2; // the authority to a page

// The room as the hub's headless authority has it, with seats 1 and 2 in it (the hub calls the
// second Bot One): what each seat is told, as JSON and as bytes, and ways to say things to the
// authority and to make zirbel-net's events happen.
function room({ seed = null, data = null } = {}) {
  const handlers = new Map();
  const told = new Map([
    [1, []],
    [2, []],
  ]);
  const bytes = new Map([
    [1, []],
    [2, []],
  ]);
  const net = {
    id: 254,
    local: false,
    peers: new Map([
      [1, 'Player One'],
      [2, 'Bot One'],
    ]),
    ...(data && { revision: { id: 'loading' }, data }),
    on(name, fn) {
      handlers.set(name, [...(handlers.get(name) ?? []), fn]);
      return net;
    },
    off(name, fn) {
      handlers.set(
        name,
        (handlers.get(name) ?? []).filter((f) => f !== fn),
      );
      return net;
    },
    send(to, type, data) {
      if (type === DOWN) told.get(to)?.push(JSON.parse(data));
      else if (type === SNAPSHOT) bytes.get(to)?.push(data);
    },
  };
  const emit = (name, ...args) => {
    for (const fn of handlers.get(name) ?? []) fn(...args);
  };
  const { stop } = authority(net, { game: 'fps01', room: 'TEST' }, { seed });
  return {
    stop,
    emit,
    say: (seat, message) => emit('message', seat, UP, { text: () => JSON.stringify(message) }),
    state: (seat, state) => emit('message', seat, STATE, { rest: () => writeState(state) }),
    heard: (seat, type) => told.get(seat).filter((m) => m.type === type),
    bytes: (seat) => bytes.get(seat),
    forget: (seat) => {
      told.set(seat, []);
      bytes.set(seat, []);
    },
  };
}

const play = { type: 'create', map: 'depot', mode: 'dm', data: HASH };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('restored player fields are checked without coercing arbitrary JSON objects', () => {
  const r = room({
    seed: {
      map: 'depot',
      mode: 'dm',
      players: [{ seat: 1, name: { toString: null }, color: { toString: null }, kills: {}, deaths: [] }],
    },
  });
  try {
    r.say(1, play);
    assert.equal(r.heard(1, 'welcome')[0].name, 'Player One');
  } finally {
    r.stop();
  }
});

test('a seat that leaves while data loads cannot join after loading completes', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const r = room({
    data: async (file) => {
      await pending;
      return FIXTURE[file.replace('.json', '')];
    },
  });
  try {
    r.say(1, play);
    r.emit('leave', 1);
    finish();
    await pause(30);
    assert.equal(r.heard(1, 'joined').length, 0);
    r.say(2, play);
    assert.equal(r.heard(2, 'joined').length, 1, 'another seat can still start the game');
  } finally {
    r.stop();
  }
});

test('stopping an authority also cancels joins waiting for data', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const r = room({
    data: async (file) => {
      await pending;
      return FIXTURE[file.replace('.json', '')];
    },
  });
  r.say(1, play);
  r.stop();
  finish();
  await pause(30);
  assert.equal(r.heard(1, 'joined').length, 0);
});

test('an older data load completing last cannot replace a newer revision', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const latest = structuredClone(FIXTURE);
  latest.weapons.weapons[0].damage = 23;
  const r = room({
    data: async (file, revision) => {
      if (revision === 'loading') await pending;
      return (revision === 'latest' ? latest : FIXTURE)[file.replace('.json', '')];
    },
  });
  try {
    r.emit('revision', { id: 'latest' });
    await pause(30);
    finish();
    await pause(30);
    r.say(1, play);
    r.say(1, { type: 'data' });
    const data = r.heard(1, 'data').at(-1);
    assert.equal(data.revision, 'latest');
    assert.equal(data.blocks.weapons.weapons[0].damage, 23);
  } finally {
    finish();
    r.stop();
    useData(FIXTURE);
  }
});

test('zirbel rooms enforce the same sixteen-player limit as LAN games', () => {
  const r = room();
  try {
    r.say(1, play);
    r.say(2, play);
    for (let seat = 3; seat <= 17; seat++) {
      r.forget(seat);
      r.emit('peer', seat, `Player ${seat}`);
      r.say(seat, play);
    }
    assert.deepEqual(r.heard(17, 'full'), [{ type: 'full', scope: 'players' }]);
    assert.equal(r.heard(17, 'joined').length, 0);
  } finally {
    r.stop();
  }
});

test('a seat that says hello hears what the room has; the first to play starts the game, and the next joins it', async () => {
  const r = room();
  try {
    r.say(1, { type: 'hello' });
    assert.deepEqual(r.heard(1, 'hello'), [
      { type: 'hello', addresses: [], version: 'zirbel', update: false, games: [], data: HASH, wire: 1 },
    ]);
    r.say(1, play);
    assert.deepEqual(r.heard(1, 'joined'), [
      { type: 'joined', code: 'TEST', name: 'Game One', map: 'depot', mode: 'dm' },
    ]);
    assert.equal(r.heard(1, 'welcome')[0].name, 'Player One', "the seat's name, as the hub calls it");
    assert.equal(r.heard(1, 'world').length, 1);
    assert.equal(r.heard(1, 'data').length, 0, "it has the room's data already");
    r.say(2, { ...play, map: 'nowhere' });
    assert.equal(r.heard(2, 'joined')[0].map, 'depot', 'into the game that is going');
    await pause(150);
    const snapshot = r.heard(2, 'snapshot').at(-1);
    assert.deepEqual(
      snapshot.players.map((p) => [p.id, p.seat, p.name]),
      [
        [1, 1, 'Player One'],
        [2, 2, 'Bot One'],
      ],
      'named as the hub names them, with their seat as their id',
    );
    assert.ok(r.heard(1, 'self').length > 0, 'each told what they carry');
  } finally {
    r.stop();
  }
});

test("a reload keeps the seat's name, colour and score; a seat gone for good is forgotten", async () => {
  const seed = {
    map: 'depot',
    mode: 'dm',
    players: [{ seat: 2, name: 'Bot One', color: '#3fbf7f', kills: 4, deaths: 1 }],
  };
  const r = room({ seed });
  const two = () =>
    r
      .heard(1, 'snapshot')
      .at(-1)
      .players.find((p) => p.seat === 2);
  try {
    r.say(1, play);
    r.say(2, play);
    const before = r.heard(2, 'welcome')[0];
    r.forget(2);
    r.say(2, { type: 'hello' }); // the page reloaded…
    assert.equal(r.heard(2, 'hello').length, 1);
    assert.equal(r.heard(2, 'hello')[0].back, true, 'it was in the game, so its page goes back in');
    r.say(2, play); // …and came back in
    const after = r.heard(2, 'welcome')[0];
    assert.deepEqual([after.name, after.color], [before.name, '#3fbf7f']);
    await pause(150);
    assert.deepEqual([two().kills, two().deaths], [4, 1]);
    r.emit('leave', 2); // gone, and the seat given to someone else
    r.emit('peer', 2, 'Player Two');
    r.say(2, play);
    await pause(150);
    assert.deepEqual(
      [two().kills, two().deaths, two().name],
      [0, 0, 'Player Two'],
      'who starts afresh, under their own name',
    );
  } finally {
    r.stop();
  }
});

test("a page with other data asks for the room's, and is handed it", () => {
  const r = room();
  try {
    r.say(1, { type: 'data' });
    const [data] = r.heard(1, 'data');
    assert.equal(data.hash, HASH);
    assert.deepEqual(Object.keys(data.blocks).sort(), [
      'characters',
      'hud',
      'layouts',
      'loot',
      'materials',
      'movement',
      'pieces',
      'prefabs',
      'projectiles',
      'radar',
      'rules',
      'sky',
      'weapons',
    ]);
    r.say(1, { type: 'ping', t: 12.5 });
    assert.deepEqual(r.heard(1, 'pong'), [{ type: 'pong', t: 12.5 }]);
  } finally {
    r.stop();
  }
});

test("a new authority goes on from what a page saw: the holes in the arena, and everyone's score by seat", async () => {
  const hole = [-20, -0.25, -20, 1.6];
  const seed = {
    map: 'depot',
    mode: 'dm',
    history: [hole],
    players: [{ seat: 1, name: 'Player One', color: '#e8524a', kills: 3, deaths: 2 }],
  };
  const r = room({ seed });
  try {
    for (const seat of [1, 2])
      assert.deepEqual(
        r.heard(seat, 'hello')[0].games,
        [{ code: 'TEST', name: 'Game One', map: 'depot', mode: 'dm', players: [] }],
        'everyone is greeted at once',
      );
    r.say(1, play);
    assert.deepEqual(r.heard(1, 'world')[0].history, [hole]);
    await pause(150);
    const me = r
      .heard(1, 'snapshot')
      .at(-1)
      .players.find((p) => p.seat === 1);
    assert.deepEqual([me.kills, me.deaths, me.color], [3, 2, '#e8524a']);
    assert.equal(seatToken(1), '5ea70001');
  } finally {
    r.stop();
  }
});

test('a seat whose link is down misses snapshots while it is, and nothing else', async () => {
  const r = room();
  try {
    r.say(1, play);
    r.say(2, play);
    r.emit('away', 1);
    r.forget(1);
    r.say(2, { type: 'state', feet: [-15, -20, -20], yaw: 0, pitch: 0, held: 'rifle' }); // into the void
    await pause(150);
    assert.equal(r.heard(1, 'snapshot').length, 0, 'no snapshots');
    assert.ok(r.heard(1, 'kill').length === 1, 'but the kill');
    r.emit('back', 1);
    await pause(150);
    assert.ok(r.heard(1, 'snapshot').length > 0, 'and the snapshots again, once it is back');
  } finally {
    r.stop();
  }
});

test('a page that reads bytes gets snapshots as bytes, only what changed; its state as bytes moves it; a page before them gets JSON', async () => {
  const r = room();
  const page = new SnapshotReader();
  const read = () =>
    r
      .bytes(1)
      .map((b) => page.read(b))
      .filter(Boolean)
      .at(-1);
  try {
    r.say(1, { type: 'hello' });
    r.say(1, { type: 'wire' }); // what a page answers a hello with wire in it
    r.say(1, play);
    r.say(2, play); // a page of a version before the wire: it never says so
    await pause(500);
    assert.equal(r.heard(1, 'snapshot').length, 0, 'no JSON snapshots to the page that reads bytes');
    assert.deepEqual(
      read().players.map((p) => [p.id, p.name]),
      [
        [1, 'Player One'],
        [2, 'Bot One'],
      ],
    );
    assert.equal(r.bytes(2).length, 0, 'and none as bytes to the other');
    // Everyone standing still, there's nothing new to say after the first (but the round's clock,
    // once a second), while the JSON goes every time.
    assert.ok(r.heard(2, 'snapshot').length >= 6, `${r.heard(2, 'snapshot').length} as JSON`);
    assert.ok(r.bytes(1).length <= 2, `${r.bytes(1).length} as bytes`);
    // Its state, as bytes: everyone sees it move.
    r.state(1, { feet: [-14, 0, 14.5], yaw: 1.5, pitch: 0, held: 'rifle' });
    await pause(150);
    const one = r
      .heard(2, 'snapshot')
      .at(-1)
      .players.find((p) => p.id === 1);
    assert.deepEqual([one.feet, one.yaw], [[-14, 0, 14.5], 1.5]);
    assert.deepEqual(read().players[0].feet, [-14, 0, 14.5]);
    // The page reloads: JSON until it says it reads bytes again, and then a whole snapshot.
    r.forget(1);
    r.say(1, { type: 'hello' });
    r.say(1, play);
    await pause(150);
    assert.ok(r.heard(1, 'snapshot').length > 0 && r.bytes(1).length === 0, 'JSON after the reload');
    r.say(1, { type: 'wire' });
    await pause(150);
    const fresh = new SnapshotReader();
    assert.deepEqual(
      fresh.read(r.bytes(1)[0]).players.map((p) => p.id),
      [1, 2],
      'a page starting again reads the first whole',
    );
  } finally {
    r.stop();
  }
});

test('room creation and takeover reject a known mode disabled by the active rules', () => {
  const limited = structuredClone(FIXTURE);
  limited.rules.modes = ['dm'];
  useData(limited);
  const r = room({ seed: { map: 'depot', mode: 'ctf', players: [] } });
  try {
    r.say(1, { type: 'hello' });
    assert.deepEqual(r.heard(1, 'hello').at(-1).games, [], 'disabled mode cannot seed an authority');
    r.say(1, { ...play, mode: 'ctf' });
    assert.equal(r.heard(1, 'welcome').length, 0, 'disabled mode cannot create a game');
    r.say(1, { ...play, mode: 'dm' });
    assert.equal(r.heard(1, 'welcome').length, 1, 'an enabled mode still works');
  } finally {
    r.stop();
    useData(FIXTURE);
  }
});
