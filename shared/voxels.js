import { indexed, lookup } from './indexed.js';
import { AXES, mapVector } from './vector.js';
/** @typedef {import('./contracts.ts').Vector3} Vector3 */
/** @typedef {[number, number, number, number] | ['b', number, number, number, number, number, number, number] | ['x' | 'd', ...number[]]} HistoryEntry */
// The arena as a grid of cells, shared by the server and the browser. Explosions carve holes in it,
// bullets chip cells away one at a time, and pieces that come loose fall and land somewhere else.
// Both sides make the same changes from the same list (its history), in the same order, so they
// always agree. Outside the grid there is nothing: space. It also keeps how high the pool's water
// stands, on a map with a pool, which the server lowers when the basin has a hole in it.

import { onData } from './data.js';
import { AIR, BREAKABLE, CELL, GRID_MIN, GRID_SIZE, HITS, MAP, MAPS, MATERIALS, buildCells } from './map.js';

const [NX, NY, NZ] = GRID_SIZE;
const CHIP = 0.05; // the radius of the "hole" a single chipped-off cell leaves: just that cell

// Each map as new, for each mode: built the first time it's needed, and again when the data changes.
/** @type {Map<string, Uint8Array>} */
const PRISTINE = new Map();
onData(() => PRISTINE.clear());
/** @param {string} map @param {string} mode @returns {Uint8Array} */
function pristine(map, mode) {
  const key = `${map}:${mode}`;
  const before = PRISTINE.get(key);
  if (before) return before;
  const cells = buildCells(lookup(MAPS, map), mode);
  PRISTINE.set(key, cells);
  return cells;
}

// How high the water stands in a map's pool when it's full (0 with no pool).
/** @param {string} map */
const fullOf = (map) => lookup(MAPS, map).pool?.max[1] ?? 0;

export class Voxels {
  /** @param {string} mode @param {string} map */
  constructor(mode = 'dm', map = MAP.id) {
    this.mode = mode;
    this.map = map;
    this.cells = pristine(map, mode).slice();
    // Every change since the arena went up, in order: a hole is [x, y, z, radius]; something
    // built is ['b', x0, y0, z0, x1, y1, z1, material] (cell indices, inclusive); cells taken away
    // (a piece that came loose and fell) are ['x', ix, iy, iz, …]; cells put down (where it, or
    // gravel and hay, landed) are ['d', ix, iy, iz, material, …].
    /** @type {HistoryEntry[]} */
    this.history = [];
    /** @type {Map<number, number>} */
    this.wear = new Map(); // cell index → bullet hits it has taken so far
    this.water = fullOf(map); // the pool's surface
  }

  // Makes one change from a history entry (as the server sent it).
  /** @param {HistoryEntry} entry */
  apply(entry) {
    if (entry[0] === 'b')
      return this.build([entry[1], entry[2], entry[3]], [entry[4], entry[5], entry[6]], entry[7]);
    if (entry[0] === 'x' || entry[0] === 'd') {
      const [, ...cells] = entry;
      return entry[0] === 'x' ? this.remove(cells) : this.deposit(cells);
    }
    return this.carve([entry[0], entry[1], entry[2]], entry[3]);
  }

  // Puts the arena back up as new, for a game mode, on a map.
  reset(mode = this.mode, map = this.map) {
    this.mode = mode;
    this.map = map;
    this.cells.set(pristine(map, mode));
    this.history = [];
    this.wear.clear();
    this.water = fullOf(map);
  }

  /** @param {number} ix @param {number} iy @param {number} iz */
  index(ix, iy, iz) {
    return ix + NX * (iz + NZ * iy);
  }

  // How worn a cell is, from 0 (untouched) towards 1 (about to break).
  /** @param {number} ix @param {number} iy @param {number} iz */
  worn(ix, iy, iz) {
    const hits = HITS[this.get(ix, iy, iz)];
    return hits ? (this.wear.get(this.index(ix, iy, iz)) ?? 0) / hits : 0;
  }

