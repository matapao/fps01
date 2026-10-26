// The roof, and what holds it up: the pillars round the edge (PILLARS in shared/map.js) and the beam
// along their tops. A pillar blown right through, every bit of it gone at some height, holds nothing
// up any more: the roof cracks round its top, and bits of it come away. The beam reaches only so far
// from one standing pillar to the next: where they're too far apart, it comes down between them,
// with the roof over the rim there and what's left of the pillars it was holding up. Across the
// middle, the roof reaches from side to side, but whatever is too far from every pillar that holds
// comes down too, in slabs, crushing whoever it lands on; with no pillar left standing, all of it
// does. Blasts tear bigger holes in the roof, the beam and the pillars than in anything else, and
// bigger again in a corner of them.

import { ARENA_HALF, BEAM, CELL, GRID_SIZE, MAP, MATERIALS, PILLAR, PILLARS, RIM } from '../shared/map.js';
import { cellOf } from '../shared/voxels.js';
import { round } from './util.js';
import { indexed } from '../shared/indexed.js';
/** @typedef {import('../shared/contracts.ts').Vector3} Vector3 */
/** @typedef {import('./subsystem-types.ts').BreakCause} BreakCause */

const [NX, , NZ] = GRID_SIZE;
const LAYER = NX * NZ;
const RIM_CELLS = RIM / CELL;
const SPAN = 80; // cells (40 m): how far across the roof it reaches from the nearest pillar that holds it
const GAP = 14; // metres: the longest stretch of beam that holds between two standing pillars
const CRACKS = 5; // bits of the roof that come away near the top of a pillar when it goes…
const CRACK_REACH = /** @type {const} */ ([1, 4]); // …from this far in from the edge
const HARDER = 1.3; // how much bigger a hole a blast tears in the roof, the beam or a pillar…
const CORNER = 1.7; // …and in a corner, against two of them at once (or one and the floor)
/** @type {Vector3[]} */
const SIX = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// Whether a column of cells is on the rim, outside the floor.
/** @param {number} ix @param {number} iz */
const onRim = (ix, iz) => ix < RIM_CELLS || iz < RIM_CELLS || ix >= NX - RIM_CELLS || iz >= NZ - RIM_CELLS;

// How far round the rim a point on it is, in metres: clockwise from the north-west corner.
const EDGE = ARENA_HALF + RIM / 2;
const AROUND = 8 * EDGE;
/** @param {number} x @param {number} z */
function around(x, z) {
  const [cx, cz] = [Math.max(-EDGE, Math.min(EDGE, x)), Math.max(-EDGE, Math.min(EDGE, z))];
  if (z <= -ARENA_HALF) return cx + EDGE; // the north side, going east
  if (x >= ARENA_HALF) return 2 * EDGE + cz + EDGE; // the east side, going south
  if (z >= ARENA_HALF) return 4 * EDGE + EDGE - cx; // the south side, going west
  return 6 * EDGE + EDGE - cz; // the west side, going north
}
const PLACES = PILLARS.map(([x, z]) => around(x, z));

// The cells of a pillar's footprint, as [ix, iz].
/** @param {[number,number]} at @returns {[number,number][]} */
function footprint([x, z]) {
  /** @type {[number,number][]} */
  const cells = [];
  for (let ix = cellOf(x - RIM / 2 + 0.01, 0); ix <= cellOf(x + RIM / 2 - 0.01, 0); ix++) {
    for (let iz = cellOf(z - RIM / 2 + 0.01, 2); iz <= cellOf(z + RIM / 2 - 0.01, 2); iz++)
      cells.push([ix, iz]);
  }
  return cells;
}
const FOOTPRINTS = PILLARS.map(footprint);

