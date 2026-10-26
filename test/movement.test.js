// Movement: acceleration, friction, bunny hops, strafe-jumping, dodging and jump pads; and
// on the maps, walking up steps, sliding on spilt oil and swimming in the canal.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { AIR_ACCEL, DODGE_SPEED, GRAVITY, JUMP_SPEED, MOVE_SPEED, SPEED_CAP } from '../shared/constants.js';
import { AIR, GRID_SIZE, MAP_ORDER, useMap } from '../shared/map.js';
import { moveState, onSlippery, stepMovement, wishDirection } from '../shared/movement.js';
import { Voxels, cellOf } from '../shared/voxels.js';

const DT = 1 / 60;
const flat = (v) => Math.hypot(v[0], v[2]);
const still = () => ({ forward: 0, strafe: 0, yaw: 0 });

// Runs the movement for a while; steer(state, t) returns the input for each step. options: the rules
// (Arena's, unless it says otherwise).
function simulate(world, state, seconds, steer, start = 0, options = {}) {
  for (let t = 0; t < seconds; t += DT)
    stepMovement(state, steer(state, t), DT, world, start + t * 1000, options);
  return state;
}

// The Fort with nothing standing on its floor (nor a roof over it): room to run anywhere.
function open() {
  useMap('fort');
  const world = new Voxels('dm', 'fort');
  world.cells.fill(AIR, GRID_SIZE[0] * GRID_SIZE[2]); // everything above the floor slab
  return world;
}

const lane = () => moveState([-15, 0, -12]);

test('running gets you up to speed quickly, and friction stops you quickly', () => {
  const world = open();
  const state = lane();
  simulate(world, state, 0.05, still); // settle on the floor
  simulate(world, state, 0.3, () => ({ forward: 0, strafe: 1, yaw: 0 }));
  assert.ok(Math.abs(flat(state.velocity) - MOVE_SPEED) < 0.3, `running at ${flat(state.velocity)}`);
  simulate(world, state, 0.4, still);
  assert.ok(flat(state.velocity) < 0.1, `still moving at ${flat(state.velocity)}`);
});

test('a jump goes up about 1.4 m: onto a 1 m crate, but not onto anything 1.5 m high', () => {
  const world = open();
  const state = lane();
  simulate(world, state, 0.05, still);
  let top = 0;
  simulate(world, state, 1, (now, t) => {
    top = Math.max(top, now.feet[1]);
    return { forward: 0, strafe: 0, yaw: 0, jump: t < 0.05 };
  });
  assert.ok(Math.abs(top - JUMP_SPEED ** 2 / (2 * GRAVITY)) < 0.1, `up ${top.toFixed(2)} m`);
  assert.ok(top > 1 && top < 1.5);
});

test('a bunny hop keeps the speed that friction would take away', () => {
  const world = open();
  const hopping = lane();
  const walking = lane();
  for (const state of [hopping, walking]) {
    simulate(world, state, 0.05, still);
    state.velocity[0] = 12;
  }
  simulate(world, hopping, 1.5, () => ({ forward: 0, strafe: 1, yaw: 0, jump: true }));
  simulate(world, walking, 1.5, () => ({ forward: 0, strafe: 1, yaw: 0 }));
  assert.ok(flat(hopping.velocity) > 11, `hopping at ${flat(hopping.velocity)}`);
  assert.ok(flat(walking.velocity) < MOVE_SPEED + 0.1, `walking at ${flat(walking.velocity)}`);
});

test('strafe-jumping builds speed: turning while strafing in the air', () => {
  const world = open();
  const state = moveState([-25, 0, -25]);
  simulate(world, state, 0.05, still);
  // An ideal strafe-jumper: W and D held, jumping the moment they land, and turning so the wished
  // direction stays just wide enough of the way they're moving to keep adding speed. That angle
  // widens as they speed up.
  state.velocity[0] = MOVE_SPEED * Math.SQRT1_2;
  state.velocity[2] = MOVE_SPEED * Math.SQRT1_2;
  let top = 0;
  simulate(world, state, 1.5, (s) => {
    const heading = Math.atan2(s.velocity[0], s.velocity[2]);
    const best = Math.acos(Math.min(1, (MOVE_SPEED - AIR_ACCEL * DT * MOVE_SPEED) / flat(s.velocity))) + 0.03;
    const wishAngle = heading - best; // to the right
    // W + D wishes 45° to the right of where you face: face 45° left of the wished direction.
    const yaw = wishAngle + Math.PI + Math.PI / 4;
    top = Math.max(top, flat(s.velocity));
    return { forward: 1, strafe: 1, yaw, jump: true };
  });
  assert.ok(top > 13, `top speed ${top.toFixed(1)}`);
  assert.ok(top <= SPEED_CAP + 1.5, `but it fades above the cap: ${top.toFixed(1)}`);
  void wishDirection;
});

