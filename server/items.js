/** @typedef {import('../shared/contracts.ts').Vector3} Vector3 */
/** @typedef {import('../shared/runtime-types.ts').Player} Player */
// Pickups lying around the arena: weapons on pads, health, armor and Health Orbs,
// each back a while after someone takes it. In capture the flag, weapons can stay on their pads. The
// spots are the layout's pickups (shared/map.js: ITEMS), each a piece with a pickup component
// (data/pieces.json): what it gives, how much, up to what, and when it's back.

import { WEAPONS_STAY } from '../shared/constants.js';
import { ITEMS } from '../shared/map.js';
import { weaponSpec } from '../shared/weapons.js';
import { indexed } from '../shared/indexed.js';

const REACH = 1.1; // how close you have to walk to something to pick it up

export class Items {
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.spots = ITEMS.map(() => ({ readyAt: 0, warned: true }));
  }

  // A new round, maybe on another map: everything on its spot.
  reset() {
    this.spots = ITEMS.map(() => ({ readyAt: 0, warned: true }));
  }

  /** @param {number} now */
  tick(now) {
    const game = this.game;
    ITEMS.forEach((item, i) => {
      const spot = indexed(this.spots, i);
      if (now < spot.readyAt) {
        if (item.warnMs && !spot.warned && spot.readyAt - now <= item.warnMs) {
          spot.warned = true;
          game.broadcast({ type: 'item', spot: i, event: 'soon' });
        }
        return;
      }
      for (const player of game.players.values()) {
        if (!player.alive || !touches(player.feet, item.at) || !this.give(player, item)) continue;
        const stays = item.kind === 'weapon' && game.mode === 'ctf' && WEAPONS_STAY;
        if (!stays) Object.assign(spot, { readyAt: now + item.respawnMs, warned: false });
        game.broadcast({ type: 'item', spot: i, event: 'taken', by: player.id });
        break;
      }
    });
  }

  // Gives a player what's lying there, if it's any use to them. Returns whether they took it.
  /** @param {Player} player @param {import('../shared/layout-types.ts').Pickup} item */
  give(player, item) {
    if (item.kind === 'weapon' && item.weapon) {
      const full = weaponSpec(item.weapon).ammo;
      if (player.weapons.has(item.weapon) && (player.ammo[item.weapon] ?? 0) >= full) return false;
      player.weapons.add(item.weapon);
      player.ammo[item.weapon] = full;
      return true;
    }
    const stat = item.kind === 'health' ? 'hp' : item.kind === 'armor' ? 'armor' : null;
    if (!stat || item.cap === undefined || item.amount === undefined || player[stat] >= item.cap)
      return false;
    player[stat] = Math.min(item.cap, player[stat] + item.amount);
    return true;
  }

  // What's on each spot, in the order of ITEMS: 0 when it's there, or the seconds until it's back.
  snapshot() {
    const now = this.game.now();
    return this.spots.map((spot) => (now >= spot.readyAt ? 0 : Math.ceil((spot.readyAt - now) / 1000)));
  }
}

/** @param {Vector3} feet @param {Vector3} at */
function touches(feet, at) {
  return (
    Math.hypot(feet[0] - at[0], feet[2] - at[2]) <= REACH && feet[1] - at[1] > -0.6 && feet[1] - at[1] < 1.4
  );
}
