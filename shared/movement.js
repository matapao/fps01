// How players move. On the ground you get up to speed quickly and friction
// slows you down, and you walk up steps half a metre high. In the air you can only nudge your
// velocity, which is what makes strafe-jumping work: turning while strafing in the air adds speed.
// Landing with jump held (a bunny hop) skips the friction, so you keep it. Shift dodges: a quick
// dash. Jump pads throw you up onto something high. On spilt oil you slide; in water
// you wade and swim: slower, nearly floating, and holding jump swims you up.

import {
  AIR_ACCEL,
  DODGE_COOLDOWN_MS,
  DODGE_HOP,
  DODGE_SPEED,
  FRICTION,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_SPEED,
  MOVE_SPEED,
  PAD_COOLDOWN_MS,
  SPEED_CAP,
  STOP_SPEED,
} from './constants.js';
import { DATA } from './data.js';
import { JUMP_PADS, JUMP_PAD_HALF, SLIPPERY, inWater } from './map.js';
import { moveAndCollide } from './physics.js';
import { cellOf } from './voxels.js';

// A fresh movement state. It also keeps the timing of the last dodge and jump pad.
/** @param {import('./contracts.ts').Vector3} feet  @returns {import('./runtime-types.ts').MovementState} */
export function moveState(feet) {
  return {
    feet: [...feet],
    velocity: [0, 0, 0],
    onGround: false,
    dodgeAt: -Infinity,
    airDodged: false,
    padAt: -Infinity,
  };
}

// The direction the keys ask for, along the ground: forward and strafe are -1, 0 or 1.
/** @param {number} forward @param {number} strafe @param {number} yaw  @returns {import('./contracts.ts').Vector3} */
export function wishDirection(forward, strafe, yaw) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const x = strafe * cos - forward * sin;
  const z = -strafe * sin - forward * cos;
  const length = Math.hypot(x, z);
  return length ? [x / length, 0, z / length] : [0, 0, 0];
}

// Moves a player one step. state: feet, velocity, onGround and the timing fields (see moveState),
// changed in place. input: { forward, strafe, yaw, jump (held), dodge (pressed) }. now is in ms.
// Options change the rules: your running speed and the speed cap (a powerup, the zoom, your trick
// item), and for Lift (less gravity and more control in the air). Returns what happened, for
// sounds: { jumped, dodged, pad }.
/** @param {import('./runtime-types.ts').MovementState} state @param {import('./runtime-types.ts').MovementInput} input @param {number} dt @param {import('./voxels.js').Voxels} world @param {number} now @param {{gravity?: number, speed?: number, airAccel?: number, cap?: number}} options */
export function stepMovement(
  state,
  input,
  dt,
  world,
  now,
  { gravity = GRAVITY, speed = MOVE_SPEED, airAccel = AIR_ACCEL, cap = SPEED_CAP } = {},
) {
  const v = state.velocity;
  const water = DATA.movement.water;
  if (water && inWater(state.feet, world.water)) {
    speed *= water.speed;
    gravity *= water.gravity;
    airAccel = Math.max(airAccel, water.accel);
    if (input.jump && !state.onGround) v[1] = Math.max(v[1], water.swim);
  }
  const wish = wishDirection(input.forward, input.strafe, input.yaw);
  /** @type {{jumped: boolean, dodged: boolean, pad: typeof JUMP_PADS[number] | null}} */
  const events = { jumped: false, dodged: false, pad: null };
  if (input.dodge) events.dodged = dodge(state, wish, input.yaw, now);
  if (state.onGround && input.jump) {
    v[1] = JUMP_SPEED;
    state.onGround = false; // and no friction this step: that's the bunny hop
    events.jumped = true;
  }
  if (state.onGround) {
    const grip = onSlippery(state.feet, world) ? DATA.movement.slippery : FIRM;
    friction(v, dt * grip.friction);
    accelerate(v, wish, speed, GROUND_ACCEL * grip.accel, dt);
  } else {
    accelerate(v, wish, speed, airAccel, dt);
  }
  v[1] -= gravity * dt;
  capSpeed(v, dt, cap);
  // Small steps, so a fast fall can't pass through a floor.
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  for (let i = 0; i < steps; i++) state.onGround = moveAndCollide(world, state.feet, v, dt / steps, true);
  if (state.onGround) {
    state.airDodged = false;
    const pad = padUnder(state.feet);
    if (pad && now - state.padAt > PAD_COOLDOWN_MS) {
      v.splice(0, 3, ...pad.launch);
      state.onGround = false;
      state.padAt = now;
      events.pad = pad;
    }
  }
  return events;
}