export class Roof {
  /** @type {boolean[]} */
  standing = [];
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.reset();
  }

  // A new arena: every pillar standing.
  reset() {
    this.standing = PILLARS.map(() => true);
  }

  // The pillars as the arena stands now (a game going on from another's): those blown through hold
  // nothing up already, and don't crack the roof again.
  survey() {
    const [low] = this.layers();
    this.standing = PILLARS.map((_, n) => this.stands(this.game.world, n, low));
  }

  // The layer the beam starts at, and the roof's own.
  /** @returns {[number,number]} */
  layers() {
    return [cellOf(MAP.roof.at - BEAM + 0.01, 1), cellOf(MAP.roof.at + 0.01, 1)];
  }

  // Cells have broken (a flat [ix, iy, iz, …] list): if any were the roof's, the beam's or a
  // pillar's, the pillars that have gone crack the roof round their tops, and whatever is left too
  // far from the ones still standing comes down. cause: what broke them (see physics.js's broke).
  /** @param {number[]} removed @param {BreakCause} cause */
  broke(removed, cause = {}) {
    const [low] = this.layers();
    let touched = false;
    for (let k = 0; k < removed.length && !touched; k += 3)
      touched = indexed(removed, k + 1) >= low || onRim(indexed(removed, k), indexed(removed, k + 2));
    if (!touched) return;
    const world = this.game.world;
    PILLARS.forEach((pillar, n) => {
      if (!this.standing[n] || this.stands(world, n, low)) return;
      this.standing[n] = false;
      this.crack(pillar, cause);
    });
    this.settle(cause);
  }

  // Whether a pillar still reaches from the floor to the beam: some of it left in every layer.
  /** @param {import('../shared/voxels.js').Voxels} world @param {number} n @param {number} low */
  stands(world, n, low) {
    for (let iy = 0; iy < low; iy++) {
      if (!indexed(FOOTPRINTS, n).some(([ix, iz]) => world.get(ix, iy, iz) !== 0)) return false;
    }
    return true;
  }

  // A pillar has gone: the roof near its top cracks, and a few bits of it come away and fall.
  /** @param {[number,number]} at @param {BreakCause} cause */
  crack([x, z], cause) {
    const game = this.game;
    const world = game.world;
    const [, top] = this.layers();
    const roof = MAP.roof.at;
    game.broadcast({ type: 'crack', at: [x, round(roof - BEAM), z] });
    const inward = /** @type {[number,number]} */ ([
      -Math.sign(Math.abs(x) >= EDGE ? x : 0),
      -Math.sign(Math.abs(z) >= EDGE ? z : 0),
    ]);
    /** @type {Set<number>} */
    const bits = new Set();
    for (let tries = 0; tries < CRACKS * 8 && bits.size < CRACKS * 2; tries++) {
      const reach = RIM / 2 + CRACK_REACH[0] + Math.random() * (CRACK_REACH[1] - CRACK_REACH[0]);
      const along = (Math.random() - 0.5) * 6;
      const [px, pz] = [
        x + inward[0] * reach + (inward[0] ? 0 : along),
        z + inward[1] * reach + (inward[1] ? 0 : along),
      ];
      const [ix, iz] = [cellOf(px, 0), cellOf(pz, 2)];
      if (onRim(ix, iz) || world.get(ix, top, iz) === 0) continue;
      bits.add(ix + NX * (iz + NZ * top));
      if (Math.random() < 0.5 && world.get(ix + 1, top, iz) !== 0) bits.add(ix + 1 + NX * (iz + NZ * top)); // some bigger than others
    }
    if (bits.size) game.physics.bringDown([...bits], { ...cause, at: [x, roof, z] });
  }

  // The rim where the beam has too far to reach between two standing pillars: its cells in the
  // roof's layers, and what's left of the pillars between them up there (indices).
  /** @param {number} low @param {number} top */
  overreached(low, top) {
    const world = this.game.world;
    const standing = PILLARS.map((_, n) => n).filter((n) => this.standing[n]);
    /** @type {[number,number][]} */
    const gaps = []; // [from, to] round the rim, in metres, from one pillar's side to the next one's
    if (!standing.length) gaps.push([-Infinity, Infinity]);
    const places = standing.map((n) => indexed(PLACES, n)).sort((a, b) => a - b);
    places.forEach((place, k) => {
      const next = k + 1 < places.length ? indexed(places, k + 1) : indexed(places, 0) + AROUND;
      if (next - place - RIM > GAP) gaps.push([place + RIM / 2, next - RIM / 2]);
    });
    if (!gaps.length) return [];
    /** @param {number} place */
    const inGap = (place) =>
      gaps.some(
        ([from, to]) => (place > from && place < to) || (place + AROUND > from && place + AROUND < to),
      );
    const cells = [];
    for (let iz = 0; iz < NZ; iz++) {
      for (let ix = 0; ix < NX; ix++) {
        if (!onRim(ix, iz)) continue;
        const x = -EDGE - RIM / 2 + (ix + 0.5) * CELL;
        const z = -EDGE - RIM / 2 + (iz + 0.5) * CELL;
        if (!inGap(around(x, z))) continue;
        for (let iy = low; iy <= top; iy++)
          if (world.get(ix, iy, iz) !== 0) cells.push(ix + NX * (iz + NZ * iy));
      }
    }
    // The pillars that held it up there: from where each was blown through, up.
    PILLARS.forEach((_, n) => {
      if (this.standing[n] || !inGap(indexed(PLACES, n))) return;
      let gone = low - 1;
      while (gone >= 0 && indexed(FOOTPRINTS, n).some(([ix, iz]) => world.get(ix, gone, iz) !== 0)) gone--;
      for (let iy = gone + 1; iy < low; iy++)
        for (const [ix, iz] of indexed(FOOTPRINTS, n))
          if (world.get(ix, iy, iz) !== 0) cells.push(ix + NX * (iz + NZ * iy));
    });
    return cells;
  }

  // Whatever of the roof and the beam nothing holds up any more comes down: the rim between pillars
  // too far apart, and then whatever of the rest is too far from every pillar still holding it, by
  // a search across it from the tops of the pillars that stand.
  /** @param {BreakCause} cause */
  settle(cause) {
    const world = this.game.world;
    const cells = world.cells;
    const [low, top] = this.layers();
    const depth = top - low + 1;
    const rim = this.overreached(low, top);
    const gone = new Set(rim);
    const distance = new Int32Array(LAYER * depth).fill(-1);
    const queue = new Int32Array(LAYER * depth);
    let [head, tail] = [0, 0];
    PILLARS.forEach((_, n) => {
      if (!this.standing[n]) return;
      for (const [ix, iz] of indexed(FOOTPRINTS, n)) {
        const c = ix + NX * iz;
        if (
          indexed(cells, c + LAYER * (low - 1)) === 0 ||
          indexed(cells, c + LAYER * low) === 0 ||
          indexed(distance, c) >= 0
        )
          continue;
        distance[c] = 0;
        queue[tail++] = c;
      }
    });
    while (head < tail) {
      const k = indexed(queue, head++);
      const layer = Math.floor(k / LAYER);
      const c = k - layer * LAYER;
      const ix = c % NX;
      const iz = (c - ix) / NX;
      for (const [dx, dl, dz] of SIX) {
        const [nx, nl, nz] = [ix + dx, layer + dl, iz + dz];
        if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ || nl < 0 || nl >= depth) continue;
        const m = nx + NX * nz + LAYER * nl;
        const i = nx + NX * nz + LAYER * (low + nl);
        if (indexed(distance, m) >= 0 || indexed(cells, i) === 0 || gone.has(i)) continue;
        distance[m] = indexed(distance, k) + 1;
        queue[tail++] = m;
      }
    }
    const falling = rim;
    for (let layer = 0; layer < depth; layer++) {
      for (let c = 0; c < LAYER; c++) {
        const i = c + LAYER * (low + layer);
        if (indexed(cells, i) === 0 || gone.has(i)) continue;
        const d = indexed(distance, c + LAYER * layer);
        if (d < 0 || d > SPAN) falling.push(i);
      }
    }
    if (falling.length) this.game.physics.bringDown(falling, cause);
  }
}

// How big a hole a blast at a point tears: bigger against the roof, the beam or a pillar, and
// bigger again in a corner, against two of them (or one of them and the floor).
/** @param {import('../shared/voxels.js').Voxels} world @param {Vector3} at @param {number} hole */
export function roofHole(world, at, hole) {
  if (!hole) return hole;
  const low = MAP.roof.at - BEAM;
  const edge = ARENA_HALF - 1;
  if (at[1] < low - 1 && Math.abs(at[0]) < edge && Math.abs(at[2]) < edge) return hole;
  let sides = 0;
  let roofy = false;
  for (const [dx, dy, dz] of SIX) {
    for (const reach of [0.3, 0.6]) {
      const point = /** @type {Vector3} */ ([at[0] + dx * reach, at[1] + dy * reach, at[2] + dz * reach]);
      const material = world.get(cellOf(point[0], 0), cellOf(point[1], 1), cellOf(point[2], 2));
      if (!MATERIALS[material]) continue;
      sides++;
      if (material === PILLAR || point[1] >= MAP.roof.at) roofy = true;
      break;
    }
  }
  if (!roofy) return hole;
  return round(hole * (sides >= 2 ? CORNER : HARDER));
}
