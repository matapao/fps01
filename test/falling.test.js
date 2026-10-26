// What happens after the arena breaks: the canal running out through a hole in its basin, gravel
// falling from high up, and pieces that nothing holds up falling, toppling and crushing. On a fake
// clock, with players on stand-in connections.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { Game } from '../server/game.js';
import { drop } from '../server/physics.js';
import { inWater } from '../shared/map.js';
import { M } from '../shared/materials.js';
import { cellCentre, cellOf } from '../shared/voxels.js';
import { emptyLevel, fullLevel, leaks } from '../shared/water.js';

function setup(map = 'fort') {
  const clock = { now: 1_000_000 };
  const game = new Game({ protectionMs: 0, now: () => clock.now, restore: { map } });
  const sent = [];
  game.broadcast = (message) => sent.push(message);
  const add = (name, feet) => {
    const socket = {
      readyState: 1,
      OPEN: 1,
      inbox: [],
      send: (data) => socket.inbox.push(JSON.parse(data)),
      on() {},
    };
    game.join(socket, name);
    const player = game.bySocket.get(socket);
    player.feet = [...feet];
    return player;
  };
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      clock.now += 1000 / 30;
      game.tick(1 / 30);
    }
  };
  const at = (x, y, z) => game.world.get(cellOf(x, 0), cellOf(y, 1), cellOf(z, 2));
  return { game, clock, sent, add, run, at };
}

test('a hole in the bottom of the canal lets all the water run out', () => {
  const { game, sent, run } = setup('canal');
  const [FULL, EMPTY] = [fullLevel(), emptyLevel()];
  assert.equal(game.world.water, FULL);
  assert.deepEqual(leaks(game.world, FULL), [], 'the basin holds');
  game.carve([0, EMPTY + 0.1, 15], 1.6); // a grenade on the bottom
  assert.ok(leaks(game.world, game.world.water).length > 10, 'water gets out through the hole');
  run(1);
  assert.ok(game.world.water < FULL - 0.3, `going down: ${game.world.water}`);
  assert.equal(game.pool.draining, true, 'running out');
  run(6);
  assert.equal(game.world.water, EMPTY);
  assert.equal(game.pool.draining, false, 'and empty');
  assert.equal(inWater([0, EMPTY + 0.5, 15], game.world.water), false, 'nothing left to swim in');
  game.sockets.add({ readyState: 1, OPEN: 1, send: (data) => sent.push(JSON.parse(data)) });
  game.snapshot();
  assert.equal(sent.findLast((m) => m.type === 'snapshot').water, EMPTY, 'everyone is told');
  game.startRound();
  assert.equal(game.world.water, FULL, 'a new round fills it again');
});

test('the water only gets out through a hole all the way through a quay, and runs out down to the bottom of it', () => {
  const { game, run } = setup('canal');
  game.carve([4.25, 1.25, 15.25], 0.3); // a stone out of the side of the canal, 1 to 1.5 m up
  assert.deepEqual(leaks(game.world, game.world.water), [], 'the quay behind it still holds the water in');
  for (let x = 4.75; x < 7; x += 0.5) game.carve([x, 1.25, 15.25], 0.3); // on through the quay to the street
  run(20);
  assert.ok(Math.abs(game.world.water - 1) < 0.02, `stopped at the bottom of the hole: ${game.world.water}`);
  assert.equal(game.pool.draining, false);
});

test('gravel blown out of the bottom of a bunker falls to the ground in heaps, but not on anyone, and sinks in the canal', () => {
  const { game, sent, add, run, at } = setup('depot');
  add('Under', [19, 0, 25]);
  game.carve([18, 3.25, 25], 1.6); // the bottom of a bunker, 3 m up on its legs
  const rubble = sent.find((m) => m.type === 'rubble');
  assert.ok(rubble?.pieces.length > 5, 'the browsers are told what falls');
  assert.equal(at(18, 0.25, 25), 0, 'nothing has landed yet');
  run(1.2);
  assert.equal(at(18, 0.25, 25), M.gravel, 'a heap of it on the ground below');
  assert.equal(at(19, 0.25, 25), 0, 'but none on the player standing there');
  assert.ok(sent.some((m) => m.type === 'build' && m.entry[0] === 'd'));

  const canal = setup('canal');
  canal.game.world.build(
    [cellOf(-2, 0), cellOf(7.25, 1), cellOf(10.5, 2)],
    [cellOf(1.9, 0), cellOf(7.25, 1), cellOf(12.4, 2)],
    M.gravel,
  ); // gravel under one of the bridges between the roofs, out over the water
  const before = canal.game.world.history.length;
  canal.game.carve([0, 7.25, 11.5], 1.6);
  canal.run(2);
  for (let x = -1.25; x < 1.5; x += 0.5)
    for (let z = 10.25; z < 13; z += 0.5)
      assert.notEqual(canal.at(x, 0.25, z), M.gravel, 'gravel that lands in the water sinks');
  assert.equal(canal.game.world.history.length, before + 1, 'nothing put down but the hole');
});

