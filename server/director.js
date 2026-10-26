/** @typedef {import('../shared/contracts.ts').Vector3} Vector3 */
/** @typedef {import('../shared/runtime-types.ts').Player} Player */
// The round's clock: its time limit, and sudden death after a tie, when the floor crumbles away.
// See shared/rounds.js.

import { SUDDEN_DEATH } from '../shared/constants.js';
import { ARENA_HALF, CELL, MATERIALS } from '../shared/map.js';
import { CRUMBLE_PER_SECOND, TIME_LIMIT_MS } from '../shared/rounds.js';
import { cellOf } from '../shared/voxels.js';
import { round } from './util.js';
import { mapVector } from '../shared/vector.js';

const CRUMBLE_RADIUS = 1.5; // sudden death takes the floor away in holes this size…
const CRUMBLE_CELLS = 28; // …each about this many cells of floor

export class Director {
  endsAt = 0;
  sudden = false;
  crumbled = false;
  crumbleDebt = 0;
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.reset();
  }

  // A new round: the clock starts.
  reset() {
    const now = this.game.now();
    this.endsAt = now + TIME_LIMIT_MS[this.game.mode];
    this.sudden = false;
    this.crumbled = false; // no floor left to crumble
    this.crumbleDebt = 0;
  }

  /** @param {number} dt @param {number} now */
  tick(dt, now) {
    if (this.game.round.over) return;
    this.updateClock(now);
    if (this.sudden) this.crumble(dt);
  }

  // Someone was killed: in sudden death, that wins.
  /** @param {Parameters<import('./game.js').Game['endRound']>[0]} winner */
  killed(winner) {
    if (this.sudden && winner) this.game.endRound(winner);
  }

  // A capture, in capture the flag: in sudden death, it wins.
  /** @param {import('../shared/runtime-types.ts').Team} team */
  captured(team) {
    if (this.sudden) this.game.endRound({ team });
  }

  // A bit of floor gives way.
  /** @param {Vector3} at @param {number} radius */
  crack(at, radius) {
    const game = this.game;
    game.broadcast({ type: 'boom', kind: 'chew', at, hole: radius });
    game.carve(at, radius);
  }

  // ---- The clock, and sudden death ----

  /** @param {number} now */
  updateClock(now) {
    if (this.sudden || now < this.endsAt) return;
    const leader = this.leader();
    if (leader || !SUDDEN_DEATH) {
      this.game.endRound(leader); // without sudden death, a tie is a draw: nobody wins
      return;
    }
    this.sudden = true;
    this.game.broadcast({ type: 'round', state: 'sudden', mode: this.game.mode });
  }

  // Who wins when time runs out: the player (or team) ahead, if anyone is.
  /** @returns {{team:import('../shared/runtime-types.ts').Team}|{id:number,name:string}|null} */
  leader() {
    const game = this.game;
    if (game.mode === 'ctf') {
      const { red, blue } = game.captures;
      return red === blue ? null : { team: red > blue ? 'red' : 'blue' };
    }
    const [first, second] = [...game.players.values()].sort((a, b) => b.kills - a.kills);
    if (!first || (second && second.kills === first.kills)) return null;
    return { id: first.id, name: first.name };
  }

  // Sudden death: the floor loses holes, many a second, until it's gone.
  /** @param {number} dt */
  crumble(dt) {
    this.crumbleDebt += (CRUMBLE_PER_SECOND / CRUMBLE_CELLS) * dt;
    while (this.crumbleDebt >= 1 && !this.crumbled) {
      const at = this.floorSpot();
      if (!at) {
        this.crumbled = true;
        continue;
      }
      this.crumbleDebt -= 1;
      this.crack(at, CRUMBLE_RADIUS);
    }
  }

  // A random spot in the floor that's still there, or null if hardly any is left.
  floorSpot() {
    const world = this.game.world;
    const y = -CELL / 2;
    const reach = ARENA_HALF - CELL;
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = (Math.random() * 2 - 1) * reach;
      const z = (Math.random() * 2 - 1) * reach;
      if (MATERIALS[world.get(cellOf(x, 0), cellOf(y, 1), cellOf(z, 2))]?.floor)
        return mapVector([x, y, z], round);
    }
    return null;
  }

  // For the snapshot: the round's clock, and what's going on.
  snapshot() {
    return {
      ms: Math.max(0, this.endsAt - this.game.now()),
      sudden: this.sudden,
    };
  }
}
