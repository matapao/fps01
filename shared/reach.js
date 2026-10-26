import { indexed } from './indexed.js';
// Where you can get to on foot, without the grappling hook: walking, jumping up onto anything a
// metre high or less, and dropping down. Elevated roofs and platforms always catch the hook;
// elsewhere it catches only where you couldn't walk, such as an island cut off by holes.
// The browser asks before it fires the hook; the server asks again before it shows the rope.

import { GRAVITY, JUMP_SPEED, PLAYER_RADIUS } from './constants.js';
import { AIR, CELL, GRID_MIN, GRID_SIZE } from './map.js';
import { cellOf } from './voxels.js';

const [NX, NY, NZ] = GRID_SIZE;
const CLEARANCE = 4; // cells of air a player needs to stand in (2 m)
const STEP = 2; // cells you can jump up onto (1 m)
const CLIMB = 3; // cells above where the hook caught that its pull lifts you over an edge (1.5 m)
const MARGIN = 24; // cells (12 m) a search may stray outside the box around you and the spot
const MOST = 120000; // spots a search looks at, at most
/** @type {[number, number][]} */
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** @type {Uint32Array | null} */
let visited = null; // per cell: the number of the search that last got there
let search = 0;
/** @type {Int32Array | null} */
let queue = null;
export const effort = { spots: 0 }; // how many spots the last search looked at: what it costs

// Whether someone could stand with their feet at the bottom of cell iy: solid under, room above.
/** @param {import('./voxels.js').Voxels} world @param {number} ix @param {number} iy @param {number} iz */
function standable(world, ix, iy, iz) {
  if (world.get(ix, iy - 1, iz) === AIR) return false;
  for (let k = 0; k < CLEARANCE; k++) if (world.get(ix, iy + k, iz) !== AIR) return false;
  return true;
}

// Dropping down a column from cell iy: the cell you'd land in, or -1 for nowhere (the void, space,
// or no room to stand where you'd land).
/** @param {import('./voxels.js').Voxels} world @param {number} ix @param {number} iy @param {number} iz */
function landing(world, ix, iy, iz) {
  for (; iy > 0; iy--) {
    if (world.get(ix, iy - 1, iz) !== AIR) return standable(world, ix, iy, iz) ? iy : -1;
  }
  return -1;
}

// The cell someone standing at feet stands in: under their middle, or under a corner when their
// middle is over a gap.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} feet  @returns {import('./contracts.ts').Vector3 | null} */
function standingCell(world, feet) {
  const iy = cellOf(feet[1] + 0.01, 1);
  for (const [dx, dz] of /** @type {[number, number][]} */ ([
    [0, 0],
    [0.35, 0.35],
    [-0.35, 0.35],
    [0.35, -0.35],
    [-0.35, -0.35],
  ])) {
    const ix = cellOf(feet[0] + dx, 0);
    const iz = cellOf(feet[2] + dz, 2);
    if (standable(world, ix, iy, iz)) return [ix, iy, iz];
  }
  const ix = cellOf(feet[0], 0);
  const iz = cellOf(feet[2], 2);
  const land = landing(world, ix, Math.min(NY - 1, iy), iz);
  return land < 0 ? null : [ix, land, iz];
}

