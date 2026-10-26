// The game's wire on zirbel (shared/wire.js): snapshots as bytes, with only what changed, players far
// off and out of view less often, and the whole of it whenever a page starts again; a page's state as
// bytes, only when it changes; and what all that saves against the JSON it replaces.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { Game } from '../server/game.js';
import { SnapshotReader, SnapshotWriter, readState, stateChanged, writeState } from '../shared/wire.js';

const player = (id, feet, more = {}) => ({
  id,
  seat: id,
  name: `Player ${id}`,
  color: '#e8524a',
  feet,
  yaw: 0.5,
  pitch: -0.1,
  hp: 100,
  armor: 0,
  alive: true,
  kills: 0,
  deaths: 0,
  hook: null,
  held: 'rifle',
  team: null,
  carrying: null,
  shielded: false,
  cloaked: false,
  powerup: null,
  ...more,
});
const round = (more = {}) => ({
  mode: 'dm',
  map: 'depot',
  over: false,
  captures: { red: 0, blue: 0 },
  ms: 599500,
  sudden: false,
  ...more,
});
const snapshot = (players, more = {}) => ({
  type: 'snapshot',
  players,
  projectiles: [],
  items: [0, 5, 0],
  round: round(),
  water: 0,
  powerups: { pedestal: null, soon: null, loose: [] },
  crates: [],
  woollies: [],
  ...more,
});
const near = (a, b) => Math.abs(a - b) < 0.006;
const turned = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.0002;

test('wire states reject every truncation, oversized string lengths, and trailing bytes', () => {
  const bytes = writeState({ feet: [1, 2, 3], yaw: 0, pitch: 0, held: 'rocket' });
  for (let end = 0; end < bytes.length; end++)
    assert.throws(() => readState(bytes.subarray(0, end)), RangeError);
  assert.throws(() => readState(Uint8Array.from([...bytes, 0])), /Trailing/);
  const invalid = bytes.slice();
  invalid[10] = 254;
  assert.throws(() => readState(invalid), /Truncated/);
});

test('wire snapshots reject truncated strings, unbounded integers, and trailing bytes', () => {
  const bytes = new SnapshotWriter().write(snapshot([player(1, [0, 0, 0])]));
  for (let end = 0; end < bytes.length; end++)
    assert.throws(() => new SnapshotReader().read(bytes.subarray(0, end)), RangeError);
  assert.throws(() => new SnapshotReader().read(Uint8Array.from([1, ...Array(9).fill(255)])), /wire integer/);
  assert.throws(() => new SnapshotReader().read(Uint8Array.from([...bytes, 0])), /Trailing/);
});

// Whether a player read back is the one written: to the centimetre, and the ten-thousandth of a radian.
function matches(q, p) {
  for (const key of [
    'id',
    'seat',
    'name',
    'color',
    'hp',
    'armor',
    'alive',
    'kills',
    'deaths',
    'held',
    'team',
    'carrying',
    'shielded',
    'cloaked',
    'powerup',
  ])
    assert.deepEqual(q[key], p[key], `${key} of ${p.id}`);
  assert.ok(
    p.feet.every((v, a) => near(v, q.feet[a])) && turned(p.yaw, q.yaw) && near(p.pitch, q.pitch),
    `${JSON.stringify(q)} for ${JSON.stringify(p)}`,
  );
  assert.equal(Boolean(q.hook), Boolean(p.hook));
  if (p.hook) assert.ok(p.hook.every((v, a) => near(v, q.hook[a])));
}

test('a snapshot read back from its bytes is the one written, to the centimetre', () => {
  const writer = new SnapshotWriter();
  const reader = new SnapshotReader();
  const written = snapshot(
    [
      player(1, [1.234, 0, -5.678]),
      player(2, [10, 2.5, 3], {
        team: 'red',
        carrying: 'blue',
        hook: [4, 5, 6],
        powerup: 'triple',
        cloaked: true,
        hp: 175,
        armor: 30,
        kills: 7,
        deaths: 2,
        yaw: -3.1,
      }),
    ],
    { projectiles: [[17, 'rocket', 1.5, 2, -3]] },
  );
  const read = reader.read(writer.write(written, 1));
  assert.equal(read.type, 'snapshot');
  assert.deepEqual(read.items, written.items);
  assert.equal(read.round.ms, 600000, "the round's clock to the second");
  assert.deepEqual(read.powerups, written.powerups);
  written.players.forEach((p, i) => matches(read.players[i], p));
  assert.deepEqual(read.projectiles, [[17, 'rocket', 1.5, 2, -3]]);
});