test('a dodge is a quick dash, with a cooldown, and only once more in the air', () => {
  const world = open();
  const state = lane();
  simulate(world, state, 0.05, still);
  const first = stepMovement(state, { forward: 0, strafe: 1, yaw: 0, dodge: true }, DT, world, 1000);
  assert.equal(first.dodged, true);
  assert.ok(flat(state.velocity) >= DODGE_SPEED - 0.5, `dodged at ${flat(state.velocity)}`);
  const second = stepMovement(state, { forward: 0, strafe: 1, yaw: 0, dodge: true }, DT, world, 1100);
  assert.equal(second.dodged, false, 'cooling down');
  const later = stepMovement(state, { forward: 0, strafe: 1, yaw: 0, dodge: true }, DT, world, 3000);
  assert.equal(later.dodged, true, 'in the air, once');
  const again = stepMovement(state, { forward: 0, strafe: 1, yaw: 0, dodge: true }, DT, world, 5000);
  assert.equal(again.dodged, false, 'not twice in one jump');
});

test('on every map, every jump pad throws you onto the spot it aims at', () => {
  for (const id of MAP_ORDER) {
    const map = useMap(id);
    const world = new Voxels('dm', id);
    for (const pad of map.pads) {
      // From the pad, until you come down on something (where you land, not where you slide to).
      const state = moveState([pad.at[0], pad.at[1] + 0.2, pad.at[2]]);
      let flying = false;
      for (let t = 0; t < 3; t += DT) {
        stepMovement(state, still(), DT, world, t * 1000);
        if (!state.onGround) flying = true;
        else if (flying) break;
      }
      const miss = Math.hypot(...state.feet.map((v, i) => v - pad.to[i]));
      assert.ok(
        miss < 0.6 && state.onGround,
        `${id}: the pad at ${pad.at} put you down at ${state.feet.map((v) => v.toFixed(2))}, not ${pad.to}`,
      );
    }
  }
});

test('jump pads survive blasts', () => {
  const map = useMap('depot');
  const world = new Voxels('dm', 'depot');
  const [x, y, z] = map.pads[0].at;
  world.carve([x, y - 0.25, z], 3);
  assert.notEqual(world.get(cellOf(x, 0), cellOf(y - 0.25, 1), cellOf(z, 2)), 0);
});

test('you walk up steps half a metre high without jumping: up onto the wall of a fort', () => {
  useMap('fort');
  const world = new Voxels('dm', 'fort');
  const state = moveState([28.5, 0, 8]); // the steps up to the east fort's wall climb from x = 27 to 24, 3 m up
  simulate(world, state, 0.05, still);
  simulate(world, state, 0.6, () => ({ forward: 0, strafe: -1, yaw: 0 }));
  simulate(world, state, 0.4, still);
  assert.ok(
    Math.abs(state.feet[1] - 3) < 0.01 && state.feet[0] < 24.5 && state.feet[0] > 22.5,
    `on the wall: ${state.feet.map((v) => v.toFixed(2))}`,
  );
});

test('on spilt oil you slide: slow to get going, and slow to stop', () => {
  useMap('depot');
  const world = new Voxels('dm', 'depot');
  const oil = moveState([28, 0, 5]); // the oil in front of the engines in the east shed
  const asphalt = moveState([28, 0, 0]); // the floor beside it
  assert.ok(onSlippery(oil.feet, world) && !onSlippery(asphalt.feet, world));
  for (const state of [oil, asphalt]) {
    simulate(world, state, 0.05, still);
    simulate(world, state, 0.3, () => ({ forward: 0, strafe: 1, yaw: 0 }));
  }
  assert.ok(flat(oil.velocity) < MOVE_SPEED / 2, `on oil, only up to ${flat(oil.velocity).toFixed(1)} m/s`);
  assert.ok(flat(asphalt.velocity) > MOVE_SPEED - 0.5);
  for (const state of [oil, asphalt]) {
    state.velocity[0] = MOVE_SPEED;
    simulate(world, state, 0.5, still);
  }
  assert.ok(flat(oil.velocity) > 4, `still sliding at ${flat(oil.velocity).toFixed(1)} m/s`);
  assert.ok(flat(asphalt.velocity) < 0.1);
});

test('in the canal you sink slowly and wade slower, and holding jump swims you up to the surface', () => {
  useMap('canal');
  const world = new Voxels('dm', 'canal'); // the canal's bottom is at 0, the water up to 1.5
  const sinking = moveState([-3.5, 1, 15]);
  simulate(world, sinking, 0.3, still);
  const sank = 1 - sinking.feet[1];
  assert.ok(sank > 0.1 && sank < 0.4, `sank ${sank.toFixed(2)} m in 0.3 s, where a fall would be 0.9 m`);

  const wading = moveState([-3.5, 0, 15]); // on the bottom
  simulate(world, wading, 0.1, still);
  simulate(world, wading, 0.6, () => ({ forward: 0, strafe: 1, yaw: 0 }));
  assert.ok(
    Math.abs(flat(wading.velocity) - MOVE_SPEED * 0.7) < 0.3,
    `wading at ${flat(wading.velocity).toFixed(2)} m/s`,
  );

  const swimmer = moveState([-3.5, 0.5, 15]);
  let top = swimmer.feet[1];
  simulate(world, swimmer, 1.2, (now) => {
    top = Math.max(top, now.feet[1]);
    return { forward: 0, strafe: 0, yaw: 0, jump: true };
  });
  assert.ok(top > 1.4, `swam up to the surface, feet at ${top.toFixed(2)}`);
  useMap('depot');
});
