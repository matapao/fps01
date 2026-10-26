// Your weapons in the browser: what you carry, what's in your hands, and firing it. Your browser
// works out what each shot hits (what you see is what you get) and tells the server, which checks
// it. Everything that flies (grenades, rockets, juggling balls) is the server's: you see it in its
// snapshots. The weapons themselves are data (data/weapons.json): each fires by its kind, and its
// right button by its alt's kind.

import { indexed } from '/shared/indexed.js';
import { mapVector } from '/shared/vector.js';
import { scatter } from '/shared/aim.js';
import { KICK_COOLDOWN_MS, KICK_REACH, PLAYER_HEIGHT, PLAYER_RADIUS } from '/shared/constants.js';
import { CRATE_ITEMS, TELEPORT_RANGE } from '/shared/loot.js';
import { boxHitsWorld, eyePosition, playerBox } from '/shared/physics.js';
import { THROW } from '/shared/tricks.js';
import {
  ARSENAL,
  SPAWN_WEAPONS,
  WEAPONS,
  costOf,
  pressureJump,
  railReach,
  weaponSpec,
} from '/shared/weapons.js';

// Which weapon your hands go to when the one in them runs dry: the best you have that's loaded.
const byBest = () => [...ARSENAL].sort((a, b) => (weaponSpec(a).best ?? 99) - (weaponSpec(b).best ?? 99));
// What a weapon's right button does: zoom and charge are held; the others fire.
/** @param {string} name */
const altOf = (name) => WEAPONS[name]?.alt?.kind ?? null;

/** @param {import('./contracts.d.ts').Vec3} origin @param {import('./contracts.d.ts').Vec3} dir @param {number} distance */
const along = (origin, dir, distance) => mapVector(origin, (value, i) => value + dir[i] * distance);

export class Arsenal {
  // game: { me, camera, voxels, avatars, effects, gun, send, sound, hud, look(), rush(), colorOf(id),
  // chipsOff(at, block), openStrikeMap(), flourish() }. Besides the weapons and a special, you can
  // hold your juggling balls ('trick', on F): the action button throws one, the right button shows
  // off the next trick.
  /** @param {typeof import('./main.js').shared} game */
  constructor(game) {
    this.game = game;
    this.owned = new Set(SPAWN_WEAPONS);
    /** @type {Record<string, number | null | undefined>} */
    this.ammo = {}; // weapon → shots left (the rifle and the shotgun never run out)
    this.weapon = indexed(SPAWN_WEAPONS, 0);
    this.previous = indexed(SPAWN_WEAPONS, SPAWN_WEAPONS.length - 1); // what the middle button switches back to
    /** @type {Record<string, number | undefined>} */
    this.lastFire = {};
    /** @type {Record<string, number | undefined>} */
    this.firedAt = {}; // weapon → when you last fired it here, so an older count from the server doesn't undo it
    this.primary = false; // the buttons held: left fires, right is the alt-fire (the rifle zooms)
    this.secondary = false;
    this.tapped = { primary: false, secondary: false }; // pressed since the last frame: a quick click still fires
    /** @type {number | null} */
    this.chargeStart = null; // when you started charging the railgun (holding the right button)
    this.lastKick = -Infinity;
    this.clicked = false; // the empty click plays once per press
    /** @type {string | null} */
    this.special = null; // what a crate gave you, for one use, on 7
    this.usedAt = -Infinity;
  }

  // A fresh life: the weapons you start with (the rifle and the shotgun), the first of them in hand.
  reset() {
    this.owned = new Set(SPAWN_WEAPONS);
    this.ammo = {};
    this.chargeStart = null;
    this.previous = indexed(SPAWN_WEAPONS, SPAWN_WEAPONS.length - 1);
    this.weapon = indexed(SPAWN_WEAPONS, 0);
    this.game.gun.setWeapon(this.weapon);
  }

  // What the server says you carry. A weapon (or special) you didn't have before goes straight into
  // your hands; a special you've used gives you back the weapon you had before.
  /** @param {Pick<import('../../shared/runtime-types.ts').SelfMessage, 'weapons' | 'ammo'> & {special?: string | null}} self */
  sync({ weapons, ammo, special = null }) {
    const now = performance.now();
    const gained = weapons.filter((name) => !this.owned.has(name));
    const newSpecial = special && special !== this.special;
    this.owned = new Set(weapons);
    this.special = special;
    for (const name of ARSENAL) {
      if (now - (this.firedAt[name] ?? -Infinity) > 200) this.ammo[name] = ammo[name];
    }
    if (special) this.game.gun.setSpecial(special);
    if (gained.length) this.select(indexed(gained, gained.length - 1));
    else if (newSpecial) this.select('special');
    else if (this.weapon === 'special' && !special)
      this.select(this.owned.has(this.previous) ? this.previous : indexed(SPAWN_WEAPONS, 0));
    else if (this.weapon !== 'special' && this.weapon !== 'trick' && !this.owned.has(this.weapon))
      this.select(indexed(SPAWN_WEAPONS, 0));
  }

