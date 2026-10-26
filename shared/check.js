// Checks a set of blocks before the engine plays by them: each against its schema (data/*.schema.json),
// every id one block names in another (a material, a piece, a prefab, a weapon, a projectile), and
// what the engine itself needs (its special materials, a weapon to spawn with, layouts it can lay).
// Fast enough to run whenever data is loaded. Deeper checks (spawns with floor under them, what's
// out of reach, budgets) are in src/agent/check.ts, for the platform's agents.

import characters from '../data/characters.schema.json' with { type: 'json' };
import geometry from '../data/geometry.schema.json' with { type: 'json' };
import hud from '../data/hud.schema.json' with { type: 'json' };
import layouts from '../data/layouts.schema.json' with { type: 'json' };
import loot from '../data/loot.schema.json' with { type: 'json' };
import materials from '../data/materials.schema.json' with { type: 'json' };
import movement from '../data/movement.schema.json' with { type: 'json' };
import pieces from '../data/pieces.schema.json' with { type: 'json' };
import prefabs from '../data/prefabs.schema.json' with { type: 'json' };
import projectiles from '../data/projectiles.schema.json' with { type: 'json' };
import radar from '../data/radar.schema.json' with { type: 'json' };
import rules from '../data/rules.schema.json' with { type: 'json' };
import sky from '../data/sky.schema.json' with { type: 'json' };
import weapons from '../data/weapons.schema.json' with { type: 'json' };
import { MOST_BOXES, expand } from './layout.js';
import { validate } from './schema.js';

/** @type {Record<string, import('./schema.js').Schema>} */
export const SCHEMAS = {
  rules,
  movement,
  characters,
  weapons,
  projectiles,
  loot,
  materials,
  pieces,
  prefabs,
  layouts,
  radar,
  hud,
  sky,
};
/** @type {Record<string, import('./schema.js').Schema>} */
const FILES = Object.fromEntries(
  [
    ...Object.entries(SCHEMAS),
    /** @type {[string, import('./schema.js').Schema]} */ (['geometry', geometry]),
  ].map(([id, schema]) => [`${id}.schema.json`, schema]),
);
// Where each block keeps the ids other blocks name (zirbel.build.json says the same, as JSON Pointers).
/** @type {Record<string, string>} */
export const IDS = {
  materials: 'materials',
  pieces: 'pieces',
  prefabs: 'prefabs',
  layouts: 'layouts',
  weapons: 'weapons',
  projectiles: 'projectiles',
};
// Materials the engine builds with itself: the pillars and their beam, the jump pads, the flag pads.
export const NEEDED = ['pillar', 'jump-pad', 'red-pad', 'blue-pad'];

// The last of each block checked against its schema, by its JSON, so a block checked again unchanged
// (in the next proposal, or the next room) isn't checked twice: block id → { text, problems, refs }.
/** @typedef {{block: string, path: string, message: string}} DataProblem  @typedef {import('./schema.js').Reference & {from: string}} DataReference  @type {Map<string, {text: string, problems: import('./schema.js').Problem[], refs: import('./schema.js').Reference[]}>} */
const VALIDATED = new Map();

// problems: [{ block, path, message }], empty when the data is fine.
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @param {unknown} data @returns {DataProblem[]} */
export function checkData(data) {
  /** @type {DataProblem[]} */
  const problems = [];
  /** @type {DataReference[]} */
  const refs = [];
  if (!checkedSchemas(data, problems, refs)) return problems;
  const lists = {
    materials: data.materials.materials,
    pieces: data.pieces.pieces,
    prefabs: data.prefabs.prefabs,
    layouts: data.layouts.layouts,
    weapons: data.weapons.weapons,
    projectiles: data.projectiles.projectiles,
  };
  const known = Object.fromEntries(
    Object.entries(lists).map(([block, items]) => [block, new Set(items.map((item) => item.id))]),
  );
  for (const [block, items] of Object.entries(lists)) {
    const list = IDS[block];
    const seen = new Set();
    items.forEach((item, i) => {
      if (seen.has(item.id))
        problems.push({ block, path: `/${list}/${i}/id`, message: `${item.id} is there twice` });
      seen.add(item.id);
    });
  }
  for (const { from, path, block, value } of refs) {
    if (!known[block]?.has(value))
      problems.push({ block: from, path, message: `names ${value}, which isn't one of the ${block}` });
  }
  if (problems.length) return problems;
  return [...needs(data, known), ...laid(data)];
}