  // A bullet hit a cell. Breakable cells take a chip; after enough, they break off. Returns how many
  // hits the cell has taken, or -1 when this one broke it (or 0 when bullets can't hurt it).
  /** @param {number} ix @param {number} iy @param {number} iz */
  chip(ix, iy, iz) {
    const hits = HITS[this.get(ix, iy, iz)];
    if (!hits || ix < 0 || iz < 0 || ix >= NX || iz >= NZ) return 0;
    const index = this.index(ix, iy, iz);
    const wear = (this.wear.get(index) ?? 0) + 1;
    if (wear < hits) {
      this.wear.set(index, wear);
      return wear;
    }
    this.breakOff(ix, iy, iz);
    return -1;
  }

  // Breaks a cell outright (a charged railgun shot), if bullets can break it. Returns whether it did.
  /** @param {number} ix @param {number} iy @param {number} iz */
  smash(ix, iy, iz) {
    if (!HITS[this.get(ix, iy, iz)] || ix < 0 || iz < 0 || ix >= NX || iz >= NZ) return false;
    this.breakOff(ix, iy, iz);
    return true;
  }

  // Removes one cell, recorded like a tiny blast at its centre so a replay of the holes removes it too.
  /** @param {number} ix @param {number} iy @param {number} iz */
  breakOff(ix, iy, iz) {
    return this.carve(cellCentre(ix, iy, iz), CHIP);
  }

  // The material of a cell. Outside the grid there is nothing: air.
  /** @param {number} ix @param {number} iy @param {number} iz */
  get(ix, iy, iz) {
    if (iy < 0 || iy >= NY || ix < 0 || iz < 0 || ix >= NX || iz >= NZ) return AIR;
    return indexed(this.cells, ix + NX * (iz + NZ * iy));
  }

  /** @param {number} x @param {number} y @param {number} z */
  solidAt(x, y, z) {
    return this.get(cellOf(x, 0), cellOf(y, 1), cellOf(z, 2)) !== AIR;
  }

  // Removes every breakable cell whose centre lies within radius of at, and returns the removed
  // cells as a flat list of [ix, iy, iz] triples. Given a list, adds what each was made of to it.
  /** @param {Vector3} at @param {number} radius @param {number[] | null} materials */
  carve(at, radius, materials = null) {
    this.history.push([at[0], at[1], at[2], radius]);
    const lo = mapVector(at, (v, i) => Math.max(0, cellOf(v - radius, i)));
    const hi = mapVector(at, (v, i) => Math.min(GRID_SIZE[i] - 1, cellOf(v + radius, i)));
    const removed = [];
    for (let iy = lo[1]; iy <= hi[1]; iy++) {
      const dy = GRID_MIN[1] + (iy + 0.5) * CELL - at[1];
      for (let iz = lo[2]; iz <= hi[2]; iz++) {
        const dz = GRID_MIN[2] + (iz + 0.5) * CELL - at[2];
        for (let ix = lo[0]; ix <= hi[0]; ix++) {
          const dx = GRID_MIN[0] + (ix + 0.5) * CELL - at[0];
          const i = ix + NX * (iz + NZ * iy);
          if (!BREAKABLE[indexed(this.cells, i)] || dx * dx + dy * dy + dz * dz > radius * radius) continue;
          materials?.push(indexed(this.cells, i));
          this.cells[i] = AIR;
          this.wear.delete(i);
          removed.push(ix, iy, iz);
        }
      }
    }
    return removed;
  }

  // Takes away the cells listed (a flat [ix, iy, iz, …] list), whatever they are. Returns those that
  // weren't air already.
  /** @param {number[]} cells */
  remove(cells) {
    this.history.push(['x', ...cells]);
    const removed = [];
    for (let k = 0; k < cells.length; k += 3) {
      const [ix, iy, iz] = [indexed(cells, k), indexed(cells, k + 1), indexed(cells, k + 2)];
      if (this.get(ix, iy, iz) === AIR) continue;
      const i = ix + NX * (iz + NZ * iy);
      this.cells[i] = AIR;
      this.wear.delete(i);
      removed.push(ix, iy, iz);
    }
    return removed;
  }