  /** @param {string} name */
  select(name) {
    if (name === this.weapon) return false;
    if (name === 'trick') {
      // Always to hand.
    } else if (name === 'special') {
      if (!this.special) {
        this.game.hud.notice('No special yet · crates drift down now and then', 1500);
        this.game.sound.empty();
        return false;
      }
    } else if (!WEAPONS[name]) {
      return false;
    } else if (!this.owned.has(name)) {
      this.game.hud.notice(`No ${weaponSpec(name).name.toLowerCase()} yet · find one on its pad`, 1500);
      this.game.sound.empty();
      return false;
    }
    if (this.weapon !== 'special' && this.weapon !== 'trick') this.previous = this.weapon;
    this.weapon = name;
    this.chargeStart = null;
    this.game.gun.setWeapon(name);
    return true;
  }

  // What's in your hands, by name.
  weaponName() {
    if (this.weapon === 'trick') return 'Juggling';
    return this.weapon === 'special'
      ? ((this.special ? CRATE_ITEMS[this.special]?.name : undefined) ?? 'Special')
      : weaponSpec(this.weapon).name;
  }

  // The mouse wheel: the next (or previous) weapon you carry.
  /** @param {number} step */
  cycle(step) {
    const list = [
      ...ARSENAL.filter((name) => this.owned.has(name)),
      ...(this.special ? ['special'] : []),
      'trick',
    ];
    const at = list.indexOf(this.weapon);
    this.select(indexed(list, (at + step + list.length) % list.length));
  }

  swap() {
    if (this.owned.has(this.previous)) this.select(this.previous);
  }

  // F: out come your juggling balls; with them out, the next trick.
  trickKey() {
    if (this.weapon === 'trick') this.game.flourish();
    else this.select('trick');
  }

  // Pausing, blur and device loss cancel presses; ordinary trigger release may still fire a charge.
  cancelInput() {
    this.primary = false;
    this.secondary = false;
    this.tapped.primary = false;
    this.tapped.secondary = false;
    this.chargeStart = null;
    this.clicked = false;
  }

  /** @param {boolean} held */
  setPrimary(held) {
    this.primary = held;
    if (held) this.tapped.primary = true;
    else this.clicked = false;
  }

  // The right button. Releasing it with a weapon that charges (the railgun) fires: charged, if
  // it's had long enough.
  /** @param {boolean} held @param {number} now */
  setSecondary(held, now) {
    this.secondary = held;
    if (held) this.tapped.secondary = true;
    else this.clicked = false;
    if (held || altOf(this.weapon) !== 'charge' || this.chargeStart === null) return;
    const alt = weaponSpec(this.weapon).alt;
    if (alt?.kind !== 'charge') throw new Error('Charge weapon contract is invalid');
    const charged = now - this.chargeStart >= alt.ms;
    this.chargeStart = null;
    if (this.game.me.alive && this.game.gun.ready() && this.take(this.weapon, false, now)) this.rail(charged);
  }

  // How far the charge is, 0 to 1.
  /** @param {number} now */
  charge(now) {
    const alt = WEAPONS[this.weapon]?.alt;
    return this.chargeStart === null || alt?.kind !== 'charge'
      ? 0
      : Math.min(1, (now - this.chargeStart) / alt.ms);
  }

