// The planets (shared/planets.js): which are still there, and blowing one up. A shot that gets out
// of the arena straight at a planet blows it up: everyone sees it burst, and its pieces streak in at
// the side of the arena facing it (the overhead one's at the roof), each chipping a bit off whatever
// it strikes. It's a show, not a weapon: the pieces hurt nobody, nothing they knock loose lands on
// anyone, and they leave the floor and the canal alone, so nobody falls through and the water stays.

import { BREAKABLE, CELL, GRID_MIN, GRID_SIZE, MAP, POOL } from '../shared/map.js';
import { DEBRIS, PLANETS, planetAt } from '../shared/planets.js';
import { cellOf } from '../shared/voxels.js';
import { round } from './util.js';
import { mapVector, AXES } from '../shared/vector.js';
import { indexed } from '../shared/indexed.js';
/** @typedef {import('../shared/contracts.ts').Vector3} Vector3 */

const [NX, , NZ] = GRID_SIZE;
const REACH = 160; // how far out the pieces come in from
const SPARE = 0.05; // metres: how far above the floor a chip has to stay

export class Planets {
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.reset();
  }

  // A new arena: every planet back, and nothing on its way down.
  reset() {
    /** @type {Set<number>} */
    this.gone = new Set();
    /** @type {{at:Vector3,dueAt:number,hole:number}[]} */
    this.strikes = []; // { at, dueAt, hole }
  }

  // A shot heading along dir has got out of the arena: if it goes straight at a planet, the planet
  // blows up.
  /** @param {import('../shared/runtime-types.ts').Player} player @param {Vector3} dir */
  shoot(player, dir) {
    const n = planetAt(dir, this.gone);
    if (n >= 0) this.explode(n, player);
  }

  /** @param {number} n @param {import('../shared/runtime-types.ts').Player} by */
  explode(n, by) {
    const game = this.game;
    this.gone.add(n);
    const now = game.now();
    const strikes = this.aim(indexed(PLANETS, n).dir).map(({ at, hole }) => ({
      at,
      hole,
      dueAt: now + DEBRIS.arrive[0] + Math.random() * (DEBRIS.arrive[1] - DEBRIS.arrive[0]),
    }));
    strikes.sort((a, b) => a.dueAt - b.dueAt);
    this.strikes.push(...strikes);
    game.broadcast({
      type: 'planet',
      event: 'exploded',
      planet: n,
      by: by.id,
      strikes: strikes.map(({ at, dueAt }) => [...at, Math.round(dueAt - now)]),
    });
  }

  // Where the pieces strike: each along a line in from the planet's way, through a point anywhere
  // in the arena, at the first thing it meets there, if that's something a chip would come off
  // without reaching the floor or the canal's basin.
  /** @param {Vector3} dir */
  aim(dir) {
    const world = this.game.world;
    const top = MAP.roof.at + CELL;
    /** @type {{at:Vector3,hole:number}[]} */
    const out = [];
    const back = mapVector(dir, (v) => -v);
    for (let tries = 0; tries < DEBRIS.strikes * 8 && out.length < DEBRIS.strikes; tries++) {
      const through = /** @type {Vector3} */ ([
        GRID_MIN[0] + Math.random() * NX * CELL,
        Math.random() * top,
        GRID_MIN[2] + Math.random() * NZ * CELL,
      ]);
      const from = mapVector(through, (v, i) => v + dir[i] * REACH);
      const hit = world.raycast(from, back, REACH * 2);
      if (!hit) continue;
      const at = mapVector(from, (v, i) => round(v + back[i] * (hit.distance - 0.2)));
      const hole = round(DEBRIS.radius[0] + Math.random() * (DEBRIS.radius[1] - DEBRIS.radius[0]));
      if (at[1] - hole < SPARE || inBasin(at, hole) || !chipsAny(world, at, hole)) continue;
      out.push({ at, hole });
    }
    return out;
  }

  // Pieces striking: each chips a bit off, harmlessly.
  /** @param {number} now */
  tick(now) {
    const game = this.game;
    while (this.strikes.length && indexed(this.strikes, 0).dueAt <= now) {
      const strike = this.strikes.shift();
      if (!strike) break;
      const { at, hole } = strike;
      game.broadcast({ type: 'boom', kind: 'meteor', at, hole });
      game.carve(at, hole, null, { harmless: true });
    }
  }
}

// Whether a hole at a point would reach into the canal's basin (its bottom, its quays, its gates).
/** @param {Vector3} at @param {number} radius */
function inBasin(at, radius) {
  if (!POOL) return false;
  const { min, max } = POOL.basin;
  return AXES.every((a) => at[a] + radius > min[a] && at[a] - radius < max[a]);
}

// Whether a hole at a point would chip anything off: anything breakable within it.
/** @param {import('../shared/voxels.js').Voxels} world @param {Vector3} at @param {number} radius */
function chipsAny(world, at, radius) {
  const lo = mapVector(at, (v, a) => Math.max(0, cellOf(v - radius, a)));
  const hi = mapVector(at, (v, a) => Math.min(GRID_SIZE[a] - 1, cellOf(v + radius, a)));
  for (let iy = lo[1]; iy <= hi[1]; iy++) {
    for (let iz = lo[2]; iz <= hi[2]; iz++) {
      for (let ix = lo[0]; ix <= hi[0]; ix++) {
        const centre = /** @type {Vector3} */ ([
          GRID_MIN[0] + (ix + 0.5) * CELL,
          GRID_MIN[1] + (iy + 0.5) * CELL,
          GRID_MIN[2] + (iz + 0.5) * CELL,
        ]);
        if (
          BREAKABLE[world.get(ix, iy, iz)] &&
          Math.hypot(...mapVector(centre, (v, a) => v - at[a])) <= radius
        )
          return true;
      }
    }
  }
  return false;
}