// How much of the ground's friction and grip you keep: all of it, or on oil what the data says
// (data/movement.json: slippery). Wading and swimming are there too (water): how much of your speed
// and of gravity you keep, how well you steer, and how fast you swim up.
const FIRM = { friction: 1, accel: 1 };

// Whether someone standing at feet stands on something slippery: what's under their middle.
/** @param {import('./contracts.ts').Vector3} feet @param {import('./voxels.js').Voxels} world */
export function onSlippery(feet, world) {
  return SLIPPERY[world.get(cellOf(feet[0], 0), cellOf(feet[1] - 0.25, 1), cellOf(feet[2], 2))];
}

// The jump pad someone standing at feet is on, if any.
/** @param {import('./contracts.ts').Vector3} feet */
export function padUnder(feet) {
  return (
    JUMP_PADS.find(
      ({ at }) =>
        Math.abs(feet[1] - at[1]) < 0.05 &&
        Math.abs(feet[0] - at[0]) <= JUMP_PAD_HALF &&
        Math.abs(feet[2] - at[2]) <= JUMP_PAD_HALF,
    ) ?? null
  );
}

// Acceleration: speeds you up towards wishSpeed along the wished direction, but only
// what's missing along that direction. In the air that lets you gain speed by turning.
/** @param {import('./contracts.ts').Vector3} v @param {import('./contracts.ts').Vector3} wish @param {number} wishSpeed @param {number} accel @param {number} dt */
function accelerate(v, wish, wishSpeed, accel, dt) {
  if (!wish[0] && !wish[2]) return;
  const current = v[0] * wish[0] + v[2] * wish[2];
  const add = wishSpeed - current;
  if (add <= 0) return;
  const amount = Math.min(accel * dt * wishSpeed, add);
  v[0] += amount * wish[0];
  v[2] += amount * wish[2];
}

/** @param {import('./contracts.ts').Vector3} v @param {number} dt */
function friction(v, dt) {
  const speed = Math.hypot(v[0], v[2]);
  if (speed < 0.05) {
    v[0] = v[2] = 0;
    return;
  }
  const drop = Math.max(speed, STOP_SPEED) * FRICTION * dt;
  const scale = Math.max(0, speed - drop) / speed;
  v[0] *= scale;
  v[2] *= scale;
}

// Very fast running fades back towards the cap, so you stay in control indoors.
/** @param {import('./contracts.ts').Vector3} v @param {number} dt @param {number} cap */
function capSpeed(v, dt, cap) {
  const speed = Math.hypot(v[0], v[2]);
  if (speed <= cap) return;
  const scale = (speed - (speed - cap) * Math.min(1, 3 * dt)) / speed;
  v[0] *= scale;
  v[2] *= scale;
}

// A dash in the direction you're moving (or looking), once on the ground and once more in the air,
// with a cooldown. It never slows you down.
/** @param {import('./runtime-types.ts').MovementState} state @param {import('./contracts.ts').Vector3} wish @param {number} yaw @param {number} now */
function dodge(state, wish, yaw, now) {
  if (now - state.dodgeAt < DODGE_COOLDOWN_MS || (!state.onGround && state.airDodged)) return false;
  /** @type {import('./contracts.ts').Vector3} */
  const dir = wish[0] || wish[2] ? wish : [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const v = state.velocity;
  const along = v[0] * dir[0] + v[2] * dir[2];
  const boost = Math.max(DODGE_SPEED, along);
  v[0] = (v[0] - dir[0] * along) * 0.5 + dir[0] * boost;
  v[2] = (v[2] - dir[2] * along) * 0.5 + dir[2] * boost;
  v[1] = state.onGround ? DODGE_HOP : Math.max(v[1], DODGE_HOP * 0.6);
  if (!state.onGround) state.airDodged = true;
  state.onGround = false;
  state.dodgeAt = now;
  return true;
}
