// Loot: powerups that appear on a pedestal in the middle of the map (on the
// Depot's platform, on the bridge over the canal, on the altar of the Fort's chapel), and crates that
// drift down on parachutes with health inside, or something special. The numbers are in data/loot.json.

import { onData } from './data.js';

export { PEDESTAL } from './map.js'; // where it is on the map being played
/** @type {number} */
export let POWERUP_FIRST_MS; // after a round starts
/** @type {number} */
export let POWERUP_EVERY_MS; // after someone takes the last one
/** @type {number} */
export let POWERUP_WARNING_MS; // everyone sees it coming this long before
/** @type {number} */
export let POWERUP_MS; // how long one lasts
/** @type {number} */
export let DROPPED_POWERUP_MS; // one dropped by its dead carrier lies there this long

// The powerups, by id: { name, color, … } (triple: damage; rush: speed; mend: perSecond, cap; guard: share).
/** @type {Record<string, import('./contracts.ts').Loot['powerups']['kinds'][number]>} */
export let POWERUPS;
/** @type {string[]} */
export let POWERUP_ORDER;

// Crates: one drifts down out of the sky every so often, somewhere open.
/** @type {number | [number, number]} */
export let CRATE_EVERY_MS; // [shortest, longest]
/** @type {number} */
export let CRATE_FIRST_MS; // after a round starts
/** @type {number} */
export let CRATE_FALL_SPEED; // m/s, under its parachute
/** @type {number} */
export let CRATE_MS; // an untouched crate goes after this long
/** @type {number} */
export let CRATE_REACH;
/** @type {number} */
export let CRATE_DROP_HEIGHT; // a crate starts this far above where it lands

// What can be in a crate, by id, with how likely each is. All but the health crate are specials:
// one use, on key 7.
/** @type {Record<string, import('./contracts.ts').Loot['crates']['items'][number]>} */
export let CRATE_ITEMS;
/** @type {string[]} */
export let SPECIALS;

/** @type {import('./contracts.ts').Loot['woolly'] | null} */
export let WOOLLY; // { speed, hop, ms, blast }
/** @type {import('./contracts.ts').Loot['airstrike'] | null} */
export let AIRSTRIKE; // { missiles, spacing }
/** @type {number} */
export let PILOT_TURN; // how fast you can steer it, in radians a second
/** @type {number} */
export let TELEPORT_RANGE;

onData(({ loot }) => {
  const p = loot.powerups;
  POWERUP_FIRST_MS = p?.firstMs ?? Infinity;
  POWERUP_EVERY_MS = p?.everyMs ?? Infinity;
  POWERUP_WARNING_MS = p?.warningMs ?? 0;
  POWERUP_MS = p?.lastsMs ?? 0;
  DROPPED_POWERUP_MS = p?.droppedMs ?? 0;
  POWERUPS = Object.fromEntries((p?.kinds ?? []).map((kind) => [kind.id, kind]));
  POWERUP_ORDER = Object.keys(POWERUPS);
  const c = loot.crates;
  CRATE_EVERY_MS = c.everyMs;
  CRATE_FIRST_MS = c.firstMs;
  CRATE_FALL_SPEED = c.fallSpeed;
  CRATE_MS = c.lastsMs;
  CRATE_REACH = c.reach;
  CRATE_DROP_HEIGHT = c.dropHeight;
  CRATE_ITEMS = Object.fromEntries(c.items.map((item) => [item.id, item]));
  SPECIALS = Object.keys(CRATE_ITEMS).filter((kind) => kind !== 'health');
  WOOLLY = loot.woolly ?? null;
  AIRSTRIKE = loot.airstrike ?? null;
  PILOT_TURN = loot.pilot?.turn ?? 0;
  TELEPORT_RANGE = loot.teleport?.range ?? 0;
});
