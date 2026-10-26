// How movement spoils your aim: shots scatter inside a cone around where you look. The cone is
// narrow standing still, wider the faster you run, and widest in the air.

import { MOVE_SPEED, SPREAD_AIR, SPREAD_MOVING, SPREAD_STILL } from './constants.js';

/** @typedef {readonly [number, number, number]} Vector3 */

// Half-angle of the cone, in radians, for a velocity [x, y, z].
/** @param {Vector3} velocity @param {boolean} onGround */
export function spreadFor(velocity, onGround) {
  const speed = Math.hypot(velocity[0], velocity[2]);
  return SPREAD_STILL + SPREAD_MOVING * Math.min(1, speed / MOVE_SPEED) + (onGround ? 0 : SPREAD_AIR);
}

// A random direction inside a cone of half-angle `spread` around the unit vector `dir`,
// spread evenly over the cone.
/**
 * @param {Vector3} dir
 * @param {number} spread
 * @param {() => number} random
 * @returns {[number, number, number]}
 */
export function scatter(dir, spread, random = Math.random) {
  /** @type {Vector3} */
  const up = Math.abs(dir[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const side = normalize(cross(dir, up));
  const lift = cross(side, dir);
  const angle = spread * Math.sqrt(random());
  const turn = random() * Math.PI * 2;
  const out = Math.sin(angle);
  /** @param {0 | 1 | 2} i */
  const component = (i) =>
    dir[i] * Math.cos(angle) + (side[i] * Math.cos(turn) + lift[i] * Math.sin(turn)) * out;
  return normalize([component(0), component(1), component(2)]);
}

/** @param {Vector3} a @param {Vector3} b @returns {[number, number, number]} */
function cross([ax, ay, az], [bx, by, bz]) {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/** @param {Vector3} v @returns {[number, number, number]} */
function normalize(v) {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
