import { mapVector } from '../shared/vector.js';
import { isVector } from '../shared/snapshot-parts.js';
/** @typedef {import('../shared/contracts.ts').Vector3} Vector3  @typedef {import('../shared/runtime-types.ts').GameSocket} GameSocket */
// Small helpers the server's modules share.

import { PLAYER_RADIUS } from '../shared/constants.js';
import { ARENA_HALF, TOP, VOID_Y } from '../shared/map.js';

const SPACE = 60; // how far out from the arena a player can get before the void takes them

// Names for players and games, in the order they come: Player One, Player Two … Player Twenty, then 21 on.
const WORDS = [
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
  'Twenty',
];

// The first of "<what> One", "<what> Two" … that isn't taken (a set of names).
/** @param {string} what @param {Set<string>} taken */
export function firstFree(what, taken) {
  for (let n = 1; ; n++) {
    const name = `${what} ${WORDS[n - 1] ?? n}`;
    if (!taken.has(name)) return name;
  }
}

/** @param {GameSocket} socket @param {unknown} message */
export function send(socket, message) {
  sendText(socket, JSON.stringify(message));
}

// A stalled browser must not grow a server's outgoing queue without a limit.
/** @param {GameSocket} socket @param {string} text */
export function sendText(socket, text) {
  if (socket.readyState !== socket.OPEN) return;
  if (socket.bufferedAmount > 1024 * 1024) return socket.terminate();
  socket.send(text);
}

/** @param {unknown} value */
export function toVector(value) {
  return isVector(value) ? mapVector(value, (v) => v) : null;
}

/** @param {unknown} value */
export function toDirection(value) {
  const vector = toVector(value);
  if (!vector) return null;
  const length = Math.hypot(...vector);
  return Number.isFinite(length) && length > 1e-6
    ? mapVector(vector, (component) => component / length)
    : null;
}

// Inside the arena.
/** @param {Vector3} point  @returns {Vector3} */
export function clampToArena([x, y, z]) {
  const limit = ARENA_HALF - PLAYER_RADIUS;
  return [clamp(x, -limit, limit), clamp(y, VOID_Y - 1, TOP + 6), clamp(z, -limit, limit)];
}

// Where a player can be: in the arena, high above it, or out in space past its walls, falling away.
/** @param {Vector3} point  @returns {Vector3} */
export function clampToSpace([x, y, z]) {
  const limit = ARENA_HALF + SPACE;
  return [clamp(x, -limit, limit), clamp(y, VOID_Y - 1, TOP + SPACE), clamp(z, -limit, limit)];
}

/** @param {number} value @param {number} min @param {number} max */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** @param {number} value */
export function round(value) {
  return Math.round(value * 1000) / 1000;
}

/** @param {Vector3} p @param {number} r @param {{min: Vector3,max:Vector3}} box */
export function sphereInBox(p, r, { min, max }) {
  return (
    p[0] > min[0] - r &&
    p[0] < max[0] + r &&
    p[1] > min[1] - r &&
    p[1] < max[1] + r &&
    p[2] > min[2] - r &&
    p[2] < max[2] + r
  );
}

// A length of time: a fixed number of ms, or a random one between [shortest, longest].
/** @param {number | [number, number]} ms */
export function duration(ms) {
  return Array.isArray(ms) ? ms[0] + Math.random() * (ms[1] - ms[0]) : ms;
}

// A point along a ray.
/** @param {Vector3} origin @param {Vector3} dir @param {number} distance  @returns {Vector3} */
export function along(origin, dir, distance) {
  return mapVector(origin, (value, i) => round(value + dir[i] * distance));
}