test('a page that comes in partway waits for a whole one', () => {
  const writer = new SnapshotWriter();
  const players = [player(1, [0, 0, 0])];
  writer.write(snapshot(players), 1);
  players[0] = { ...players[0], feet: [1, 0, 0] };
  const reader = new SnapshotReader();
  assert.equal(reader.read(writer.write(snapshot(players), 1)), null);
  writer.reset();
  assert.deepEqual(
    reader.read(writer.write(snapshot(players), 1)).players.map((p) => p.feet),
    [[1, 0, 0]],
  );
});

test('only what changed: nothing new is nothing at all, and one player moving is a few bytes', () => {
  const writer = new SnapshotWriter();
  const reader = new SnapshotReader();
  const players = [player(1, [0, 0, 0]), player(2, [5, 0, 5]), player(3, [-5, 0, 5])];
  const first = writer.write(snapshot(players), 1);
  reader.read(first);
  assert.equal(writer.write(snapshot(players), 1), null, 'nothing new');
  players[1] = { ...players[1], feet: [5.5, 0, 5], yaw: 0.7 };
  const moved = writer.write(snapshot(players), 1);
  assert.ok(
    moved.length <= 16,
    `${moved.length} bytes for one player moving (the first, whole, was ${first.length})`,
  );
  let read = reader.read(moved);
  assert.ok(near(read.players[1].feet[0], 5.5) && near(read.players[1].yaw, 0.7));
  assert.equal(read.players[2].name, 'Player 3', 'and the others as they were');
  players[1] = { ...players[1], feet: [25, 8, 5] }; // thrown by a jump pad: too far for a step
  read = reader.read(writer.write(snapshot(players), 1));
  assert.deepEqual(read.players[1].feet, [25, 8, 5]);
  const left = writer.write(snapshot([players[0], players[1]]), 1);
  assert.deepEqual(
    reader.read(left).players.map((p) => p.id),
    [1, 2],
    'someone who left is gone',
  );
});

test('players far off and out of view are told about less often; in view, or new, at once', () => {
  const writer = new SnapshotWriter();
  const reader = new SnapshotReader();
  const me = player(1, [0, 0, 0], { yaw: 0 }); // looking along -z
  let behind = player(2, [0, 0, 60]);
  let ahead = player(3, [10, 0, -60]);
  reader.read(writer.write(snapshot([me, behind, ahead]), 1));
  const told = { behind: 0, ahead: 0 };
  for (let frame = 1; frame <= 8; frame++) {
    behind = { ...behind, feet: [frame, 0, 60] };
    ahead = { ...ahead, feet: [10 + frame, 0, -60] };
    const read = reader.read(writer.write(snapshot([me, behind, ahead]), 1));
    if (read.players[1].feet[0] === frame) told.behind++;
    if (read.players[2].feet[0] === 10 + frame) told.ahead++;
  }
  assert.deepEqual(told, { behind: 2, ahead: 8 }, 'behind, every fourth snapshot; ahead, every one');
  const fresh = player(4, [0, 0, 70]);
  assert.ok(
    reader.read(writer.write(snapshot([me, behind, ahead, fresh]), 1)).players.some((p) => p.id === 4),
    'someone new, at once',
  );
  // Dead, you watch whoever killed you, wherever they are: everyone, every time.
  const dead = { ...me, alive: false };
  behind = { ...behind, feet: [100, 0, 60] };
  assert.deepEqual(
    reader.read(writer.write(snapshot([dead, behind, ahead, fresh]), 1)).players[1].feet,
    [100, 0, 60],
  );
});

test('the rest goes part by part, when it changes: the clocks to the second, a carried flag where its carrier is', () => {
  const writer = new SnapshotWriter();
  const reader = new SnapshotReader();
  const flags = (blue) => ({ red: { state: 'home', at: [-30, 0, 0] }, blue });
  const carrier = player(1, [3, 0, 4], { team: 'red', carrying: 'blue' });
  const at = (ms, more = {}) =>
    snapshot([carrier], {
      round: round({ mode: 'ctf', ms, flags: flags({ state: 'carried', at: [...carrier.feet] }) }),
      ...more,
    });
  reader.read(writer.write(at(599900), 1));
  assert.equal(writer.write(at(599100), 1), null, 'the same second: nothing new');
  const second = writer.write(at(598900), 1);
  assert.equal(reader.read(second).round.ms, 599000, 'the next second');
  // The carrier runs: they go as a step, and their flag goes with them, for nothing more.
  carrier.feet = [4, 0, 4];
  const ran = writer.write(at(598800), 1);
  assert.ok(ran.length < 16, `${ran.length} bytes`);
  assert.deepEqual(reader.read(ran).round.flags.blue, { state: 'carried', at: [4, 0, 4] });
  // A crate coming down: only its part, as it falls.
  const crate = (y) => at(598700, { crates: [[1, 'health', 2, y, 2, 0]] });
  reader.read(writer.write(crate(10), 1));
  const fell = writer.write(crate(9.9), 1);
  assert.ok(fell.length < 50, `${fell.length} bytes`);
  const read = reader.read(fell);
  assert.deepEqual(read.crates, [[1, 'health', 2, 9.9, 2, 0]]);
  assert.equal(read.round.mode, 'ctf', 'and the rest as it was');
  assert.deepEqual(read.round.flags.red, { state: 'home', at: [-30, 0, 0] });
});

