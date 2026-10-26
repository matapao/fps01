// Weapons on the server. Each browser decides what its shots hit (what you see is what you get);
// the server checks every claim against where it last saw everyone and what's in the way. It flies
// everything that's launched and sets off the blasts. The weapons themselves are data
// (data/weapons.json, data/projectiles.json): each fires in one of the ways below, by its kind, and
// its right button by its alt's kind.

import {
  HEAD_HEIGHT,
  MAX_RANGE,
  NADE_SELF_DAMAGE,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
} from '../shared/constants.js';
import { PILOT_TURN } from '../shared/loot.js';
import { VOID_Y } from '../shared/map.js';
import { boxHitsWorld, eyePosition, playerBox, rayBox, rayWorld } from '../shared/physics.js';
import { THROW } from '../shared/tricks.js';
import { PROJECTILES, WEAPONS, costOf, pressureJump, railReach } from '../shared/weapons.js';
import { roofHole } from './roof.js';
import { indexed, lookup } from '../shared/indexed.js';
import { mapVector, AXES } from '../shared/vector.js';
import { weaponSpec } from '../shared/weapons.js';
/** @typedef {import('../shared/contracts.ts').Vector3} Vector3 */
/** @typedef {import('../shared/runtime-types.ts').Player} Player */
/** @typedef {import('./subsystem-types.ts').FlyingProjectile} FlyingProjectile */
/** @typedef {import('./subsystem-types.ts').HitClaim} HitClaim */
/** @typedef {import('../shared/runtime-types.ts').IncomingMessage} IncomingMessage */
import { along, clamp, round, sphereInBox, toDirection, toVector } from './util.js';

// How far (m) a target may have moved between what the shooter saw and what the server knows.
const HIT_SLACK = 1;
// Something launched can't hit whoever launched it for this long (it starts inside their reach).
const ARMING_MS = 300;

