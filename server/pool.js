/** @typedef {import('../shared/contracts.ts').Vector3} Vector3 */
/** @typedef {import('../shared/runtime-types.ts').Player} Player */
// The water, on a map with some (the Canal's canal): blow a hole in its basin and it runs out
// through it, down to the bottom of the hole. The level goes out with every snapshot. See
// shared/water.js.

import { drainRate, emptyLevel, leaks } from '../shared/water.js';

export class Pool {
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.reset();
  }

  // A new building: the pool full again.
  reset() {
    this.draining = false;
    this.check = true;
  }

  // The arena changed: the basin may have a hole in it now (or one may have been filled).
  changed() {
    this.check = true;
  }

  /** @param {number} dt */
  tick(dt) {
    if (!this.check && !this.draining) return;
    this.check = false;
    const world = this.game.world;
    const empty = emptyLevel();
    if (world.water < empty + 0.001) world.water = empty;
    const openings = leaks(world, world.water);
    if (!openings.length) {
      this.draining = false;
      return;
    }
    this.draining = true;
    world.water = world.water - drainRate(openings) * dt;
    if (world.water < empty + 0.001) world.water = empty;
  }
}