  // Puts down the cells listed (a flat [ix, iy, iz, material, …] list) where there's air. Returns
  // the cells filled.
  /** @param {number[]} cells */
  deposit(cells) {
    this.history.push(['d', ...cells]);
    const filled = [];
    for (let k = 0; k < cells.length; k += 4) {
      const [ix, iy, iz, material] = [
        indexed(cells, k),
        indexed(cells, k + 1),
        indexed(cells, k + 2),
        indexed(cells, k + 3),
      ];
      if (iy < 0 || iy >= NY || ix < 0 || iz < 0 || ix >= NX || iz >= NZ || !MATERIALS[material]) continue;
      const i = ix + NX * (iz + NZ * iy);
      if (this.cells[i] !== AIR) continue;
      this.cells[i] = material;
      filled.push(ix, iy, iz);
    }
    return filled;
  }

  // Fills the air cells in a box of cell indices (inclusive) with a material. Returns the cells filled.
  /** @param {Vector3} lo @param {Vector3} hi @param {number} material */
  build(lo, hi, material) {
    this.history.push(['b', lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], material]);
    const filled = [];
    for (let iy = Math.max(0, lo[1]); iy <= Math.min(NY - 1, hi[1]); iy++) {
      for (let iz = Math.max(0, lo[2]); iz <= Math.min(NZ - 1, hi[2]); iz++) {
        for (let ix = Math.max(0, lo[0]); ix <= Math.min(NX - 1, hi[0]); ix++) {
          const i = ix + NX * (iz + NZ * iy);
          if (this.cells[i] !== AIR) continue;
          this.cells[i] = material;
          filled.push(ix, iy, iz);
        }
      }
    }
    return filled;
  }

  // Walks a ray (dir is a unit vector) through the grid, cell by cell. Returns the first solid cell
  // it enters within maxDistance as { distance, cell: [ix, iy, iz], normal }, or null.
  /** @param {Vector3} origin @param {Vector3} dir @param {number} maxDistance @returns {{distance: number, cell: Vector3, normal: Vector3} | null} */
  raycast(origin, dir, maxDistance) {
    /** @type {Vector3} */
    const cell = [cellOf(origin[0], 0), cellOf(origin[1], 1), cellOf(origin[2], 2)];
    if (this.get(cell[0], cell[1], cell[2]) !== AIR) return { distance: 0, cell, normal: [0, 0, 0] };
    /** @type {Vector3} */
    const step = [0, 0, 0];
    /** @type {Vector3} */
    const next = [Infinity, Infinity, Infinity]; // distance along the ray to the next cell boundary, per axis
    /** @type {Vector3} */
    const delta = [Infinity, Infinity, Infinity]; // distance along the ray between boundaries, per axis
    for (const a of AXES) {
      if (dir[a] === 0) continue;
      step[a] = dir[a] > 0 ? 1 : -1;
      const boundary = GRID_MIN[a] + (cell[a] + (dir[a] > 0 ? 1 : 0)) * CELL;
      next[a] = (boundary - origin[a]) / dir[a];
      delta[a] = CELL / Math.abs(dir[a]);
    }
    for (;;) {
      const a = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : next[1] < next[2] ? 1 : 2;
      const distance = next[a];
      if (distance > maxDistance) return null;
      cell[a] += step[a];
      // Outside the grid and heading away from it: nothing left to hit.
      if ((cell[1] < 0 && step[1] <= 0) || (cell[1] >= NY && step[1] >= 0)) return null;
      if ((cell[0] < 0 && step[0] <= 0) || (cell[0] >= NX && step[0] >= 0)) return null;
      if ((cell[2] < 0 && step[2] <= 0) || (cell[2] >= NZ && step[2] >= 0)) return null;
      if (this.get(cell[0], cell[1], cell[2]) !== AIR) {
        /** @type {Vector3} */
        const normal = [0, 0, 0];
        normal[a] = -step[a];
        return { distance, cell: [...cell], normal };
      }
      next[a] += delta[a];
    }
  }
}

// The index of the cell containing a coordinate along one axis.
/** @param {number} value @param {import('./contracts.ts').Axis} axis */
export function cellOf(value, axis) {
  return Math.floor((value - GRID_MIN[axis]) / CELL);
}

/** @param {number} ix @param {number} iy @param {number} iz @returns {Vector3} */
export function cellCentre(ix, iy, iz) {
  return [GRID_MIN[0] + (ix + 0.5) * CELL, GRID_MIN[1] + (iy + 0.5) * CELL, GRID_MIN[2] + (iz + 0.5) * CELL];
}