export class Arsenal {
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    /** @type {Map<number,FlyingProjectile>} */
    this.flying = new Map(); // id → projectile in flight
    this.nextId = 1;
  }

  clear() {
    this.flying.clear();
  }

  // A player fires: { weapon, alt, feet, dir, velocity, hits: [{ id, head, count }] }. With their
  // juggling balls out (weapon: 'trick'), they throw one.
  /** @param {Player} player @param {IncomingMessage} message */
  fire(player, message) {
    const game = this.game;
    const name = message.weapon;
    if (typeof name !== 'string') return;
    if (name === 'trick') {
      this.toss(player, message);
      return;
    }
    const spec = typeof name === 'string' && Object.hasOwn(WEAPONS, name) ? WEAPONS[name] : null;
    if (!spec || !player.alive || game.round.over || !player.weapons.has(name)) return;
    const alt = message.alt === true;
    const now = game.now();
    const { key, cooldown, cost } = costOf(name, alt);
    const rush = game.rushOf(player);
    if (now - (player.lastFire[key] ?? 0) < (cooldown / rush) * 0.8 || (player.ammo[name] ?? Infinity) < cost)
      return;
    const dir = toDirection(message.dir);
    if (!dir) return;
    game.relocate(player, message.feet);
    player.lastFire[key] = now;
    const ammo = player.ammo[name];
    if (ammo !== undefined && Number.isFinite(ammo) && cost) player.ammo[name] = ammo - cost;
    player.protectedUntil = 0; // firing ends your spawn protection
    const origin = eyePosition(player.feet);
    const hits = Array.isArray(message.hits) ? message.hits.filter(isHitClaim).slice(0, 8) : [];
    const second = alt ? spec.alt : null;
    if (second?.kind === 'slug') this.slug(player, origin, dir, hits[0], name);
    else if (second?.kind === 'launch') this.launch(player, second.projectile, dir, message.velocity);
    else if (second?.kind === 'overload') this.overload(player, origin, dir, hits[0], name);
    else if (spec.kind === 'bullet')
      this.bullet(player, origin, dir, hits[0], {
        damage: weaponNumber(name, 'damage'),
        headshot: spec.headshot,
        range: weaponNumber(name, 'range'),
        weapon: name,
      });
    else if (spec.kind === 'pellets') this.pellets(player, origin, dir, hits, name);
    else if (spec.kind === 'launcher') {
      const jump = pressureJump(game.world, player.feet, dir, spec.pressure);
      if (jump) {
        game.push(player, jump.velocity);
        game.broadcast({ type: 'pressure', id: player.id, from: origin.map(round), at: jump.at.map(round) });
      } else {
        if (!spec.projectile) throw new Error('Launcher has no projectile');
        this.launch(player, spec.projectile, dir, message.velocity);
      }
    } else if (spec.kind === 'beam') this.beam(player, origin, dir, hits[0], name);
    else if (spec.kind === 'rail')
      this.rail(player, origin, dir, hits, second?.kind === 'charge' ? second.pierce : 0, name);
  }

  // A juggling ball thrown (shared/tricks.js), as often as it can be.
  /** @param {Player} player @param {IncomingMessage} message */
  toss(player, message) {
    const game = this.game;
    if (!player.alive || game.round.over) return;
    const { projectile, cooldownMs } = THROW;
    const now = game.now();
    if (now - (player.lastFire['trick'] ?? 0) < (cooldownMs / game.rushOf(player)) * 0.8) return;
    const dir = toDirection(message.dir);
    if (!dir) return;
    game.relocate(player, message.feet);
    player.lastFire['trick'] = now;
    player.protectedUntil = 0; // throwing ends your spawn protection, like firing
    this.launch(player, projectile, dir, message.velocity);
  }

  // How far along the shot a claimed hit on target is, if it's believable: the shot passed close to
  // where the server last saw them, and before `limit` (the first wall, or the weapon's range).
  /** @param {Player} shooter @param {Vector3} origin @param {Vector3} dir @param {Player|null|undefined} target @param {number} limit */
  believable(shooter, origin, dir, target, limit) {
    if (!target || target === shooter || !target.alive) return null;
    const centre = /** @type {Vector3} */ ([
      target.feet[0],
      target.feet[1] + PLAYER_HEIGHT / 2,
      target.feet[2],
    ]);
    const distance = centre.reduce(
      (sum, value, i) => sum + (value - indexed(origin, i)) * indexed(dir, i),
      0,
    );
    if (
      rayBox(origin, dir, playerBox(target.feet, HIT_SLACK)) === Infinity ||
      distance - PLAYER_RADIUS >= limit
    )
      return null;
    return Math.max(0, distance);
  }

  // A single bullet: the rifle's, or the shotgun's slug. Misses chip
  // the wall they hit; a miss that gets out of the arena may hit a planet.
  /** @param {Player} player @param {Vector3} origin @param {Vector3} dir @param {HitClaim|undefined} claim @param {{damage:number,headshot?:number,range:number,weapon:string}} options */
  bullet(player, origin, dir, claim, { damage, headshot = 1, range, weapon }) {
    const game = this.game;
    const block = game.world.raycast(origin, dir, range);
    const wall = block?.distance ?? range;
    const target = claim && game.players.get(claim.id);
    const hit = this.believable(player, origin, dir, target, wall);
    game.broadcast(
      { type: 'shot', id: player.id, weapon, from: origin.map(round), to: along(origin, dir, hit ?? wall) },
      player.socket,
    );
    if (hit !== null && target) {
      const head = claim?.head === true;
      game.damage(player, target, Math.round(damage * (head ? headshot : 1)), { head, weapon });
    } else if (block) {
      game.chip(block.cell, player.id);
    } else {
      game.planets.shoot(player, dir); // out of the arena: maybe straight at a planet
    }
    return hit === null ? block : null;
  }

  // Pellets (the shotgun): up to so many, claimed per target, each target somewhere inside the cone.
  /** @param {Player} player @param {Vector3} origin @param {Vector3} dir @param {HitClaim[]} claims @param {string} name */
  pellets(player, origin, dir, claims, name) {
    const game = this.game;
    let left = weaponNumber(name, 'pellets');
    for (const claim of claims) {
      const target = game.players.get(claim.id);
      const count =
        typeof claim.count === 'number' && Number.isFinite(claim.count)
          ? Math.min(left, Math.max(0, Math.floor(claim.count)))
          : 0;
      if (
        !target ||
        !count ||
        !this.inCone(player, origin, dir, target, weaponNumber(name, 'cone'), weaponNumber(name, 'range'))
      )
        continue;
      left -= count;
      game.damage(player, target, weaponNumber(name, 'damage') * count, { weapon: name });
    }
    const block = game.world.raycast(origin, dir, weaponNumber(name, 'range'));
    game.broadcast(
      {
        type: 'shot',
        id: player.id,
        weapon: name,
        from: origin.map(round),
        to: along(origin, dir, block?.distance ?? weaponNumber(name, 'range')),
      },
      player.socket,
    );
    if (block) game.chip(block.cell, player.id);
  }

  // Whether a target is inside a cone from origin, within range, with nothing in the way.
  /** @param {Player} shooter @param {Vector3} origin @param {Vector3} dir @param {Player|undefined} target @param {number} cone @param {number} range */
  inCone(shooter, origin, dir, target, cone, range) {
    if (!target || target === shooter || !target.alive) return false;
    const centre = /** @type {Vector3} */ ([
      target.feet[0],
      target.feet[1] + PLAYER_HEIGHT / 2,
      target.feet[2],
    ]);
    const offset = mapVector(centre, (value, i) => value - origin[i]);
    const distance = Math.hypot(...offset);
    if (distance > range + HIT_SLACK || distance < 0.01) return distance < 0.01;
    const angle = Math.acos(
      clamp(
        offset.reduce((sum, value, i) => sum + (value / distance) * indexed(dir, i), 0),
        -1,
        1,
      ),
    );
    if (angle > cone + Math.atan2(PLAYER_RADIUS + HIT_SLACK, distance)) return false;
    return !this.blocked(origin, centre);
  }

  // Whether a wall stands between two points.
  /** @param {Vector3} from @param {Vector3} to */
  blocked(from, to) {
    const offset = mapVector(to, (value, i) => value - from[i]);
    const length = Math.hypot(...offset);
    if (length < 0.01) return false;
    return (
      rayWorld(
        this.game.world,
        from,
        mapVector(offset, (value) => value / length),
        length,
      ) <
      length - 0.3
    );
  }

  // A slug (the shotgun's alt-fire): one heavy shot, and if it hits a wall close by, it blows a doorway.
  /** @param {Player} player @param {Vector3} origin @param {Vector3} dir @param {HitClaim|undefined} claim @param {string} name */
  slug(player, origin, dir, claim, name) {
    const slug = weaponSpec(name).alt;
    if (slug?.kind !== 'slug') throw new Error('Weapon has no slug alternate');
    const block = this.bullet(player, origin, dir, claim, {
      damage: slug.damage,
      range: slug.range,
      weapon: name,
    });
    if (!block) return;
    const at = along(origin, dir, block.distance + 0.25);
    this.game.broadcast({ type: 'boom', kind: 'breach', at, owner: player.id, hole: slug.hole });
    this.game.carve(at, slug.hole, player.id);
  }

  // One tick of a beam (the spark gun).
  /** @param {Player} player @param {Vector3} origin @param {Vector3} dir @param {HitClaim|undefined} claim @param {string} name */
  beam(player, origin, dir, claim, name) {
    const game = this.game;
    const wall = rayWorld(game.world, origin, dir, weaponNumber(name, 'range'));
    const target = claim && game.players.get(claim.id);
    const hit = this.believable(player, origin, dir, target, wall);
    game.broadcast(
      {
        type: 'shot',
        id: player.id,
        weapon: name,
        from: origin.map(round),
        to: along(origin, dir, hit ?? wall),
      },
      player.socket,
    );
    if (hit !== null && target) game.damage(player, target, weaponNumber(name, 'damage'), { weapon: name });
  }

  // An overload (the spark gun's alt-fire): a jolt to whoever you hit, arcing on to more people nearby.
  /** @param {Player} player @param {Vector3} origin @param {Vector3} dir @param {HitClaim|undefined} claim @param {string} name */
  overload(player, origin, dir, claim, name) {
    const game = this.game;
    const overload = weaponSpec(name).alt,
      range = weaponNumber(name, 'range');
    if (overload?.kind !== 'overload') throw new Error('Weapon has no overload alternate');
    const wall = rayWorld(game.world, origin, dir, range);
    const first = claim && game.players.get(claim.id);
    const hit = this.believable(player, origin, dir, first, wall);
    const points = [origin.map(round), along(origin, dir, hit ?? wall)];
    if (hit !== null && first) {
      game.damage(player, first, overload.damage, { weapon: name });
      let from = first;
      const struck = new Set([first.id, player.id]);
      for (let link = 0; link < overload.links; link++) {
        const at = /** @type {Vector3} */ ([from.feet[0], from.feet[1] + 1, from.feet[2]]);
        const next = [...game.players.values()]
          .filter(
            (other) => other.alive && !struck.has(other.id) && !(player.team && other.team === player.team),
          )
          .map((other) => ({
            other,
            distance: Math.hypot(...other.feet.map((v, i) => v - indexed(from.feet, i))),
          }))
          .filter(
            ({ other, distance }) =>
              distance <= overload.reach &&
              !this.blocked(at, [other.feet[0], other.feet[1] + 1, other.feet[2]]),
          )
          .sort((a, b) => a.distance - b.distance)[0]?.other;
        if (!next) break;
        struck.add(next.id);
        points.push([next.feet[0], next.feet[1] + 1, next.feet[2]].map(round));
        game.damage(player, next, overload.chain, { weapon: name });
        from = next;
      }
    }
    game.broadcast({ type: 'arc', id: player.id, points });
  }

  // A rail (the railgun): it hits everyone in its path, up to the first wall. Charged (its alt-fire),
  // it also punches through `pierce` metres of wall, breaking it.
  /** @param {Player} player @param {Vector3} origin @param {Vector3} dir @param {HitClaim[]} claims @param {number} pierce @param {string} name */
  rail(player, origin, dir, claims, pierce, name) {
    const game = this.game;
    const { reach, through } = railReach(game.world, origin, dir, pierce > 0, pierce);
    let landed = false;
    for (const claim of claims) {
      const target = game.players.get(claim.id);
      if (!target || this.believable(player, origin, dir, target, reach) === null) continue;
      landed = true;
      game.damage(player, target, weaponNumber(name, 'damage'), { head: claim.head === true, weapon: name });
    }
    // Two hits in a row: Back to Back.
    player.railHits = landed ? (player.railHits ?? 0) + 1 : 0;
    if (player.railHits >= 2) {
      player.railHits = 0;
      game.medal(player, 'backtoback');
    }
    game.broadcast(
      { type: 'shot', id: player.id, weapon: name, from: origin.map(round), to: along(origin, dir, reach) },
      player.socket,
    );
    for (const cell of through) game.smash(cell, player.id);
    if (reach >= MAX_RANGE) game.planets.shoot(player, dir); // out of the arena: maybe straight at a planet
  }

  // Launches a projectile of some kind from a player's eyes. Grenades carry half the thrower's speed.
  /** @param {Player} player @param {string} kind @param {Vector3} dir @param {unknown} velocity @param {{from?:Vector3|null}} options @returns {FlyingProjectile} */
  launch(player, kind, dir, velocity, { from = null } = {}) {
    const game = this.game;
    const spec = lookup(PROJECTILES, kind);
    const carried = /** @type {Vector3} */ (
      spec.gravity ? (toVector(velocity) ?? [0, 0, 0]).map((v) => clamp(v, -12, 12) * 0.5) : [0, 0, 0]
    );
    let pos = from;
    if (!pos) {
      // Just in front of the eyes, but never inside a wall.
      const eye = eyePosition(player.feet);
      const reach = Math.max(0, Math.min(0.6, rayWorld(game.world, eye, dir, 0.6) - spec.size));
      pos = mapVector(eye, (value, i) => value + dir[i] * reach);
    }
    const now = game.now();
    /** @type {FlyingProjectile} */
    const shot = {
      id: this.nextId++,
      owner: player.id,
      kind,
      pos,
      vel: mapVector(dir, (d, i) => d * spec.speed + carried[i]),
      born: now,
      fuseAt: now + spec.fuseMs,
    };
    this.flying.set(shot.id, shot);
    game.broadcast({
      type: 'launch',
      id: player.id,
      shot: shot.id,
      kind,
      from: pos.map(round),
      velocity: shot.vel.map(round),
    });
    return shot;
  }

  // Moves everything in flight a tick on.
  /** @param {number} dt @param {number} now */
  tick(dt, now) {
    for (const shot of [...this.flying.values()]) this.fly(shot, dt, now);
  }

  // Things go off where they hit (a floor, a wall, a crate or a player), except bouncing ones,
  // which bounce (and roll) until their fuse runs out.
  /** @param {FlyingProjectile} shot @param {number} dt @param {number} now */
  fly(shot, dt, now) {
    const game = this.game;
    const spec = lookup(PROJECTILES, shot.kind);
    if (spec.steer && shot.aim) this.turn(shot, spec.speed, dt);
    const speed = Math.hypot(...shot.vel);
    const steps = Math.max(4, Math.ceil((speed * dt) / 0.25)); // small steps, so nothing passes through a wall
    const h = dt / steps;
    for (let step = 0; step < steps; step++) {
      shot.vel[1] -= spec.gravity * h;
      if (spec.bounce) {
        for (const axis of AXES) {
          shot.pos[axis] += shot.vel[axis] * h;
          if (!this.inWall(shot.pos, spec.size)) continue;
          shot.pos[axis] -= shot.vel[axis] * h;
          shot.vel[axis] *= -spec.bounce;
          for (const other of AXES) if (other !== axis) shot.vel[other] *= 0.85;
        }
      } else {
        const next = mapVector(shot.pos, (value, i) => value + shot.vel[i] * h);
        if (this.inWall(next, spec.size)) {
          this.explode(shot);
          return;
        }
        shot.pos = next;
      }
      for (const player of game.players.values()) {
        // Never on whoever launched it, just after; a grenade they threw never at all (it waits for its fuse).
        if (!player.alive || (player.id === shot.owner && (spec.bounce || now - shot.born < ARMING_MS)))
          continue;
        if (sphereInBox(shot.pos, spec.size, playerBox(player.feet))) {
          this.explode(shot, player);
          return;
        }
      }
    }
    if (now >= shot.fuseAt || shot.pos[1] < VOID_Y) this.explode(shot);
  }

  // A pilot missile turns towards where its owner looks, but only so fast: it swings round in the
  // plane of where it's heading and where they look, by at most PILOT_TURN radians a second.
  /** @param {FlyingProjectile} shot @param {number} speed @param {number} dt */
  turn(shot, speed, dt) {
    const aim = shot.aim;
    if (!aim) return;
    const heading = mapVector(shot.vel, (v) => v / speed);
    const cos = clamp(
      heading.reduce((sum, v, i) => sum + v * indexed(aim, i), 0),
      -1,
      1,
    );
    const angle = Math.acos(cos);
    if (angle < 1e-4) return;
    if (angle > Math.PI - 1e-3) return; // straight behind: no way to tell which way to turn, so it carries on
    const across = mapVector(aim, (v, i) => v - heading[i] * cos);
    const length = Math.hypot(...across);
    const step = Math.min(angle, PILOT_TURN * dt);
    shot.vel = mapVector(
      heading,
      (v, i) => (v * Math.cos(step) + (across[i] / length) * Math.sin(step)) * speed,
    );
  }

  /** @param {Vector3} pos @param {number} size */
  inWall(pos, size) {
    return boxHitsWorld(
      this.game.world,
      mapVector(pos, (v) => v - size),
      mapVector(pos, (v) => v + size),
    );
  }

  // Something goes off: a blast (a juggling ball just hits whoever it lands on); mortars split.
  /** @param {FlyingProjectile} shot @param {Player|null} direct */
  explode(shot, direct = null) {
    if (!this.flying.delete(shot.id)) return;
    const game = this.game;
    const spec = lookup(PROJECTILES, shot.kind);
    const at = mapVector(shot.pos, round); // the browsers change their copy of the arena with exactly these numbers
    if (spec.steer) game.crates.guided(shot);
    if (spec.hit) this.strike(shot, direct, at);
    if (spec.blast) this.blast(at, shot.owner, direct, spec.credit ?? shot.kind, spec.blast, shot.kind);
    if (spec.split) {
      const owner = game.players.get(shot.owner);
      for (let i = 0; i < spec.split.count; i++) {
        const angle = (i / spec.split.count) * Math.PI * 2 + Math.random();
        const dir = /** @type {Vector3} */ ([Math.cos(angle) * 0.8, 0.6, Math.sin(angle) * 0.8]);
        if (owner) this.launch(owner, spec.split.into, dir, null, { from: [at[0], at[1] + 0.3, at[2]] });
      }
    }
  }

  // A thrown juggling ball comes down, on someone or on something: it hurts whoever it hit, more in
  // the head, and that's all.
  /** @param {FlyingProjectile} shot @param {Player|null} target @param {Vector3} at */
  strike(shot, target, at) {
    const game = this.game;
    game.broadcast({ type: 'boom', kind: shot.kind, at, owner: shot.owner, on: target?.id ?? null });
    if (!target) return;
    const spec = lookup(PROJECTILES, shot.kind);
    if (!spec.hit) throw new Error('Projectile has no direct hit contract');
    const { damage, headshot } = spec.hit;
    const head = at[1] - target.feet[1] >= HEAD_HEIGHT;
    game.damage(game.players.get(shot.owner) ?? null, target, Math.round(damage * (head ? headshot : 1)), {
      weapon: lookup(PROJECTILES, shot.kind).credit ?? shot.kind,
      head,
    });
  }

  // A blast: damage falls off from the full amount at the centre to nothing at its radius, measured
  // to the nearest part of each player. Walls shield you; your own blast does half. It throws any
  // grenades close by about, and tears a hole in whatever is around it: a bigger one in the roof
  // or a pillar (roof.js).
  /** @param {Vector3} at @param {number} ownerId @param {Player|null} direct @param {string} weapon @param {{damage:number,radius:number,hole:number,push:number}} spec */
  blast(at, ownerId, direct, weapon, { damage, radius, hole, push }, kind = 'frag') {
    const game = this.game;
    const attacker = game.players.get(ownerId) ?? null;
    hole = roofHole(game.world, at, hole);
    game.broadcast({ type: 'boom', kind, at, owner: ownerId, hole, radius, push });
    for (const player of [...game.players.values()]) {
      if (!player.alive) continue;
      const box = playerBox(player.feet);
      const nearest = mapVector(at, (value, i) => clamp(value, box.min[i], box.max[i]));
      const distance = player === direct ? 0 : Math.hypot(...mapVector(nearest, (value, i) => value - at[i]));
      if (distance >= radius || (player !== direct && game.shielded(at, player))) continue;
      let amount = damage * (1 - distance / radius);
      if (player.id === ownerId) amount *= NADE_SELF_DAMAGE;
      amount = Math.round(amount);
      if (amount > 0) game.damage(attacker, player, amount, { weapon, splash: true });
    }
    for (const shot of this.flying.values()) {
      if (!lookup(PROJECTILES, shot.kind).bounce) continue;
      const offset = mapVector(shot.pos, (value, i) => value - at[i]);
      const distance = Math.hypot(...offset);
      if (distance >= radius || distance < 0.01) continue;
      const kick = push * 1.5 * (1 - distance / radius);
      for (const i of AXES) shot.vel[i] += (offset[i] / distance) * kick + (i === 1 ? kick * 0.4 : 0);
    }
    if (hole) game.carve(at, hole, ownerId);
  }

  /** @returns {import('../shared/runtime-types.ts').Snapshot['projectiles']} */
  snapshot() {
    return [...this.flying.values()].map((shot) => [shot.id, shot.kind, ...mapVector(shot.pos, round)]);
  }
}

/** @param {unknown} hit @returns {hit is HitClaim} */
function isHitClaim(hit) {
  return typeof hit === 'object' && hit !== null && 'id' in hit && typeof hit.id === 'number';
}
/** @param {string} name @param {'damage'|'range'|'cone'|'pellets'} field */
function weaponNumber(name, field) {
  const value = weaponSpec(name)[field];
  if (value === undefined) throw new Error(`Missing weapon ${name}.${field}`);
  return value;
}
