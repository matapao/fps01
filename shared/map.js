import { lookup, indexed } from './indexed.js';
/** @typedef {import('./contracts.ts').Vector3} Vector3  @typedef {import('./layout-types.ts').GameMap} GameMap */
// The arena: a 72 × 72 m yard built from 0.5 m cells, floating in a starry universe over a
// bottomless void, under a roof held up by pillars round its edge: between them you see out into
// the stars, and you can fall off. Everything can be blown apart, the pillars, the roof and the
// floor too (server/roof.js: cut the pillars away and the roof comes down). x runs west to east,
// z north to south, y up; the floor is at y = 0 (its slab is one cell thick, just below it).
//
// What stands in it is one of the layouts in data/layouts.json (Depot, Canal and Fort), built of
// primitives, pieces and prefabs (shared/layout.js). Each has its roof at its own height (roof.at),
// with levels built up under it, jump pads up to them and pickups. A game is played on the map it was
// created with. useMap() makes a map the current one: the exports below that describe it (SPAWNS,
// ITEMS, JUMP_PADS, FLAG_BASES, POOL, PEDESTAL) are live bindings, so every module that imported
// them sees the new map's. The server runs several games at once, so each one makes its map the
// current one before it does anything (server/game.js).

import { buildArena } from './arena.js';
import { GRAVITY } from './constants.js';
import { onData } from './data.js';
import { expand } from './layout.js';
import { M } from './materials.js';

export { AIR, BREAKABLE, HITS, MATERIALS, PILLAR, RUBBLE, SLIPPERY } from './materials.js';

export {
  ARENA_HALF,
  BEAM,
  CELL,
  GRID_MIN,
  GRID_SIZE,
  JUMP_PAD_HALF,
  PILLARS,
  RIM,
  TOP,
  VOID_Y,
} from './arena.js';

// Capture the flag: Red holds the west end, Blue the east. Each flag stands on a pad that can't be
// blown up, so nobody can drop it into the void. Teams spawn on their own half.
/** @type {['red', 'blue']} */
export const TEAMS = ['red', 'blue'];
const TEAM_SIDE = { red: -1, blue: 1 }; // the sign of x on their half

/** @type {Record<string, GameMap>} */
export let MAPS; // id → the layout, expanded: what the game plays on
/** @type {string[]} */
export let MAP_ORDER; // in the order the menu shows them
/** @type {string} */
export let DEFAULT_MAP;

// The current map, and what's on it:
/** @type {GameMap} */
export let MAP;
/** @type {Vector3[]} */
export let SPAWNS = []; // where you can spawn, standing: [x, y, z], all in the open
/** @type {import('./layout-types.ts').Pickup[]} */
export let ITEMS = []; // pickups: { piece, kind ('health', 'armor' or 'weapon', with which), amount, cap, respawnMs, warnMs, name, color, asset, sound, at }
/** @type {GameMap['pads']} */
export let JUMP_PADS = []; // { at, to, launch }: step on one at `at` and it throws you onto `to`
/** @type {Partial<Record<import('./runtime-types.ts').Team, Vector3>>} */
export let FLAG_BASES = {}; // capture the flag: where each team's flag stands
/** @type {GameMap['pool']} */
export let POOL = null; // the water when it's full ({ min, max }), the basin it's in, and what it's called; null if there's none
/** @type {Vector3 | null} */
export let PEDESTAL = null; // where the powerups appear

onData((data) => {
  const pieces = new Map(data.pieces.pieces.map((piece) => [piece.id, piece]));
  const lib = { pieces, prefabs: new Map(data.prefabs.prefabs.map((prefab) => [prefab.id, prefab])) };
  MAPS = Object.fromEntries(
    data.layouts.layouts.map((layout) => [layout.id, build(expand(layout, lib, launch), pieces)]),
  );
  MAP_ORDER = Object.keys(MAPS);
  DEFAULT_MAP = indexed(MAP_ORDER, 0);
  useMap(MAP?.id);
});