// Whether you could get on foot from feet to a spot (also feet): a search over every place you
// could stand, from one to the next.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} feet @param {import('./contracts.ts').Vector3} spot */
export function walkable(world, feet, spot) {
  const start = standingCell(world, feet);
  if (!start) return false; // falling into the void: nothing is within walking distance
  /** @type {import('./contracts.ts').Vector3} */
  const goal = [cellOf(spot[0], 0), cellOf(spot[1] + 0.01, 1), cellOf(spot[2], 2)];
  /** @type {[number, number]} */
  const lo = [
    Math.max(0, Math.min(start[0], goal[0]) - MARGIN),
    Math.max(0, Math.min(start[2], goal[2]) - MARGIN),
  ];
  /** @type {[number, number]} */
  const hi = [
    Math.min(NX - 1, Math.max(start[0], goal[0]) + MARGIN),
    Math.min(NZ - 1, Math.max(start[2], goal[2]) + MARGIN),
  ];
  if (!visited) {
    visited = new Uint32Array(NX * NY * NZ);
    queue = new Int32Array(MOST);
  }
  if (!queue) throw new Error('Search queue is not initialized');
  search += 1;
  let head = 0;
  let tail = 0;
  /** @param {number} ix @param {number} iy @param {number} iz */
  const visit = (ix, iy, iz) => {
    const i = ix + NX * (iz + NZ * iy);
    if (!visited || !queue) throw new Error('Search storage is not initialized');
    if (visited[i] === search || tail >= MOST) return;
    visited[i] = search;
    queue[tail++] = i;
  };
  visit(...start);
  effort.spots = 0;
  while (head < tail) {
    effort.spots++;
    const i = indexed(queue, head++);
    const iy = Math.floor(i / (NX * NZ));
    const iz = Math.floor((i - iy * NX * NZ) / NX);
    const ix = i - NX * (iz + NZ * iy);
    if (iy === goal[1] && Math.abs(ix - goal[0]) <= 1 && Math.abs(iz - goal[2]) <= 1) return true;
    for (const [dx, dz] of SIDES) {
      const nx = ix + dx;
      const nz = iz + dz;
      if (nx < lo[0] || nz < lo[1] || nx > hi[0] || nz > hi[1]) continue;
      const land = landing(world, nx, Math.min(NY - 1, iy + STEP), nz);
      if (land >= 0) visit(nx, land, nz);
    }
  }
  return false;
}

// The floor under a point (where you'd land dropping from it), as feet, or null.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} point  @returns {import('./contracts.ts').Vector3 | null} */
function floorUnder(world, point) {
  const ix = cellOf(point[0], 0);
  const iz = cellOf(point[2], 2);
  const iy = landing(world, ix, Math.min(NY - 1, cellOf(point[1], 1)), iz);
  return iy < 0 ? null : [point[0], GRID_MIN[1] + iy * CELL, point[2]];
}

// Where the hook would leave you, given where it caught and the surface's normal: on top of what
// it caught, if that's a top or a short climb above (the pull lifts you over the edge), or else on
// the floor under it. Null if there's nothing to stand on there.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} at @param {import('./contracts.ts').Vector3} normal  @returns {import('./contracts.ts').Vector3 | null} */
export function hookSpot(world, at, normal) {
  if (normal[1] === 1) return at;
  if (normal[1] === -1) return floorUnder(world, [at[0], at[1] - 0.05, at[2]]);
  // Look far enough inside the edge for the player's body, including a stair just behind it.
  const inset = PLAYER_RADIUS + CELL / 4;
  const ix = cellOf(at[0] - normal[0] * inset, 0);
  const iz = cellOf(at[2] - normal[2] * inset, 2);
  const iy = cellOf(at[1], 1);
  for (let k = 1; k <= CLIMB; k++) {
    if (world.get(ix, iy + k, iz) !== AIR) continue;
    if (standable(world, ix, iy + k, iz))
      return [at[0] - normal[0] * inset, GRID_MIN[1] + (iy + k) * CELL, at[2] - normal[2] * inset];
    break;
  }
  return floorUnder(world, [at[0] + normal[0] * 0.6, at[1], at[2] + normal[2] * 0.6]);
}

// Elevated flat surfaces catch even when stairs or a distant route lead there. Lower surfaces
// still need to be somewhere you couldn't walk to.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} feet @param {import('./contracts.ts').Vector3} at @param {import('./contracts.ts').Vector3} normal */
export function canHook(world, feet, at, normal) {
  const jumpHeight = JUMP_SPEED ** 2 / (2 * GRAVITY);
  // A jump must not turn a valid roof or platform into an ordinary walkable surface.
  const standing = standingCell(world, feet);
  const support = standing ? Math.min(feet[1], GRID_MIN[1] + standing[1] * CELL) : feet[1];
  if (normal[1] !== 0 && at[1] - support > jumpHeight) return true;
  const spot = hookSpot(world, at, normal);
  if (spot && spot[1] - support > jumpHeight) return true;
  return !spot || !walkable(world, feet, spot);
}