  // Fires whatever the buttons say, as often as the weapon allows.
  /** @param {number} now */
  update(now) {
    const { me, gun } = this.game;
    gun.setCharge(this.charge(now));
    if (me.alive && !gun.ready()) return; // Preserve a quick press while the weapon comes up.
    const tapped = { ...this.tapped };
    this.tapped.primary = this.tapped.secondary = false;
    if (!me.alive) return;
    const name = this.weapon;
    const primary = this.primary || tapped.primary;
    const secondary = this.secondary || tapped.secondary;
    if (name === 'special') {
      if (primary) this.useSpecial(now);
      return;
    }
    if (name === 'trick') {
      if (primary) this.throwTrick(now);
      else if (tapped.secondary) this.game.flourish();
      return;
    }
    const second = altOf(name);
    if (second === 'charge' && this.secondary) {
      if (this.chargeStart === null && this.ready(name, false, now) && (this.ammo[name] ?? Infinity) > 0) {
        this.chargeStart = now;
        const alt = weaponSpec(name).alt;
        if (alt?.kind !== 'charge') throw new Error('Charge weapon contract is invalid');
        this.game.sound.charge(alt.ms);
      }
      return;
    }
    if (primary) this.fire(name, false, now);
    else if (secondary && second && second !== 'zoom' && second !== 'charge') this.fire(name, true, now); // a zoom is held, not fired
  }

  // A juggling ball, thrown (shared/tricks.js): the server throws it for everyone, and your hand
  // throws it here.
  /** @param {number} now */
  throwTrick(now) {
    const { me, gun, send, sound } = this.game;
    const { cooldownMs } = THROW;
    if (now - (this.lastFire['trick'] ?? -Infinity) < cooldownMs / this.game.rush()) return;
    this.lastFire['trick'] = now;
    send({ type: 'fire', weapon: 'trick', feet: me.feet, dir: this.game.look(), velocity: me.velocity });
    gun.tossTrick(cooldownMs);
    sound.toss();
  }

  /** @param {string} name @param {boolean} alt @param {number} now */
  ready(name, alt, now) {
    const { key, cooldown } = costOf(name, alt);
    return now - (this.lastFire[key] ?? -Infinity) >= cooldown / this.game.rush();
  }

  // Uses up a shot, if the weapon is ready and loaded. Out of ammo, it clicks and switches to the best weapon you have left.
  /** @param {string} name @param {boolean} alt @param {number} now */
  take(name, alt, now) {
    if (!this.ready(name, alt, now)) return false;
    const { key, cost } = costOf(name, alt);
    const left = this.ammo[name] ?? Infinity;
    if (left < cost) {
      if (!this.clicked) this.game.sound.empty();
      this.clicked = true;
      const best = byBest().find(
        (other) => other !== name && this.owned.has(other) && (this.ammo[other] ?? Infinity) > 0,
      );
      if (best && left <= 0) this.select(best);
      return false;
    }
    this.lastFire[key] = now;
    this.firedAt[name] = now;
    if (Number.isFinite(left) && cost) this.ammo[name] = left - cost;
    return true;
  }

  /** @param {string} name @param {boolean} alt @param {number} now */
  fire(name, alt, now) {
    if (!this.take(name, alt, now)) return;
    const { kind } = weaponSpec(name);
    const second = alt ? altOf(name) : null;
    if (second === 'slug') this.slug(name);
    else if (second === 'launch' || kind === 'launcher') this.launch(name, alt);
    else if (second === 'overload' || kind === 'beam') this.spark(name, alt);
    else if (kind === 'bullet') this.rifle(name);
    else if (kind === 'pellets') this.shotgun(name);
    else if (kind === 'rail') this.rail(false);
  }

  /** @param {number} spread */
  aim(spread) {
    const { me } = this.game;
    return { origin: eyePosition(me.feet), dir: scatter(this.game.look(), spread) };
  }

  // Aiming feedback uses exactly the same ground test as primary fire.
  pressureReady() {
    const { me, voxels } = this.game;
    const pressure = WEAPONS[this.weapon]?.pressure;
    return Boolean(
      pressure &&
      this.owned.has(this.weapon) &&
      (this.ammo[this.weapon] ?? 0) > 0 &&
      pressureJump(voxels, me.feet, this.game.look(), pressure),
    );
  }

  // A bullet from the rifle.
  /** @param {string} name */
  rifle(name) {
    const { me, voxels, avatars, effects, gun, camera, send, sound } = this.game;
    const { range } = weaponSpec(name);
    if (range === undefined) throw new Error(`Weapon ${name} requires a range`);
    const { origin, dir } = this.aim(me.spread);
    const block = voxels.raycast(origin, dir, range);
    const wall = block?.distance ?? range;
    const target = avatars.raycast(origin, dir, wall);
    send({
      type: 'fire',
      weapon: name,
      feet: me.feet,
      dir,
      hits: target ? [{ id: target.id, head: target.head }] : [],
    });
    const end = along(origin, dir, target ? target.distance : wall);
    effects.tracer(gun.muzzle(camera), end, true);
    if (!target) effects.impact(end);
    if (!target && block) this.game.chipsOff(end, block);
    gun.kick();
    sound.play(weaponSpec(name).sound);
  }