// A layout as the engine plays it: materials by their place, pickups with what they give.
/** @param {import('./layout-types.ts').ExpandedLayout} map @param {import('./layout-types.ts').LayoutLibrary['pieces']} pieces @returns {GameMap} */
function build(map, pieces) {
  const items = map.items.map(({ piece: id, at }) => {
    const piece = pieces.get(id);
    if (!piece) throw new Error(`Missing pickup piece ${id}`);
    const pickup = piece.components?.find((c) => c.type === 'pickup');
    if (!pickup) throw new Error(`Piece ${id} has no pickup component`);
    return {
      piece: id,
      kind: pickup.gives,
      weapon: pickup.weapon,
      amount: pickup.amount,
      cap: pickup.cap,
      respawnMs: pickup.respawnMs,
      warnMs: pickup.warnMs ?? 0,
      name: piece.name,
      color: piece.color,
      asset: piece.asset,
      sound: piece.sound,
      at,
    };
  });
  const pads = map.pads.map((pad) => ({
    ...pad,
    launch: launch(
      pad.at,
      pad.to,
      pad.clear ?? pieces.get(pad.piece)?.components?.find((c) => c.type === 'jumpPad')?.clear,
    ),
  }));
  return {
    ...map,
    floor: lookup(M, map.floor),
    roof: { ...map.roof, m: lookup(M, map.roof.m) },
    boxes: map.boxes.map((box) => ({
      min: box.min,
      max: box.max,
      m: box.m === 'air' ? 0 : lookup(M, box.m),
    })),
    items,
    pads,
  };
}

// A jump pad's throw, from a spot on the floor (feet) onto another spot: up to `clear` metres above
// it, then down onto it.
/** @param {Vector3} at @param {Vector3} to @param {number} clear @returns {Vector3} */
function launch(at, to, clear = 1.5) {
  const peak = Math.max(to[1] - at[1], 0) + clear;
  const up = Math.sqrt(2 * GRAVITY * peak);
  const time = up / GRAVITY + Math.sqrt((2 * (peak - (to[1] - at[1]))) / GRAVITY);
  return [(to[0] - at[0]) / time, up, (to[2] - at[2]) / time];
}

// Makes a map the current one (the default map if there's no such map), and returns it.
/** @param {string | undefined} id */
export function useMap(id) {
  const map = lookup(MAPS, id && Object.hasOwn(MAPS, id) ? id : DEFAULT_MAP);
  MAP = map;
  SPAWNS = map.spawns;
  ITEMS = map.items;
  JUMP_PADS = map.pads;
  FLAG_BASES = map.flags;
  POOL = map.pool;
  PEDESTAL = map.pedestal;
  return map;
}

// How high a map's roof is (its underside).
/** @param {GameMap} map */
export const roofOf = (map = MAP) => map.roof.at;

// The spawn points a team uses: the ones well into its own half.
/** @param {import('./runtime-types.ts').Team} team */
export function teamSpawns(team) {
  return SPAWNS.filter(([x]) => Math.sign(x) === TEAM_SIDE[team] && Math.abs(x) >= 14);
}

// Whether a point is in the pool's water, with its surface at level (full, unless it's running out).
/** @param {Vector3} at @param {number} level */
export function inWater([x, y, z], level = POOL?.max[1] ?? 0) {
  if (!POOL) return false;
  const { min, max } = POOL;
  return (
    x > min[0] && x < max[0] && y > min[1] - 0.01 && y < Math.min(level, max[1]) && z > min[2] && z < max[2]
  );
}

// A map's arena as it stands before anyone shoots at it, for a game mode: material places, x
// fastest, then z, then y (shared/arena.js).
/** @param {GameMap} map @param {string} mode */
export function buildCells(map = MAP, mode = 'dm') {
  return buildArena(map, mode, (id) => lookup(M, id));
}