test("what's in flight: its kind once, then where it is, until it lands", () => {
  const writer = new SnapshotWriter();
  const reader = new SnapshotReader();
  const me = player(1, [0, 0, 0]);
  reader.read(writer.write(snapshot([me], { projectiles: [[5, 'rocket', 1, 1.6, 1]] }), 1));
  const flew = writer.write(
    snapshot([me], {
      projectiles: [
        [5, 'rocket', 2.5, 1.6, 1],
        [6, 'frag', 0, 2, 0],
      ],
    }),
    1,
  );
  assert.deepEqual(reader.read(flew).projectiles, [
    [5, 'rocket', 2.5, 1.6, 1],
    [6, 'frag', 0, 2, 0],
  ]);
  const again = writer.write(
    snapshot([me], {
      projectiles: [
        [5, 'rocket', 4, 1.6, 1],
        [6, 'frag', 0, 2, 0],
      ],
    }),
    1,
  );
  assert.ok(again.length <= 15, `${again.length} bytes for one rocket on its way`);
  assert.deepEqual(
    reader.read(writer.write(snapshot([me], { projectiles: [[6, 'frag', 0, 2, 0]] }), 1)).projectiles,
    [[6, 'frag', 0, 2, 0]],
    'the rocket landed',
  );
});

test('starting again (a keyframe) leaves nothing behind of the old', () => {
  const writer = new SnapshotWriter();
  const reader = new SnapshotReader();
  reader.read(
    writer.write(
      snapshot([player(1, [0, 0, 0]), player(2, [1, 0, 1])], {
        projectiles: [[1, 'frag', 0, 0, 0]],
        woollies: [[1, 0, 0, 0, 1, 0]],
      }),
      1,
    ),
  );
  writer.reset();
  const later = snapshot([player(1, [0, 0, 0])], { items: [9] });
  delete later.woollies;
  const read = reader.read(writer.write(later, 1));
  assert.deepEqual(
    read.players.map((p) => p.id),
    [1],
  );
  assert.deepEqual(read.items, [9]);
  assert.deepEqual(read.projectiles, []);
  assert.equal('woollies' in read, false, 'a part no longer there');
});

test('whatever happens, a page reads what the JSON said', () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const writer = new SnapshotWriter();
  const reader = new SnapshotReader();
  let players = [1, 2, 3, 4, 5].map((id) => player(id, [random() * 60 - 30, 0, random() * 60 - 30]));
  let projectiles = [];
  let nextShot = 1;
  let nextId = 6;
  let read = null;
  for (let frame = 0; frame < 600; frame++) {
    players = players.map((p) => {
      if (random() < 0.2) return p;
      const jump = random() < 0.05 ? 40 : 1.2;
      return {
        ...p,
        feet: p.feet.map((v) => v + (random() - 0.5) * jump),
        yaw: p.yaw + (random() - 0.5) * 2,
        pitch: (random() - 0.5) * 3,
        hp: random() < 0.1 ? Math.floor(random() * 200) : p.hp,
        armor: random() < 0.05 ? Math.floor(random() * 150) : p.armor,
        alive: random() < 0.03 ? !p.alive : p.alive,
        kills: p.kills + (random() < 0.02 ? 1 : 0),
        held: random() < 0.05 ? ['rifle', 'rocket', 'rail'][Math.floor(random() * 3)] : p.held,
        hook: random() < 0.05 ? (p.hook ? null : [random() * 9, 3, random() * 9]) : p.hook,
        powerup: random() < 0.02 ? (p.powerup ? null : 'triple') : p.powerup,
        team: random() < 0.01 ? 'blue' : p.team,
        carrying: random() < 0.02 ? (p.carrying ? null : 'red') : p.carrying,
      };
    });
    if (random() < 0.03)
      players.push(
        player(nextId++, [random() * 60 - 30, 0, random() * 60 - 30], { name: 'Bot Two', color: '#4a8ae8' }),
      );
    if (random() < 0.03 && players.length > 1) players.splice(Math.floor(random() * players.length), 1);
    if (random() < 0.3)
      projectiles.push([nextShot++, random() < 0.5 ? 'rocket' : 'frag', random() * 10, 1, random() * 10]);
    projectiles = projectiles
      .filter(() => random() > 0.1)
      .map(([id, kind, x, y, z]) =>
        random() < 0.7 ? [id, kind, x + random() * 2, y, z - random() * 2] : [id, kind, x, y, z],
      );
    const written = snapshot(players, {
      projectiles,
      items: [frame % 50 < 10 ? 0 : 3],
      round: round({ ms: 600000 - frame * 50, sudden: frame > 500 }),
      water: frame > 300 ? -1 - frame / 1000 : 0,
    });
    if (random() < 0.01) writer.reset();
    const bytes = writer.write(written, null); // a viewer not in the game (or not yet): everyone, every time
    read = bytes ? reader.read(bytes) : read;
    assert.equal(read.players.length, players.length, `frame ${frame}`);
    [...players].sort((a, b) => a.id - b.id).forEach((p, i) => matches(read.players[i], p));
    assert.equal(read.projectiles.length, projectiles.length);
    projectiles.forEach(([id, kind, x, y, z], i) => {
      const [qid, qkind, ...qat] = read.projectiles[i];
      assert.ok(
        qid === id && qkind === kind && near(qat[0], x) && near(qat[1], y) && near(qat[2], z),
        `${read.projectiles[i]} for ${[id, kind, x, y, z]}`,
      );
    });
    assert.deepEqual(read.items, written.items);
    assert.equal(read.round.ms, Math.ceil(written.round.ms / 1000) * 1000);
    assert.equal(read.round.sudden, written.round.sudden);
    assert.equal(read.water, written.water);
  }
});