  // Pellets (the shotgun's eleven), each its own ray inside the cone; the server is told how many hit whom.
  /** @param {string} name */
  shotgun(name) {
    const { me, voxels, avatars, effects, gun, camera, send, sound } = this.game;
    const { pellets, cone, range } = weaponSpec(name);
    if (pellets === undefined || cone === undefined || range === undefined)
      throw new Error(`Weapon ${name} requires pellet settings`);
    const { origin, dir: centre } = this.aim(me.spread * 0.5);
    const counts = new Map();
    const ends = [];
    for (let i = 0; i < pellets; i++) {
      const dir = scatter(centre, cone);
      const block = voxels.raycast(origin, dir, range);
      const wall = block?.distance ?? range;
      const target = avatars.raycast(origin, dir, wall);
      if (target) counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
      const end = along(origin, dir, target ? target.distance : wall);
      ends.push(end);
      if (!target && block && i % 3 === 0) this.game.chipsOff(end, block);
    }
    send({
      type: 'fire',
      weapon: name,
      feet: me.feet,
      dir: centre,
      hits: [...counts].map(([id, count]) => ({ id, count })),
    });
    effects.pellets(gun.muzzle(camera), ends);
    gun.kick();
    sound.play(weaponSpec(name).sound);
  }

  // A breaching slug: one heavy shot. The server blows the doorway if it hits a wall close by.
  /** @param {string} name */
  slug(name) {
    const { me, voxels, avatars, effects, gun, camera, send, sound } = this.game;
    const slug = weaponSpec(name).alt;
    if (slug?.kind !== 'slug') throw new Error(`Weapon ${name} requires slug settings`);
    const { origin, dir } = this.aim(me.spread);
    const block = voxels.raycast(origin, dir, slug.range);
    const wall = block?.distance ?? slug.range;
    const target = avatars.raycast(origin, dir, wall);
    send({
      type: 'fire',
      weapon: name,
      alt: true,
      feet: me.feet,
      dir,
      hits: target ? [{ id: target.id, head: target.head }] : [],
    });
    effects.streak(
      gun.muzzle(camera),
      along(origin, dir, target ? target.distance : wall),
      0xffc070,
      0.035,
      0.12,
    );
    gun.kick();
    sound.play(weaponSpec(name).sound);
  }

  // The server flies grenades and rockets; launch messages draw them before the next snapshot.
  /** @param {string} name @param {boolean} alt */
  launch(name, alt) {
    const { me, voxels, gun, send, sound } = this.game;
    // Rockets follow the crosshair even while running or jumping.
    const spec = weaponSpec(name);
    const { dir } = this.aim(spec.projectile === 'rocket' ? 0 : me.spread);
    const jump = !alt && pressureJump(voxels, me.feet, dir, spec.pressure);
    send({ type: 'fire', weapon: name, alt, feet: me.feet, dir, velocity: me.velocity });
    gun.kick(Boolean(jump));
    sound.play(weaponSpec(name).sound);
  }

  // A beam (the spark gun) hits whatever is on the end of it, every tick. An overload arcs from
  // there to more people: the server works that out and shows everyone.
  /** @param {string} name @param {boolean} alt */
  spark(name, alt) {
    const { me, voxels, avatars, effects, gun, camera, send, sound } = this.game;
    const { range } = weaponSpec(name);
    if (range === undefined) throw new Error(`Weapon ${name} requires a range`);
    const { origin, dir } = this.aim(me.spread * 0.3);
    const block = voxels.raycast(origin, dir, range);
    const wall = block?.distance ?? range;
    const target = avatars.raycast(origin, dir, wall);
    send({ type: 'fire', weapon: name, alt, feet: me.feet, dir, hits: target ? [{ id: target.id }] : [] });
    if (alt) sound.overload();
    else {
      effects.beam(gun.muzzle(camera), along(origin, dir, target ? target.distance : wall));
      sound.play(weaponSpec(name).sound);
    }
    gun.kick();
  }

