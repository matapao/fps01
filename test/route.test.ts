// The way on foot (src/agent/route.ts), for the agents' goto: round walls, up steps, jumping onto a
// metre, down drops, and thrown by jump pads; and as near as it goes where there's no way.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { indexed, lookup } from '../shared/indexed.js';
import { route } from '../src/agent/route.ts';
import { AIR, GRID_SIZE, useMap } from '../shared/map.js';
import { M } from '../shared/materials.js';
import { Voxels, cellOf } from '../shared/voxels.js';

type Vec = [number, number, number];

// An empty floor (the Fort's, with nothing standing on it), and boxes put on it.
function floor() {
  useMap('fort');
  const world = new Voxels('dm', 'fort');
  world.cells.fill(AIR, GRID_SIZE[0] * GRID_SIZE[2]);
  const box = (min: Vec, max: Vec) =>
    world.build(
      [cellOf(min[0], 0), cellOf(min[1], 1), cellOf(min[2], 2)],
      [cellOf(max[0] - 0.01, 0), cellOf(max[1] - 0.01, 1), cellOf(max[2] - 0.01, 2)],
      lookup(M, 'crate'),
    );
  return { world, box };
}

// Whether a straight line between two waypoints at one height crosses anything solid (feet to head).
function crosses(world: Voxels, a: Vec, b: Vec) {
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.1);
  for (let i = 1; i < steps; i++) {
    const [x, z] = [a[0] + ((b[0] - a[0]) * i) / steps, a[2] + ((b[2] - a[2]) * i) / steps];
    for (let y = Math.max(a[1], b[1]) + 0.1; y < Math.max(a[1], b[1]) + 1.7; y += 0.25)
      if (world.get(cellOf(x, 0), cellOf(y, 1), cellOf(z, 2))) return true;
  }
  return false;
}

test('round a wall, through the gap in it, never through it', () => {
  const { world, box } = floor();
  box([-10, 0, 0], [-1, 3, 0.5]); // a wall across, with a 2 m gap from x = -1 to 1
  box([1, 0, 0], [10, 3, 0.5]);
  const { path, reached } = route(world, [-5, 0, -5], [-5, 0, 5]);
  assert.equal(reached, true);
  assert.ok(
    path.some(([x, , z]) => Math.abs(x) < 1 && Math.abs(z - 0.25) < 1.5),
    `through the gap: ${JSON.stringify(path)}`,
  );
  let from: Vec = [-5, 0, -5];
  for (const point of path) {
    assert.equal(crosses(world, from, point), false, `${from} to ${point}`);
    from = point;
  }
});

test('up a step without jumping, onto a metre with a jump, and not onto a metre and a half', () => {
  const { world, box } = floor();
  box([2, 0, -5], [4, 0.5, 5]); // a step, then a ledge a metre up
  box([4, 0, -5], [6, 1, 5]);
  box([6, 0, -5], [8, 2.5, 5]); // then a wall a metre and a half above the ledge
  const up = route(world, [0, 0, 0], [5, 1, 0]);
  assert.equal(up.reached, true);
  assert.ok(up.path.at(-1)![1] === 1, 'onto the ledge');
  assert.ok(up.jumps.length === 0, 'a step and a step: no jump needed');
  const high = route(world, [5, 1, 0], [7, 2.5, 0]);
  assert.equal(high.reached, false, 'too high to climb');
});

test('a jump needed is marked, where there is head room for it', () => {
  const { world, box } = floor();
  box([2, 0, -5], [4, 1, 5]); // a metre high, no step
  const { path, reached, jumps } = route(world, [0, 0, 0], [3, 1, 0]);
  assert.equal(reached, true);
  assert.equal(jumps.length, 1, JSON.stringify(path));
  assert.equal(path[jumps[0]!]![1], 1, 'onto the top');
});

test('on the Depot, from a spawn to its pickups, and up onto a catwalk by its jump pad', () => {
  const map = useMap('depot');
  const world = new Voxels('dm', 'depot');
  const from = indexed(map.spawns, 0);
  for (const item of map.items.filter((i) => i.at[1] === 0).slice(0, 4)) {
    const { reached, path } = route(world, from, item.at, map.pads);
    assert.equal(reached, true, `${item.piece} at ${item.at}`);
    assert.ok(path.length > 0);
  }
  const pad = map.pads.find((p) => p.to[1] >= 8);
  assert.ok(pad, 'Depot has an authored upper-catwalk jump pad');
  const { reached, path } = route(
    world,
    pad.at.map((v: number, i: number) => (i === 0 ? v - 4 : v)) as Vec,
    pad.to,
    map.pads,
  );
  assert.equal(reached, true, `onto ${pad.to}`);
  assert.ok(
    path.some(([x, y, z]) => Math.abs(x - pad.at[0]) <= 1 && Math.abs(z - pad.at[2]) <= 1 && y === pad.at[1]),
    `by way of the pad: ${JSON.stringify(path)}`,
  );
});

test('where there is no way, as near as it goes', () => {
  const map = useMap('depot');
  const world = new Voxels('dm', 'depot');
  const { reached, path } = route(world, indexed(map.spawns, 0), [0, 40, 0], map.pads);
  assert.equal(reached, false);
  assert.ok(path.length > 0, 'it still goes somewhere');
});