test('a state is bytes too, and only worth sending when it changed, or once a second', () => {
  const state = { feet: [1.23, 0, -4.56], yaw: 7, pitch: 0.2, held: 'rail' };
  const read = readState(writeState(state));
  assert.equal(read.type, 'state');
  assert.ok(
    read.feet.every((v, i) => near(v, state.feet[i])) && turned(read.yaw, 7) && near(read.pitch, 0.2),
  );
  assert.equal(read.held, 'rail');
  assert.equal(writeState(state).length, 15);
  assert.equal(stateChanged(state, state, 200), false, 'the same, a moment later');
  assert.equal(stateChanged({ ...state, feet: [1.25, 0, -4.56] }, state, 200), true, 'moved');
  assert.equal(stateChanged({ ...state, yaw: 7.01 }, state, 200), true, 'turned');
  assert.equal(stateChanged(state, state, 1000), true, 'a second on');
});

test('in a game of 16 running about, the wire costs a few percent of the JSON it replaced', (t) => {
  const clock = { now: 1_000_000 };
  const game = new Game({ protectionMs: 0, now: () => clock.now, restore: { map: 'depot' } });
  const sockets = Array.from({ length: 16 }, (_, i) => {
    const writer = new SnapshotWriter();
    let selfSent = null;
    const socket = {
      readyState: 1,
      OPEN: 1,
      bytes: 0, // what the wire sends it
      snapshots: 0,
      json: 0, // what JSON was sent each time
      selfJson: 0,
      send(data) {
        socket.bytes += String(data).length;
      },
      snapshot(message) {
        socket.snapshots++;
        socket.bytes += writer.write(message, socket.id)?.length ?? 0;
        socket.json += JSON.stringify(message).length;
      },
      self(message) {
        const text = JSON.stringify(message);
        socket.selfJson += text.length;
        if (text !== selfSent) socket.bytes += text.length;
        selfSent = text;
      },
    };
    game.sockets.add(socket);
    game.join(socket, null, null, i + 1);
    socket.id = i + 1;
    return socket;
  });
  const players = [...game.players.values()];
  const seconds = 10;
  for (let tick = 0; tick < seconds * 30; tick++) {
    clock.now += 1000 / 30;
    // Everyone runs round a circle of their own, somewhere in the arena, turning as they go.
    players.forEach((p, i) => {
      const a = tick / 30 + i;
      p.feet = [Math.cos(i) * 25 + Math.cos(a) * 3, 0, Math.sin(i) * 25 + Math.sin(a) * 3];
      p.yaw = a;
    });
    game.tick(1 / 30);
    game.snapshot();
  }
  game.stop();
  const each = (key) => sockets.reduce((sum, s) => sum + s[key], 0) / sockets.length;
  assert.ok(
    Math.abs(each('snapshots') - seconds * 20) <= 1,
    `${each('snapshots')} snapshots in ${seconds} s`,
  );
  // Before, the JSON went 30 times a second.
  const json = ((each('json') + each('selfJson')) / each('snapshots')) * 30;
  const wire = each('bytes') / seconds;
  t.diagnostic(
    `per player: ${(json / 1024).toFixed(1)} KB/s of JSON at 30 a second, ${(wire / 1024).toFixed(2)} KB/s on the wire: ${((1 - wire / json) * 100).toFixed(1)}% less`,
  );
  assert.ok(wire < json * 0.03, `${wire} bytes a second against ${json}`);
});