// What the engine needs of the data to play.
/** @param {import('./contracts.ts').GameData} data @param {Record<string, Set<string>>} known */
function needs(data, known) {
  /** @type {DataProblem[]} */
  const problems = [];
  /** @param {string} block @param {string} path @param {string} message */
  const fail = (block, path, message) => problems.push({ block, path, message });
  for (const id of NEEDED)
    if (!known['materials']?.has(id))
      fail('materials', '/materials', `needs ${id}: the engine builds with it`);
  /** @param {string} piece @param {string} type */
  const component = (piece, type) =>
    data.pieces.pieces.find((p) => p.id === piece)?.components?.find((c) => c.type === type);
  data.pieces.pieces.forEach((piece, i) => {
    const pickup = piece.components?.find((c) => c.type === 'pickup');
    if (pickup?.gives === 'weapon' && !pickup.weapon)
      fail('pieces', `/pieces/${i}/components`, 'a weapon pickup must say which weapon');
    if (pickup && pickup.gives !== 'weapon' && !(pickup.amount && pickup.cap))
      fail(
        'pieces',
        `/pieces/${i}/components`,
        'a health or armor pickup must say how much (amount) and up to what (cap)',
      );
  });
  // A special from a crate that's thrown or fired flies as the projectile of its name; an air
  // strike's missiles are the missile.
  /** @type {Record<string, string>} */
  const flies = { splitter: 'splitter', choir: 'choir', pilot: 'pilot', airstrike: 'missile' };
  data.loot.crates.items.forEach((item, i) => {
    const projectile = flies[item.id];
    if (projectile && !known['projectiles']?.has(projectile))
      fail(
        'loot',
        `/crates/items/${i}`,
        `${item.id} flies as the projectile ${projectile}, which isn't one of the projectiles`,
      );
  });
  const slots = new Set();
  data.weapons.weapons.forEach((weapon, i) => {
    if (slots.has(weapon.slot)) fail('weapons', `/weapons/${i}/slot`, `slot ${weapon.slot} is taken`);
    slots.add(weapon.slot);
    if (weapon.kind === 'pellets' && !(weapon.pellets && weapon.cone))
      fail('weapons', `/weapons/${i}`, 'pellets need pellets and cone');
    if (weapon.kind === 'launcher' && !weapon.projectile)
      fail('weapons', `/weapons/${i}`, 'a launcher needs a projectile');
    if (['bullet', 'pellets', 'beam', 'rail'].includes(weapon.kind) && !(weapon.damage && weapon.range))
      fail('weapons', `/weapons/${i}`, `a ${weapon.kind} weapon needs damage and range`);
  });
  data.layouts.layouts.forEach((layout, i) => {
    const where = `/layouts/${i}`;
    layout.pickups?.forEach((spot, k) => {
      if (!component(spot.piece, 'pickup'))
        fail('layouts', `${where}/pickups/${k}/piece`, `${spot.piece} isn't a pickup`);
    });
    layout.pads?.forEach((spot, k) => {
      if (!component(spot.piece ?? 'jump-pad', 'jumpPad'))
        fail('layouts', `${where}/pads/${k}/piece`, `${spot.piece ?? 'jump-pad'} isn't a jump pad`);
    });
    if (data.rules.modes.includes('ctf') && !layout.zones?.flags)
      fail('layouts', `${where}/zones`, 'capture the flag needs the flags on every layout');
    if (!data.materials.materials.find((m) => m.id === layout.floor)?.floor)
      fail('layouts', `${where}/floor`, `${layout.floor} isn't a floor material`);
  });
  return problems;
}

// Every layout lays: no prefab inside itself, not too many boxes.
/** @param {import('./contracts.ts').GameData} data */
function laid(data) {
  /** @type {DataProblem[]} */
  const problems = [];
  const lib = {
    pieces: new Map(data.pieces.pieces.map((p) => [p.id, p])),
    prefabs: new Map(data.prefabs.prefabs.map((p) => [p.id, p])),
  };
  data.layouts.layouts.forEach((layout, i) => {
    try {
      const map = expand(layout, lib, () => [0, 0, 0]);
      if (map.boxes.length > MOST_BOXES)
        problems.push({
          block: 'layouts',
          path: `/layouts/${i}/parts`,
          message: `comes to more than ${MOST_BOXES} boxes`,
        });
    } catch (error) {
      problems.push({
        block: 'layouts',
        path: `/layouts/${i}/parts`,
        message: String(error instanceof Error ? error.message : error),
      });
    }
  });
  return problems;
}

/**
 * The schema check is the runtime proof for the static data contract. Semantic checks run only
 * after every block has passed its own schema, including all required fields and union tags.
 * @param {unknown} data @param {DataProblem[]} problems @param {DataReference[]} refs
 * @returns {data is import('./contracts.ts').GameData}
 */
function checkedSchemas(data, problems, refs) {
  if (!record(data)) {
    problems.push({ block: '', path: '/', message: 'should be an object' });
    return false;
  }
  for (const [id, schema] of Object.entries(SCHEMAS)) {
    if (data[id] === undefined) {
      problems.push({ block: id, path: '/', message: 'is missing' });
      continue;
    }
    const text = JSON.stringify(data[id]);
    let result = VALIDATED.get(id);
    if (result?.text !== text) {
      result = { text, ...validate(schema, data[id], { schemas: FILES }) };
      VALIDATED.set(id, result);
    }
    for (const p of result.problems) problems.push({ block: id, ...p });
    for (const r of result.refs) refs.push({ from: id, ...r });
  }
  return problems.length === 0;
}

/** @param {unknown} data @returns {data is import('./contracts.ts').GameData} */
export function isGameData(data) {
  return checkData(data).length === 0;
}
