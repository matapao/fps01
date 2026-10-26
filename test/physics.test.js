import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { GRAVITY, JUMP_SPEED, PLAYER_HEIGHT, PLAYER_RADIUS } from '../shared/constants.js';
import { AIR, JUMP_PADS, MATERIALS, PILLAR, VOID_Y, useMap } from '../shared/map.js';
import { M } from '../shared/materials.js';
import { moveAndCollide, rayBox, rayWorld } from '../shared/physics.js';
import { Voxels, cellOf } from '../shared/voxels.js';

const STEP = 1 / 120;

function simulate(world, feet, velocity, seconds) {
  let onGround = false;
  for (let t = 0; t < seconds; t += STEP) {
    velocity[1] -= GRAVITY * STEP;
    onGround = moveAndCollide(world, feet, velocity, STEP);
  }
  return onGround;
}

const near = (a, b, tolerance = 1e-3) => Math.abs(a - b) < tolerance;

// These are on the Depot, as the tests' copy of the data has it: open asphalt at (-15, 0, 14.5) under a roof 15 m up, the signal box
// in the south yard (its north wall at z = 21 … 21.5, x = -3.5 … 3.5), the platform 1 m up in the
// middle under a skylight, a stack of sleepers at x 7…11, z 15.5…17.5 (1 m, with another 0.5 m on
// top from x = 8), and a gravel bunker with its bottom 3 m up at x 16…20, z 23…27.
useMap('depot');
const LANE = 14.5;

test('walking into a wall stops at its surface', () => {
  const world = new Voxels();
  const feet = [0, 0, 14];
  simulate(world, feet, [0, 0, 5], 2);
  assert.ok(near(feet[2], 21 - PLAYER_RADIUS), `stopped at z = ${feet[2]}`);
});

test('the floor holds you, and through a hole in it you fall into the void', () => {
  const world = new Voxels();
  const feet = [-15, 1, LANE];
  assert.equal(simulate(world, feet, [0, 0, 0], 1), true);
  assert.ok(near(feet[1], 0), `standing at y = ${feet[1]}`);
  world.carve([-15, -0.25, LANE], 1.6);
  assert.equal(simulate(world, feet, [0, 0, 0], 1.5), false);
  assert.ok(feet[1] < VOID_Y, `still falling at y = ${feet[1]}`);
});

test('standing still counts as standing, even when a frame is split into small steps', () => {
  // The browser applies gravity once per frame, then moves in several steps: only the first moves down.
  const world = new Voxels();
  const feet = [-15, 0, LANE];
  const velocity = [0, 0, 0];
  for (let frame = 0; frame < 10; frame++) {
    velocity[1] -= GRAVITY / 60;
    let onGround = false;
    for (let step = 0; step < 3; step++) onGround = moveAndCollide(world, feet, velocity, 1 / 180);
    assert.equal(onGround, true, `frame ${frame}`);
  }
  assert.ok(near(feet[1], 0));
});

test('a falling player lands on top of a block', () => {
  const world = new Voxels();
  const feet = [0, 5, 0]; // over the platform, 1 m up
  assert.equal(simulate(world, feet, [0, 0, 0], 1), true);
  assert.ok(near(feet[1], 1), `on the platform at y = ${feet[1]}`);
});

test('a running jump gets onto a 1 m block', () => {
  const world = new Voxels();
  const feet = [5, 0, 16.5]; // the sleepers start at x = 7, the half metre on top of them at 8
  simulate(world, feet, [3.5, JUMP_SPEED, 0], 1.2);
  assert.ok(near(feet[1], 1), `ended at y = ${feet[1]}`);
  assert.ok(near(feet[0], 8 - PLAYER_RADIUS), `against the stack on top at x = ${feet[0]}`);
});

test('standing, you walk up onto something half a metre high, but not a metre', () => {
  const world = new Voxels();
  world.build([cellOf(-14, 0), 1, cellOf(-16, 2)], [cellOf(-12.1, 0), 1, cellOf(-14.1, 2)], M.crate); // a step 0.5 m high, from x = -14
  const feet = [-16, 0, -15];
  const velocity = [0, 0, 0];
  for (let t = 0; t < 1; t += STEP) {
    velocity[0] = 3;
    velocity[1] -= GRAVITY * STEP;
    moveAndCollide(world, feet, velocity, STEP, true);
  }
  assert.ok(near(feet[1], 0.5), `up the step: y = ${feet[1]}`);
  const wall = [5, 0, 16.5]; // the sleepers, a metre high
  for (let t = 0; t < 1; t += STEP) {
    const push = [3, -1, 0];
    moveAndCollide(world, wall, push, STEP, true);
  }
  assert.ok(near(wall[1], 0) && near(wall[0], 7 - PLAYER_RADIUS), `stopped by the sleepers: ${wall}`);
});

