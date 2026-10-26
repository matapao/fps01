/** @typedef {import('../shared/contracts.ts').Vector3} Vector3 */
/** @typedef {import('../shared/runtime-types.ts').Player} Player */
// The powerups: one at a time on the pedestal in the middle of the map,
// announced ten seconds before it appears. Whoever takes it has it for 30 seconds, or until they
// die: then it drops where they fell, with the time it had left, for someone else. The powerups are
// in shared/loot.js.

import {
  DROPPED_POWERUP_MS,
  PEDESTAL,
  POWERUP_EVERY_MS,
  POWERUP_FIRST_MS,
  POWERUP_MS,
  POWERUP_ORDER,
  POWERUP_WARNING_MS,
  POWERUPS,
} from '../shared/loot.js';
import { VOID_Y } from '../shared/map.js';
import { round } from './util.js';
import { indexed, lookup } from '../shared/indexed.js';
import { mapVector } from '../shared/vector.js';

const REACH = 1.2;

export class Powerups {
  nextId = 1;
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.reset();
  }

  // A new round: the first powerup a while after it starts, and nobody holding one.
  reset() {
    /** @type {{kind:string|null,appearsAt:number,next:string,warned:boolean}} */
    this.pedestal = {
      kind: null,
      appearsAt: this.game.now() + POWERUP_FIRST_MS,
      next: pick(),
      warned: false,
    };
    /** @type {Map<number,{id:number,kind:string,at:Vector3,msLeft:number,until:number}>} */
    this.loose = new Map(); // id → a powerup dropped by its dead carrier: { id, kind, at, msLeft, until }
    this.nextId = 1;
    for (const player of this.game.players.values()) player.powerup = null;
  }

  // The powerup a player has right now, or null.
  /** @param {Player} player */
  of(player) {
    return player.powerup && this.game.now() < player.powerup.until ? player.powerup.kind : null;
  }

  /** @param {Player} player */
  rushOf(player) {
    return this.of(player) === 'rush' ? powerupNumber('rush', 'speed') : 1;
  }

  // Damage, as changed by the attacker's Triple Damage and the target's Blast Guard.
  /** @param {Player|null} attacker @param {Player} target @param {number} amount @param {{weapon?:string,splash?:boolean}} options */
  modify(attacker, target, amount, { weapon, splash }) {
    if (weapon === 'void') return amount;
    if (attacker && this.of(attacker) === 'triple') amount *= powerupNumber('triple', 'damage');
    if (this.of(target) === 'guard') amount = splash ? 0 : amount * powerupNumber('guard', 'share');
    return amount;
  }

  /** @param {number} _dt @param {number} now */
  tick(_dt, now) {
    const game = this.game;
    const pedestal = this.pedestal;
    if (!PEDESTAL) return;
    if (!pedestal.kind) {
      if (!pedestal.warned && now >= pedestal.appearsAt - POWERUP_WARNING_MS) {
        pedestal.warned = true;
        game.broadcast({ type: 'powerup', event: 'soon', kind: pedestal.next, ms: pedestal.appearsAt - now });
      }
      if (now >= pedestal.appearsAt) {
        pedestal.kind = pedestal.next;
        game.broadcast({ type: 'powerup', event: 'appeared', kind: pedestal.kind });
      }
    } else {
      const taker = this.toucher(PEDESTAL);
      if (taker) {
        this.give(taker, pedestal.kind, POWERUP_MS);
        Object.assign(pedestal, {
          kind: null,
          appearsAt: now + POWERUP_EVERY_MS,
          next: pick(pedestal.kind),
          warned: false,
        });
      }
    }
    for (const drop of [...this.loose.values()]) {
      if (now >= drop.until) {
        this.loose.delete(drop.id);
        continue;
      }
      const taker = this.toucher(drop.at);
      if (!taker) continue;
      this.loose.delete(drop.id);
      this.give(taker, drop.kind, drop.msLeft);
    }
    for (const player of game.players.values()) {
      if (!player.powerup) continue;
      if (now >= player.powerup.until) {
        game.broadcast({ type: 'powerup', event: 'ended', kind: player.powerup.kind, by: player.id });
        player.powerup = null;
        continue;
      }
      const perSecond = powerupNumber('mend', 'perSecond'),
        cap = powerupNumber('mend', 'cap');
      if (player.powerup.kind === 'mend' && player.alive && now >= (player.mendAt ?? 0)) {
        player.mendAt = now + 1000;
        if (player.hp < cap) player.hp = Math.min(cap, player.hp + perSecond);
      }
    }
  }

  // The first one alive (with no powerup already) close enough to take what lies at a point.
  /** @param {Vector3} at */
  toucher(at) {
    for (const player of this.game.players.values()) {
      if (!player.alive || this.of(player)) continue;
      if (
        Math.hypot(player.feet[0] - at[0], player.feet[2] - at[2]) <= REACH &&
        player.feet[1] - at[1] > -0.6 &&
        player.feet[1] - at[1] < 1.6
      )
        return player;
    }
    return null;
  }

  /** @param {Player} player @param {string} kind @param {number} ms */
  give(player, kind, ms) {
    player.powerup = { kind, until: this.game.now() + ms };
    this.game.broadcast({ type: 'powerup', event: 'taken', kind, by: player.id, ms });
  }

  // A carrier who dies (or leaves) drops what's left of their powerup on the floor where they fell.
  /** @param {Player} player */
  drop(player) {
    const kind = this.of(player);
    const now = this.game.now();
    const msLeft = kind && player.powerup ? player.powerup.until - now : 0;
    player.powerup = null;
    if (!kind || player.feet[1] < VOID_Y + 1) return;
    const [x, y, z] = player.feet;
    const ground = this.game.world.raycast([x, y + 0.5, z], [0, -1, 0], 40);
    if (!ground) return;
    const drop = {
      id: this.nextId++,
      kind,
      at: mapVector([x, round(y + 0.5 - ground.distance), z], round),
      msLeft,
      until: now + DROPPED_POWERUP_MS,
    };
    this.loose.set(drop.id, drop);
    this.game.broadcast({ type: 'powerup', event: 'dropped', kind, by: player.id });
  }

  // For the snapshot: what's on the pedestal (and when the next one comes), and what lies around.
  /** @returns {Pick<import('../shared/runtime-types.ts').Snapshot,'powerups'>} */
  snapshot() {
    const now = this.game.now();
    const { kind, appearsAt, next, warned } = this.pedestal;
    return {
      powerups: {
        pedestal: kind,
        soon: !kind && warned ? { kind: next, ms: Math.max(0, appearsAt - now) } : null,
        loose: [...this.loose.values()].map(({ id, kind: what, at }) => [id, what, ...at]),
      },
    };
  }
}

// A powerup at random, but not the same one twice in a row.
/** @param {string|null} last */
function pick(last = null) {
  const choices = POWERUP_ORDER.filter((kind) => kind !== last);
  return indexed(choices, Math.floor(Math.random() * choices.length));
}

/** Required tuning is validated at the data boundary; reject a broken configuration invariant.
 * @param {string} kind @param {'speed'|'damage'|'share'|'perSecond'|'cap'} field */
function powerupNumber(kind, field) {
  const value = lookup(POWERUPS, kind)[field];
  if (value === undefined) throw new Error(`Missing powerup ${kind}.${field}`);
  return value;
}
