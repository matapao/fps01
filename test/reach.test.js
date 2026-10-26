// Elevated roofs and platforms catch the hook even with a walking route. Lower surfaces still
// need to be somewhere you couldn't walk to (shared/reach.js).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { useMap } from '../shared/map.js';
import { canHook, effort, walkable } from '../shared/reach.js';
import { Voxels } from '../shared/voxels.js';

const UP = [0, 1, 0];
const DOWN = [0, -1, 0];
const SOUTH = [0, 0, 1];
const WEST = [-1, 0, 0];
useMap('depot');
const depot = new Voxels('dm', 'depot');
const canal = new Voxels('dm', 'canal');

test('the hook catches on top of things too tall to jump onto', () => {
  assert.equal(canHook(depot, [6.5, 0, 14.5], [6.5, 3.5, 10], UP), true, 'the roof of a box wagon, 3.5 m');
  assert.equal(
    canHook(depot, [14, 0, 14.5], [14, 3, 10], UP),
    true,
    'a tank wagon, 3 m: a jump only gets you 1.4 m up',
  );
  assert.equal(canHook(depot, [18, 0, 19], [18, 6, 25], UP), true, 'the gravel in a bunker, 6 m');
  assert.equal(
    canHook(canal, [-32, 0, -16], [-32, 10.5, -24], UP),
    true,
    'the tower in the west square, 10.5 m',
  );
  assert.equal(
    canHook(canal, [-32, 0, -16], [-32, 10.25, -21.5], SOUTH),
    true,
    'the side of its top, just under the edge: the pull lifts you over',
  );
});

test('the hook catches overhead surfaces even when steps or a route lead there', () => {
  assert.equal(walkable(depot, [18, 0, 4.5], [22, 2, 4]), true, 'the crates have a step beside them');
  assert.equal(canHook(depot, [18, 0, 4.5], [22, 2, 4], UP), true, 'their elevated top still catches');
  assert.equal(
    canHook(canal, [10, 0, 11.5], [10, 7.5, 11.5], DOWN),
    true,
    'the underside of the bridge right above you',
  );
  assert.equal(walkable(canal, [12, 0, 0], [0, 2.5, 0]), true, 'steps lead up to the bridge');
  assert.equal(canHook(canal, [12, 0, 0], [0, 2.5, 0], UP), true, 'the bridge still catches from the street');
});

test('the hook does not catch low surfaces you could walk or jump to', () => {
  assert.equal(canHook(depot, [-4, 0, 14.5], [4, 0, 14.5], UP), false, 'the floor you stand on');
  assert.equal(
    canHook(depot, [5, 0, 16.5], [8, 1, 16.5], UP),
    false,
    'a 1 m stack of sleepers you can jump onto',
  );
  assert.equal(
    canHook(canal, [33, 0, 6], [36, 1.2, 6], WEST),
    false,
    'a pillar at chest height: it would only drag you to its foot',
  );
  assert.equal(canHook(canal, [10, 0, 16], [13, 2, 16], WEST), false, 'the side of a house, halfway up');
});

test('jumping toward a platform does not make its top or edge stop catching', () => {
  for (const height of [0, 0.5, 0.95, 1.3, 2.2]) {
    assert.equal(canHook(depot, [18, height, 4.5], [22, 2, 4], UP), true, `in the air at ${height}`);
    assert.equal(canHook(depot, [18, height, 4.5], [21, 1.825, 4.125], WEST), true);
  }
  assert.equal(canHook(depot, [22, 2, 4], [23, 2, 4], UP), false, 'already on that platform');
});

test('walking counts steps up of up to a metre, drops of any height, and goes round walls', () => {
  assert.equal(walkable(depot, [18, 0, 4.5], [22, 2, 4]), true, 'up the box onto the crates');
  assert.equal(walkable(depot, [22, 2, 4], [18, 0, 0]), true, 'and down again');
  assert.equal(walkable(canal, [16, 0, 7], [10, 0, 7]), true, 'out of a house, by its door');
  assert.equal(
    walkable(depot, [6.5, 0, 14.5], [6.5, 3.5, 10]),
    false,
    'no way up onto a wagon without a jump pad or the hook',
  );
});

test('blowing away the step up to something makes it out of reach on foot, and then the hook catches there', () => {
  const holed = new Voxels('dm', 'depot');
  const from = [18, 0, 4.5];
  const top = [22, 2, 4];
  holed.carve([20.5, 0.5, 4.5], 0.8); // the 1 m box beside the crates
  assert.equal(walkable(holed, from, top), false);
  assert.equal(canHook(holed, from, top, UP), true);
});

test('working it out looks at a bounded part of the arena: a few milliseconds at most', () => {
  // From one corner of the Depot to the far side of it: the longest search there is.
  canHook(depot, [-30, 0, -30], [30, 1.5, 6], UP);
  assert.ok(effort.spots > 1000 && effort.spots < 60000, `${effort.spots} spots looked at`);
  walkable(depot, [-30, 0, -30], [-29, 0, -30]);
  assert.ok(effort.spots < 50, `a step away: ${effort.spots} spots`);
});
