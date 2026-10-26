import { mapVector } from './vector.js';
import { lookup } from './indexed.js';
/** @typedef {Omit<import('./contracts.ts').Weapons['weapons'][number], 'ammo'> & {ammo: number, headshot: number}} Weapon */
// The arsenal (data/weapons.json): each weapon fires in one of the ways the engine knows (its kind:
// bullet, pellets, launcher, beam, rail), with a second use on the right mouse button (its alt:
// zoom, slug, launch, overload, charge). You spawn with some, and the rest
// lie on pads around the map (pickups in data/layouts.json). Damage is per hit: per pellet, per
// tick of a beam. Things that fly are in data/projectiles.json.

import { MAX_RANGE } from './constants.js';
import { onData } from './data.js';
import { eyePosition } from './physics.js';
import { cellOf } from './voxels.js';

/** @type {Record<string, Weapon>} */
export let WEAPONS; // id → the weapon, with ammo Infinity for one that never runs out
/** @type {string[]} */
export let ARSENAL; // every weapon there is, in slot order
/** @type {string[]} */
export let SPAWN_WEAPONS; // what you start each life with, the first in your hands
/** @type {Record<string, import('./contracts.ts').Projectiles['projectiles'][number]>} */
export let PROJECTILES; // id → what flies: { speed, gravity, size, fuseMs, bounce?, split?, blast?, hit?, steer?, credit, model }

// Health and armor: armor takes a share of the damage; both can stack above what
// pickups give (a Health Orb) and then tick back down (data/characters.json, data/rules.json).
/** @type {number} */
export let MAX_ARMOR;
/** @type {number} */
export let OVERHEAL; // the most health you can have, with a Health Orb
/** @type {number} */
export let ARMOR_SHARE;

onData(({ weapons, projectiles, characters, rules }) => {
  WEAPONS = Object.fromEntries(
    weapons.weapons.map((w) => [w.id, { headshot: 1, ...w, ammo: w.ammo ?? Infinity }]),
  );
  ARSENAL = [...weapons.weapons].sort((a, b) => a.slot - b.slot).map((w) => w.id);
  SPAWN_WEAPONS = weapons.spawn;
  PROJECTILES = Object.fromEntries(projectiles.projectiles.map((p) => [p.id, p]));
  MAX_ARMOR = characters.armor.max;
  OVERHEAL = characters.health.overheal;
  ARMOR_SHARE = rules.damage.armorShare;
});

// How long a weapon (or its alt-fire) needs between shots, under what name the wait is kept, and
// how much ammo it uses. The server and the browser go by the same rules. An overload waits on its
// own; every other alt-fire shares its weapon's wait.
/** @param {string} name @param {boolean} alt */
export function costOf(name, alt) {
  const spec = weaponSpec(name);
  const second = alt ? spec.alt : null;
  if (second?.kind === 'slug') return { key: name, cooldown: second.cooldownMs, cost: 1 };
  if (second?.kind === 'launch')
    return { key: name, cooldown: second.cooldownMs ?? spec.cooldownMs, cost: second.cost ?? 1 };
  if (second?.kind === 'overload')
    return { key: `${name}:alt`, cooldown: second.cooldownMs, cost: second.cost };
  return { key: name, cooldown: spec.cooldownMs, cost: 1 };
}

// Whether a weapon's right button zooms it in (and how), or fires something.
/** @param {string} name */
export const zoomOf = (name) => (WEAPONS[name]?.alt?.kind === 'zoom' ? WEAPONS[name].alt : null);

// A downward shot at nearby ground becomes a pressure jump: no projectile, damage or carving.
// Check the first surface so a wall in front of the floor cannot be fired through.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} feet @param {import('./contracts.ts').Vector3} dir @param {{range: number, push: number} | undefined} pressure */
export function pressureJump(world, feet, dir, pressure) {
  if (!pressure || dir[1] > -0.55) return null;
  const origin = eyePosition(feet);
  const hit = world.raycast(origin, dir, pressure.range);
  if (!hit || hit.normal[1] !== 1) return null;
  const at = mapVector(origin, (value, i) => value + dir[i] * hit.distance);
  if (at[1] > feet[1] + 0.1) return null;
  return { at, velocity: mapVector(dir, (value) => -value * pressure.push) };
}

// How far a railgun shot goes along a ray, and the cells it breaks on the way: none, unless it is
// charged, when it punches through up to `pierce` metres of wall and carries on to the next one.
// The browser uses this to see who it hit, and the server to check it.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} origin @param {import('./contracts.ts').Vector3} dir @param {boolean} charged @param {number} pierce */
export function railReach(world, origin, dir, charged, pierce = 1) {
  const first = world.raycast(origin, dir, MAX_RANGE);
  if (!first) return { reach: MAX_RANGE, through: [] };
  if (!charged || pierce <= 0) return { reach: first.distance, through: [] };
  /** @type {import('./contracts.ts').Vector3[]} */
  const through = [];
  const steps = Math.round(pierce / 0.1) + 1; // 10 cm at a time, a little past the metre
  for (let step = 0; step <= steps; step++) {
    const distance = first.distance + 0.05 + step * 0.1;
    const point = mapVector(origin, (value, i) => value + dir[i] * distance);
    /** @type {import('./contracts.ts').Vector3} */
    const cell = [cellOf(point[0], 0), cellOf(point[1], 1), cellOf(point[2], 2)];
    if (world.get(...cell) === 0) {
      const beyond = world.raycast(point, dir, MAX_RANGE);
      return { reach: distance + (beyond?.distance ?? MAX_RANGE), through };
    }
    if (!through.some((other) => other.every((v, i) => v === cell[i]))) through.push(cell);
  }
  return { reach: first.distance + pierce, through };
}

/** @param {string} name @returns {Weapon} */
export function weaponSpec(name) {
  return lookup(WEAPONS, name);
}
