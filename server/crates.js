// Crates: every 40 to 70 seconds one drifts down from just under the roof on a parachute,
// somewhere open. Walk into it for what's inside: a health crate, or a special for one use (key 7):
// a woolly, a splitter bomb, a choir grenade, an air strike, a pilot missile or a teleport. A
// woolly and a pilot missile are steered (or set off) by their owner, who is told about them with
// 'guiding' messages. Everything is described in shared/loot.js.

import {
  AIRSTRIKE,
  CRATE_DROP_HEIGHT,
  CRATE_EVERY_MS,
  CRATE_FALL_SPEED,
  CRATE_FIRST_MS,
  CRATE_ITEMS,
  CRATE_MS,
  CRATE_REACH,
  WOOLLY,
  TELEPORT_RANGE,
} from '../shared/loot.js';
import { ARENA_HALF, CELL, GRID_MIN, TOP, VOID_Y, roofOf } from '../shared/map.js';
import { boxHitsWorld, eyePosition, playerBox } from '../shared/physics.js';
import { cellOf } from '../shared/voxels.js';
import { weaponSpec } from '../shared/weapons.js';
import { lookup } from '../shared/indexed.js';
import { mapVector } from '../shared/vector.js';
/** @typedef {import('../shared/contracts.ts').Vector3} Vector3 */
/** @typedef {import('../shared/runtime-types.ts').Player} Player */
/** @typedef {import('../shared/runtime-types.ts').IncomingMessage & {detonate?:unknown}} SpecialMessage */
import { clampToArena, duration, round, send, toDirection, toVector } from './util.js';

const WOOLLY_HALF = 0.25; // a woolly is 0.5 m wide…
const WOOLLY_HEIGHT = 0.55; // …and this tall