test('a tree cut through topples over, and crushes whoever it lands on', () => {
  const { game, sent, add, run, at } = setup();
  const cutter = add('Cutter', [16, 0, 16]);
  const victim = add('Victim', [0, 0, 16]);
  game.carve([12.8, 2.25, 9], 0.6, cutter.id); // through the trunk of a tree in the field, 2 m up, from the west: it falls east
  const fall = sent.find((m) => m.type === 'fall');
  assert.ok(fall, 'the top comes loose');
  const materials = new Set(fall.cells.filter((_, i) => i % 4 === 3));
  assert.ok(
    fall.cells.length / 4 > 30 && materials.has(M.bark) && materials.has(M.foliage),
    'the rest of the trunk and the leaves',
  );
  assert.ok(fall.topple, 'it topples over');
  assert.equal(at(13.25, 4, 9.25), 0, 'everyone takes it away while it falls');
  assert.equal(at(13.25, 1, 9.25), M.bark, 'the stump stays');
  // The victim stands where it will come down.
  const { shape } = game.physics.falling.get(fall.id);
  const { dy } = drop(game.world, shape);
  const ground = shape
    .map(([ix, iy, iz]) => [ix, iy - dy, iz])
    .filter(([, iy]) => cellCentre(0, iy, 0)[1] < 0.5);
  assert.ok(ground.length, 'part of it comes to rest on the ground');
  const [x, , z] = cellCentre(...ground[0]);
  victim.feet = [x, 0, z];
  run(fall.ms / 1000 + 0.1);
  const landed = sent.find((m) => m.type === 'landed');
  assert.ok(landed.entry.length > 4, 'it lies where it landed');
  const offset = fall.topple.axis === 'x' ? Math.abs(x - 13) : Math.abs(z - 9);
  assert.ok(offset > 0.75, `over to one side of where it stood: ${offset.toFixed(2)} m`);
  assert.equal(victim.alive, false);
  assert.deepEqual(
    sent.find((m) => m.type === 'kill'),
    {
      type: 'kill',
      killer: cutter.id,
      victim: victim.id,
      head: false,
      weapon: 'crush',
      spree: 1,
      multi: 1,
      first: true,
    },
  );
  assert.ok(sent.some((m) => m.type === 'medal' && m.medal === 'demolition' && m.id === cutter.id));
});

test("what a planet's pieces knock loose comes down on nobody", () => {
  const { game, sent, add, run } = setup();
  const victim = add('Victim', [0, 0, 16]);
  game.carve([12.8, 2.25, 9], 0.6, null, { harmless: true }); // the same tree, chipped through by a piece of a planet
  const fall = sent.find((m) => m.type === 'fall');
  assert.ok(fall?.topple, 'it still topples over');
  const { shape } = game.physics.falling.get(fall.id);
  const { dy } = drop(game.world, shape);
  const ground = shape
    .map(([ix, iy, iz]) => [ix, iy - dy, iz])
    .filter(([, iy]) => cellCentre(0, iy, 0)[1] < 0.5);
  const [x, , z] = cellCentre(...ground[0]);
  victim.feet = [x, 0, z]; // right where it comes down
  run(fall.ms / 1000 + 0.1);
  assert.ok(
    sent.some((m) => m.type === 'landed'),
    'it lands',
  );
  assert.deepEqual([victim.alive, victim.hp], [true, 100], 'on nobody');
  assert.ok(!sent.some((m) => m.type === 'kill'));
});

test('a bridge cut at both ends falls into the canal; an island of floor cut loose falls out of the arena', () => {
  const { game, sent, run, at } = setup('canal');
  for (const z of [20.5, 22, 23.5]) for (const x of [-4, 4]) game.carve([x, 2.25, z], 1.6); // right across both ends of the south one
  const fall = sent.find((m) => m.type === 'fall');
  assert.ok(
    fall && fall.cells.length / 4 > 100,
    `the middle of the bridge comes loose: ${fall && fall.cells.length / 4} cells`,
  );
  run(fall.ms / 1000 + 0.1);
  assert.equal(at(0, 2.25, 22), 0, 'a gap where it was');
  assert.equal(at(0, 0.25, 22), M.stone, 'it lies on the bottom of the canal');

  const field = setup();
  // A ring of holes in open floor: the island inside it holds nothing up and hangs from nothing.
  for (let a = 0; a < 64; a++)
    field.game.carve(
      [3 * Math.cos((a / 64) * Math.PI * 2), -0.25, 12 + 3 * Math.sin((a / 64) * Math.PI * 2)],
      0.6,
    );
  const out = field.sent.find((m) => m.type === 'fall');
  assert.ok(out && out.cells.length / 4 > 40, 'the island comes loose');
  assert.equal(out.drop, -1, 'nothing under it');
  field.run(out.ms / 1000 + 0.1);
  assert.deepEqual(field.sent.find((m) => m.type === 'landed').entry, ['d'], 'gone');
});

test('ordinary holes bring nothing down', () => {
  const { game, sent } = setup();
  game.carve([0, -0.25, 12], 1.6); // in the floor
  game.carve([22, 2, 14], 1.6); // in the side of one of the forts' towers
  game.carve([36.25, 2, 0], 1); // in the side of a pillar, not right through it
  assert.equal(sent.filter((m) => m.type === 'fall').length, 0);
});