  // A rail goes through everyone in its path, up to the first wall; charged, through a metre of that too.
  /** @param {boolean} charged */
  rail(charged) {
    const { me, voxels, avatars, effects, gun, camera, send, sound } = this.game;
    const name = this.weapon;
    const { origin, dir } = this.aim(me.spread);
    const alt = weaponSpec(name).alt;
    const { reach } = railReach(voxels, origin, dir, charged, alt?.kind === 'charge' ? alt.pierce : 0);
    const hits = avatars.raycastAll(origin, dir, reach).map(({ id, head }) => ({ id, head }));
    send({ type: 'fire', weapon: name, alt: charged, feet: me.feet, dir, hits });
    effects.rail(gun.muzzle(camera), along(origin, dir, reach), this.game.colorOf(me.id));
    gun.kick();
    sound.play(weaponSpec(name).sound);
  }

  // 7: your special, once. A teleport goes where you aim; an air strike opens the map to pick a spot.
  /** @param {number} now */
  useSpecial(now) {
    const { me, gun, send, sound, hud } = this.game;
    this.primary = false; // one use per click
    if (!this.special || now - this.usedAt < 600) return;
    if (this.special === 'airstrike') {
      this.game.openStrikeMap();
      return;
    }
    if (this.special === 'teleport') {
      const at = this.teleportTarget();
      if (!at) {
        sound.empty();
        hud.notice('Nowhere to land there', 1200);
        return;
      }
      send({ type: 'special', at });
    } else {
      send({ type: 'special', feet: me.feet, dir: this.aim(me.spread).dir, velocity: me.velocity });
      sound.launch();
    }
    this.usedAt = now;
    gun.kick();
  }

  // Where a teleport would put you: on the floor where you aim, or at the foot of the wall you aim
  // at, if you fit there. Null if not.
  teleportTarget() {
    const { me, voxels } = this.game;
    const origin = eyePosition(me.feet);
    const dir = this.game.look();
    const hit = voxels.raycast(origin, dir, TELEPORT_RANGE);
    if (!hit) return null;
    const point = along(origin, dir, hit.distance - 0.02);
    /** @type {import('./contracts.d.ts').Vec3} */
    let feet;
    if (hit.normal[1] === 1) feet = point;
    else if (hit.normal[1] === -1) feet = [point[0], point[1] - PLAYER_HEIGHT - 0.05, point[2]];
    else
      feet = [
        point[0] + hit.normal[0] * (PLAYER_RADIUS + 0.05),
        point[1],
        point[2] + hit.normal[2] * (PLAYER_RADIUS + 0.05),
      ];
    const ground = voxels.raycast([feet[0], feet[1] + 0.05, feet[2]], [0, -1, 0], 20);
    if (ground && hit.normal[1] !== 1) feet[1] = feet[1] + 0.05 - ground.distance + 0.01;
    const { min, max } = playerBox(feet);
    return feet[1] >= 0 && !boxHitsWorld(voxels, min, max) ? feet : null;
  }

  // V: a kick at whoever is right in front of you. It knocks them back, and finishing someone off
  // with one is a Show-off.
  /** @param {number} now */
  kick(now) {
    const { me, avatars, gun, send, sound } = this.game;
    if (!me.alive || now - this.lastKick < KICK_COOLDOWN_MS) return;
    this.lastKick = now;
    const target = avatars.raycast(eyePosition(me.feet), this.game.look(), KICK_REACH + 0.4);
    send({ type: 'kick', hit: target?.id ?? null });
    gun.swing();
    sound.kick(null, Boolean(target));
  }

  // Someone else's shot, as the server passes it on: { id, weapon, from, to }.
  /** @param {{id: number, weapon?: string, from: import('./contracts.d.ts').Vec3, to: import('./contracts.d.ts').Vec3}} shot */
  show({ id, weapon = 'rifle', from, to }) {
    const { avatars, effects, sound } = this.game;
    const spec = WEAPONS[weapon];
    const start = avatars.muzzle(id) ?? from;
    if (spec?.kind === 'beam') effects.beam(start, to);
    else if (spec?.kind === 'rail') effects.rail(start, to, this.game.colorOf(id));
    else if (spec?.kind === 'pellets') {
      if (spec.cone === undefined) throw new Error('Pellet weapon requires a cone');
      const cone = spec.cone;
      const offset = mapVector(to, (v, i) => v - from[i]);
      const length = Math.hypot(...offset) || 1;
      const dir = mapVector(offset, (v) => v / length);
      effects.pellets(
        start,
        Array.from({ length: 8 }, () => along(from, scatter(dir, cone), length)),
      );
    } else effects.tracer(start, to, false);
    sound.play(spec?.sound ?? 'sounds/shot', from);
  }
}