export class Crates {
  nextId = 1;
  nextAt = 0;
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    /** @type {Map<number,import('./subsystem-types.ts').Crate>} */
    this.crates = new Map(); // id → { id, item, at, landed, until }
    /** @type {Map<number,import('./subsystem-types.ts').Woolly>} */
    this.woollies = new Map(); // id → { id, owner, pos, dir, vy, onGround, bumps, until }
    /** @type {import('./subsystem-types.ts').Missile[]} */
    this.missiles = []; // an air strike's missiles waiting to fall: { at, dueAt, owner }
    this.nextAt = this.game.now() + CRATE_FIRST_MS;
    this.nextId = 1;
    for (const player of this.game.players.values()) Object.assign(player, { special: null, guiding: null });
  }

  /** @param {number} dt @param {number} now */
  tick(dt, now) {
    if (now >= this.nextAt) {
      this.drop(now);
      this.nextAt = now + duration(CRATE_EVERY_MS);
    }
    for (const crate of [...this.crates.values()]) this.fall(crate, dt, now);
    for (const woolly of [...this.woollies.values()]) this.walk(woolly, dt, now);
    for (const missile of this.missiles.filter((m) => now >= m.dueAt)) this.fire(missile);
    this.missiles = this.missiles.filter((m) => now < m.dueAt);
  }

  // A crate appears high over an open spot that nobody is standing near (the top of whatever is
  // there, under the roof if there is one), and drifts down onto it.
  /** @param {number} now @param {string} item */
  drop(now, item = pickItem()) {
    const game = this.game;
    const spread = ARENA_HALF - 2;
    const top = Math.min(TOP, roofOf() - 0.6); // where it starts, at the highest
    for (let attempt = 0; attempt < 40; attempt++) {
      const [x, z] = [round((Math.random() * 2 - 1) * spread), round((Math.random() * 2 - 1) * spread)];
      const ground = game.world.raycast([x, top, z], [0, -1, 0], top + 1);
      if (!ground) continue; // a hole down into the void
      const feet = /** @type {Vector3} */ ([x, round(top - ground.distance), z]);
      if (!game.usable(feet)) continue;
      const near = [...game.players.values()].some(
        (p) =>
          p.alive &&
          Math.hypot(p.feet[0] - feet[0], p.feet[2] - feet[2]) < 4 &&
          Math.abs(p.feet[1] - feet[1]) < 2,
      );
      if (near) continue;
      /** @type {import('./subsystem-types.ts').Crate} */
      const crate = {
        id: this.nextId++,
        item,
        at: [x, round(Math.min(top, feet[1] + CRATE_DROP_HEIGHT)), z],
        landed: false,
        until: now + CRATE_MS,
      };
      this.crates.set(crate.id, crate);
      game.broadcast({ type: 'crate', event: 'dropping', id: crate.id, at: feet });
      return crate;
    }
    return null;
  }

  // Down to the floor under it, wherever that is now; into the void, if there's none. Whoever
  // touches it gets what's inside.
  /** @param {import('./subsystem-types.ts').Crate} crate @param {number} dt @param {number} now */
  fall(crate, dt, now) {
    const game = this.game;
    if (now >= crate.until) {
      this.crates.delete(crate.id);
      return;
    }
    if (!crate.landed || !game.world.solidAt(crate.at[0], crate.at[1] - 0.1, crate.at[2])) {
      const ground = game.world.raycast([crate.at[0], crate.at[1] + 0.01, crate.at[2]], [0, -1, 0], 40);
      const step = CRATE_FALL_SPEED * dt * (crate.landed ? 6 : 1); // a crate knocked off its floor falls fast
      const drop = ground ? Math.min(step, ground.distance - 0.01) : step;
      crate.at[1] = round(crate.at[1] - Math.max(0, drop));
      crate.landed = Boolean(ground && ground.distance - 0.01 <= step);
      if (crate.at[1] < VOID_Y) {
        this.crates.delete(crate.id);
        return;
      }
    }
    for (const player of game.players.values()) {
      if (
        !player.alive ||
        Math.hypot(player.feet[0] - crate.at[0], player.feet[2] - crate.at[2]) > CRATE_REACH
      )
        continue;
      if (player.feet[1] - crate.at[1] < -1.8 || player.feet[1] - crate.at[1] > 1.2) continue;
      if (crate.item !== 'health' && player.special) continue; // one special at a time
      this.crates.delete(crate.id);
      this.open(player, crate.item);
      game.broadcast({ type: 'crate', event: 'taken', id: crate.id, item: crate.item, by: player.id });
      return;
    }
  }

  // A health crate heals and reloads; anything else is a special, for one use.
  /** @param {Player} player @param {string} item */
  open(player, item) {
    if (item !== 'health') {
      player.special = item;
      return;
    }
    const { health = 50, cap = 200 } = CRATE_ITEMS['health'] ?? {};
    player.hp = Math.max(player.hp, Math.min(cap, player.hp + health));
    for (const weapon of player.weapons)
      if (Number.isFinite(weaponSpec(weapon).ammo)) player.ammo[weapon] = weaponSpec(weapon).ammo;
  }

  // Using your special: { feet, dir, velocity } to throw or fire it, { at } for where a teleport
  // or an air strike goes, or { detonate: true } to set off your woolly or your pilot missile.
  /** @param {Player} player @param {SpecialMessage} message */
  use(player, message) {
    const game = this.game;
    if (message.detonate === true) {
      this.detonate(player);
      return;
    }
    const kind = player.special;
    if (!kind || !player.alive || game.round.over) return;
    if (kind === 'teleport') {
      if (!this.teleport(player, toVector(message.at))) return;
    } else if (kind === 'airstrike') {
      if (!this.airstrike(player, toVector(message.at), message.dir)) return;
    } else {
      const dir = toDirection(message.dir);
      if (!dir) return;
      game.relocate(player, message.feet);
      if (kind === 'woolly') this.release(player, dir);
      else {
        const shot = game.arsenal.launch(player, kind, dir, message.velocity);
        if (kind === 'pilot') {
          shot.aim = dir;
          player.guiding = shot.id;
          send(player.socket, { type: 'guiding', kind, id: shot.id });
        }
      }
    }
    player.special = null;
    player.protectedUntil = 0;
    game.broadcast({ type: 'special', kind, id: player.id });
  }

  // The owner turns their pilot missile towards where they look.
  /** @param {Player} player @param {SpecialMessage} message */
  steer(player, message) {
    const shot = player.guiding === null ? undefined : this.game.arsenal.flying.get(player.guiding);
    const dir = toDirection(message.dir);
    if (shot && dir) shot.aim = dir;
  }

  /** @param {Player} player */
  detonate(player) {
    for (const woolly of [...this.woollies.values()]) if (woolly.owner === player.id) this.blow(woolly);
    const shot = player.guiding === null ? undefined : this.game.arsenal.flying.get(player.guiding);
    if (shot) this.game.arsenal.explode(shot);
  }

  // A pilot missile went off (or another projectile someone was guiding): their view comes home.
  /** @param {import('./subsystem-types.ts').FlyingProjectile} shot */
  guided(shot) {
    const owner = this.game.players.get(shot.owner);
    if (!owner || owner.guiding !== shot.id) return;
    owner.guiding = null;
    send(owner.socket, { type: 'guiding', kind: null });
  }

  // The teleport: to any spot in the arena where you fit (not the void below it, nor high in the sky).
  /** @param {Player} player @param {Vector3|null} at */
  teleport(player, at) {
    const game = this.game;
    if (!at) return false;
    const to = clampToArena(at);
    if (to[1] < 0 || to[1] > TOP) return false;
    if (Math.hypot(...mapVector(to, (v, i) => v - eyePosition(player.feet)[i])) > TELEPORT_RANGE + 2)
      return false;
    const { min, max } = playerBox(to);
    if (boxHitsWorld(game.world, min, max)) return false;
    const from = mapVector(player.feet, round);
    player.feet = mapVector(to, round);
    send(player.socket, { type: 'moved', feet: player.feet });
    game.broadcast({ type: 'teleport', id: player.id, from, to: player.feet });
    return true;
  }

  // Missiles come down out of the sky in a line through a point, one after another.
  /** @param {Player} player @param {Vector3|null} at @param {unknown} dir */
  airstrike(player, at, dir) {
    const game = this.game;
    if (!at) return false;
    const target = clampToArena(at);
    const across = toDirection(Array.isArray(dir) && dir.length === 3 ? [dir[0], 0, dir[2]] : null) ?? [
      1, 0, 0,
    ];
    const now = game.now();
    if (!AIRSTRIKE) return false;
    const { missiles, spacing } = AIRSTRIKE;
    for (let i = 0; i < missiles; i++) {
      const offset = (i - (missiles - 1) / 2) * spacing;
      this.missiles.push({
        at: [target[0] + across[0] * offset, target[1] + 0.3, target[2] + across[2] * offset],
        dueAt: now + 700 + i * 120,
        owner: player.id,
      });
    }
    return true;
  }

  // An air strike's missile, falling from just under the roof over its spot onto whatever is there.
  /** @param {import('./subsystem-types.ts').Missile} missile */
  fire({ at, owner }) {
    const player = this.game.players.get(owner);
    if (player)
      this.game.arsenal.launch(player, 'missile', [0, -1, 0], null, {
        from: [at[0], Math.min(TOP + 4, roofOf() - 0.5), at[2]],
      });
  }

  // A woolly: it runs off the way you threw it, hopping over anything low and turning back from walls.
  /** @param {Player} player @param {Vector3} dir */
  release(player, dir) {
    const game = this.game;
    const flat = Math.hypot(dir[0], dir[2]) || 1;
    const heading = /** @type {Vector3} */ ([dir[0] / flat, 0, dir[2] / flat]);
    let pos = /** @type {Vector3} */ ([
      player.feet[0] + heading[0] * 0.8,
      player.feet[1] + 0.05,
      player.feet[2] + heading[2] * 0.8,
    ]);
    if (this.blocked(pos)) pos = [player.feet[0], player.feet[1] + 0.05, player.feet[2]];
    const woolly = {
      id: this.nextId++,
      owner: player.id,
      pos,
      dir: heading,
      vy: 0,
      onGround: false,
      bumps: 0,
      until: game.now() + woollySpec().ms,
    };
    this.woollies.set(woolly.id, woolly);
    send(player.socket, { type: 'guiding', kind: 'woolly', id: woolly.id });
  }

  /** @param {Vector3} at */
  blocked([x, y, z]) {
    return boxHitsWorld(
      this.game.world,
      [x - WOOLLY_HALF, y, z - WOOLLY_HALF],
      [x + WOOLLY_HALF, y + WOOLLY_HEIGHT, z + WOOLLY_HALF],
    );
  }

  /** @param {import('./subsystem-types.ts').Woolly} woolly @param {number} dt @param {number} now */
  walk(woolly, dt, now) {
    if (now >= woolly.until) {
      this.blow(woolly);
      return;
    }
    // Falling, or landing on the top of the cell below.
    woolly.vy = Math.max(-14, woolly.vy - 20 * dt);
    const down = /** @type {Vector3} */ ([woolly.pos[0], woolly.pos[1] + woolly.vy * dt, woolly.pos[2]]);
    if (!this.blocked(down)) {
      woolly.pos = down;
      woolly.onGround = false;
    } else {
      if (woolly.vy < 0) {
        const top = GRID_MIN[1] + (cellOf(down[1], 1) + 1) * CELL;
        if (!this.blocked([down[0], top, down[2]])) woolly.pos[1] = top;
        woolly.onGround = true;
      }
      woolly.vy = 0;
    }
    // Running, and hopping when something is in the way; after a few tries, back the other way.
    const ahead = /** @type {Vector3} */ ([
      woolly.pos[0] + woolly.dir[0] * woollySpec().speed * dt,
      woolly.pos[1],
      woolly.pos[2] + woolly.dir[2] * woollySpec().speed * dt,
    ]);
    if (!this.blocked(ahead)) woolly.pos = ahead;
    else if (woolly.onGround) {
      woolly.vy = woollySpec().hop;
      woolly.onGround = false;
      if (++woolly.bumps > 2) {
        woolly.dir = mapVector(woolly.dir, (v) => -v);
        woolly.bumps = 0;
      }
    }
    if (woolly.pos[1] < VOID_Y) this.gone(woolly);
  }

  /** @param {import('./subsystem-types.ts').Woolly} woolly */
  blow(woolly) {
    this.gone(woolly);
    this.game.arsenal.blast(
      mapVector(woolly.pos, round),
      woolly.owner,
      null,
      'woolly',
      woollySpec().blast,
      'woolly',
    );
  }

  /** @param {import('./subsystem-types.ts').Woolly} woolly */
  gone(woolly) {
    this.woollies.delete(woolly.id);
    const owner = this.game.players.get(woolly.owner);
    if (owner && ![...this.woollies.values()].some((other) => other.owner === owner.id))
      send(owner.socket, { type: 'guiding', kind: null });
  }

  // For the snapshot: crates (health or special, by their look) and woollies on the run.
  /** @returns {Pick<import('../shared/runtime-types.ts').Snapshot,'crates'|'woollies'>} */
  snapshot() {
    return {
      crates: [...this.crates.values()].map(({ id, item, at, landed }) => [
        id,
        item === 'health' ? 'health' : 'special',
        ...at,
        landed ? 1 : 0,
      ]),
      woollies: [...this.woollies.values()].map(({ id, pos, dir }) => [
        id,
        ...mapVector(pos, round),
        round(dir[0]),
        round(dir[2]),
      ]),
    };
  }
}

// What's in a crate, at random, weighted by each item's chance.
function pickItem() {
  const items = Object.keys(CRATE_ITEMS);
  const total = items.reduce((sum, item) => sum + lookup(CRATE_ITEMS, item).chance, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= lookup(CRATE_ITEMS, item).chance;
    if (roll < 0) return item;
  }
  return 'health';
}

/** A woolly can only be released when its validated tuning is present. */
function woollySpec() {
  if (!WOOLLY) throw new Error('Woolly special has no tuning');
  return WOOLLY;
}
