import { indexed } from './indexed.js';
import { mapVector } from './vector.js';
// The water, on a map with some (the Canal's canal). Blow a hole in its basin and the water runs
// out through it, down to the bottom of the hole: all of it, through a hole in the floor. The server
// lowers the level (server/pool.js) and sends it out; every browser draws the water at that level,
// and finds the same holes to show it pouring out of them.

import { AIR, CELL, GRID_MIN, POOL } from './map.js';
import { cellOf } from './voxels.js';

const PER_HOLE = 0.05; // m/s the level drops for each cell of hole the water gets out through…
const FASTEST = 0.5; // …up to this
/** @type {import('./contracts.ts').Vector3[]} */
const DOWN_AND_ACROSS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, -1, 0],
];

// The level when the pool is full, and when it's empty (0 on a map without one).
export const fullLevel = () => POOL?.max[1] ?? 0;
export const emptyLevel = () => POOL?.min[1] ?? 0;

// Where the water gets out of the basin with its surface at level: the cells just outside the
// basin (the terrace the pool is sunk into) it runs into, as their centres [x, y, z]. Empty while
// the basin holds it.
/** @param {import('./voxels.js').Voxels} world @param {number} level */
export function leaks(world, level) {
  if (!POOL || level <= POOL.min[1] + 0.001) return [];
  const { min, max, basin } = POOL;
  // The basin's cells, and the water's: from the bottom up to the highest layer with water in it.
  const lo = mapVector(basin.min, (v, a) => cellOf(v + 0.01, a));
  const hi = mapVector(basin.max, (v, a) => cellOf(v - 0.01, a));
  const from = mapVector(min, (v, a) => cellOf(v + 0.01, a));
  /** @type {import('./contracts.ts').Vector3} */
  const to = [cellOf(max[0] - 0.01, 0), cellOf(Math.min(level, max[1]) - 0.001, 1), cellOf(max[2] - 0.01, 2)];
  const size = mapVector(hi, (v, a) => v - lo[a] + 1);
  const seen = new Uint8Array(size[0] * size[1] * size[2]);
  /** @param {number} ix @param {number} iy @param {number} iz */
  const key = (ix, iy, iz) => ix - lo[0] + size[0] * (iz - lo[2] + size[2] * (iy - lo[1]));
  /** @type {number[]} */
  const queue = [];
  for (let iy = from[1]; iy <= to[1]; iy++) {
    for (let iz = from[2]; iz <= to[2]; iz++) {
      for (let ix = from[0]; ix <= to[0]; ix++) {
        if (world.get(ix, iy, iz) !== AIR) continue;
        seen[key(ix, iy, iz)] = 1;
        queue.push(ix, iy, iz);
      }
    }
  }
  // From there through any hole: sideways and down, never up, and out of the basin.
  const out = new Set();
  /** @type {import('./contracts.ts').Vector3[]} */
  const openings = [];
  for (let head = 0; head < queue.length; head += 3) {
    const [ix, iy, iz] = [indexed(queue, head), indexed(queue, head + 1), indexed(queue, head + 2)];
    for (const [dx, dy, dz] of DOWN_AND_ACROSS) {
      const [nx, ny, nz] = [ix + dx, iy + dy, iz + dz];
      if (world.get(nx, ny, nz) !== AIR) continue;
      const inside = nx >= lo[0] && nx <= hi[0] && ny >= lo[1] && nz >= lo[2] && nz <= hi[2];
      if (!inside) {
        const id = `${nx},${ny},${nz}`;
        if (!out.has(id)) {
          out.add(id);
          openings.push([
            GRID_MIN[0] + (nx + 0.5) * CELL,
            GRID_MIN[1] + (ny + 0.5) * CELL,
            GRID_MIN[2] + (nz + 0.5) * CELL,
          ]);
        }
        continue;
      }
      const k = key(nx, ny, nz);
      if (seen[k]) continue;
      seen[k] = 1;
      queue.push(nx, ny, nz);
    }
  }
  return openings;
}

// How fast the level drops, in m/s, with the water getting out through these openings.
/** @param {import('./contracts.ts').Vector3[]} openings */
export function drainRate(openings) {
  return Math.min(FASTEST, PER_HOLE * openings.length);
}