test('your head stops at what is over it', () => {
  const world = new Voxels();
  const feet = [18, 0, 25]; // under a gravel bunker, its bottom 3 m up
  moveAndCollide(world, feet, [0, 40, 0], 0.024); // a hard shove upwards, in small steps
  for (let i = 0; i < 30; i++) moveAndCollide(world, feet, [0, 40, 0], 0.01);
  assert.ok(near(feet[1] + PLAYER_HEIGHT, 3), `head at ${feet[1] + PLAYER_HEIGHT}`);
});

test('rays stop at floors and walls, and say which cell and face they hit', () => {
  const world = new Voxels();
  const down = [0, -Math.SQRT1_2, -Math.SQRT1_2];
  assert.ok(near(rayWorld(world, [-15, 1, LANE], down, 100), Math.SQRT2, 1e-9));
  const hit = world.raycast([0, 1, 14], [0, 0, 1], 100);
  assert.ok(near(hit.distance, 7, 1e-9));
  assert.deepEqual(hit.normal, [0, 0, -1]);
  assert.equal(hit.cell[2], cellOf(21.25, 2));
  assert.equal(rayWorld(world, [0, 1, 14], [0, 0, 1], 2), 2, 'capped at the distance asked for');
});

test('rays stop at the roof; through a skylight, a hole blown in it, or between the pillars they go on into space', () => {
  const world = new Voxels();
  assert.ok(near(world.raycast([-20, 1.6, LANE], [0, 1, 0], 100).distance, 15 - 1.6), 'the roof, 15 m up');
  assert.equal(world.raycast([0, 2.6, 0], [0, 1, 0], 100), null, 'a skylight');
  world.carve([-20, 15.25, LANE], 1.6);
  assert.equal(world.raycast([-20, 1.6, LANE], [0, 1, 0], 100), null, 'a hole in the roof');
  assert.equal(world.raycast([30, 1.6, 21], [1, 0, 0], 100), null, 'out between two pillars');
  assert.ok(near(world.raycast([30, 1.6, 24], [1, 0, 0], 100).distance, 6), 'and into one');
});

test('rayBox measures the distance to a box ahead and misses one behind', () => {
  const box = { min: [4, -1, -1], max: [6, 1, 1] };
  assert.equal(rayBox([0, 0, 0], [1, 0, 0], box), 4);
  assert.equal(rayBox([0, 0, 0], [-1, 0, 0], box), Infinity);
});

test('blasts carve breakable cells within the radius, the pillars too but not the jump pads, the same way every time', () => {
  const world = new Voxels();
  const removed = world.carve([0, 1, 35], 3);
  assert.ok(removed.length > 0);
  assert.equal(world.get(cellOf(0, 0), cellOf(1, 1), cellOf(36.25, 2)), AIR, 'a hole in the pillar there');
  assert.equal(world.get(cellOf(0, 0), cellOf(-0.25, 1), cellOf(35, 2)), AIR, 'and the floor by it');
  const [x, y, z] = JUMP_PADS[0].at;
  world.carve([x, y, z], 3);
  assert.equal(
    MATERIALS[world.get(cellOf(x, 0), cellOf(y - 0.25, 1), cellOf(z, 2))].name,
    'jump pad',
    'the jump pad stands',
  );
  const replay = new Voxels();
  for (const entry of world.history) replay.apply(entry);
  assert.deepEqual(replay.cells, world.cells);
  world.reset();
  assert.deepEqual(world.cells, new Voxels().cells);
  assert.deepEqual(world.history, []);
});

test('bullets chip a cell until it breaks off, and the break replays like any other hole', () => {
  const world = new Voxels();
  const crate = [cellOf(22.25, 0), cellOf(0.75, 1), cellOf(4.25, 2)]; // a stack of crates by the end of the platform: 3 hits each
  assert.deepEqual([world.chip(...crate), world.chip(...crate)], [1, 2]);
  assert.ok(Math.abs(world.worn(...crate) - 2 / 3) < 1e-9);
  assert.equal(world.chip(...crate), -1, 'the third breaks it');
  assert.equal(world.get(...crate), AIR);
  assert.equal(world.worn(...crate), 0);
  const replay = new Voxels();
  for (const entry of world.history) replay.apply(entry);
  assert.deepEqual(replay.cells, world.cells);
  const pillar = [0, cellOf(1, 1), cellOf(-17.75, 2)]; // the west side of a pillar on the west edge
  for (let hit = 1; hit < 14; hit++) assert.equal(world.chip(...pillar), hit);
  assert.equal(world.get(...pillar), PILLAR, 'a pillar takes thirteen hits…');
  assert.equal(world.chip(...pillar), -1);
  assert.equal(world.get(...pillar), AIR, '…and breaks on the fourteenth');
});
