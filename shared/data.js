// The game's data: every block in data/ (the maps, their pieces and prefabs, the materials, the
// weapons, the rules, the tuning), as the engine plays by it. The data as this build was made is
// bundled in; a revision's data is read at run time (on zirbel, from the revision a room plays:
// readData()), checked, and then used from the next round on (useData()), the same on every screen,
// because the room's authority hands its data to every page that has other data (see zirbel/room.js).
//
// Modules that work something out from the data do it in onData(fn): fn runs at once, and again
// whenever the data changes. Read the data in force from DATA, or from the module that works it out.

import characters from '../data/characters.json' with { type: 'json' };
import hud from '../data/hud.json' with { type: 'json' };
import layouts from '../data/layouts.json' with { type: 'json' };
import loot from '../data/loot.json' with { type: 'json' };
import materials from '../data/materials.json' with { type: 'json' };
import movement from '../data/movement.json' with { type: 'json' };
import pieces from '../data/pieces.json' with { type: 'json' };
import prefabs from '../data/prefabs.json' with { type: 'json' };
import projectiles from '../data/projectiles.json' with { type: 'json' };
import radar from '../data/radar.json' with { type: 'json' };
import rules from '../data/rules.json' with { type: 'json' };
import sky from '../data/sky.json' with { type: 'json' };
import weapons from '../data/weapons.json' with { type: 'json' };
import { checkData, isGameData } from './check.js';

// The blocks, by id: each is data/<id>.json, checked against data/<id>.schema.json.
/** @type {(keyof import('./contracts.ts').GameData)[]} */
export const BLOCKS = [
  'rules',
  'movement',
  'characters',
  'weapons',
  'projectiles',
  'loot',
  'materials',
  'pieces',
  'prefabs',
  'layouts',
  'radar',
  'hud',
  'sky',
];
export const BUNDLED = requiredData({
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
});

export let DATA = BUNDLED;
export let HASH = hashOf(BUNDLED);
export let REVISION = ''; // the revision the data in force came from: '' for the data bundled in

/** @type {((data: import('./contracts.ts').GameData) => void)[]} */
const listeners = [];

// fn(data) works something out from the data: now, and whenever it changes.
/** @param {(data: import('./contracts.ts').GameData) => void} fn */
export function onData(fn) {
  listeners.push(fn);
  fn(DATA);
}

// Makes data the data in force, everywhere. Checked data only (readData). Returns whether it changed.
/** @param {unknown} input @param {{hash?: string, revision?: string}} options */
export function useData(input, { hash = hashOf(input), revision = '' } = {}) {
  if (hash === HASH) {
    REVISION = revision;
    return false;
  }
  const data = requiredData(input);
  REVISION = revision;
  DATA = data;
  HASH = hash;
  for (const fn of listeners) fn(data);
  return true;
}

// A short fingerprint of a set of blocks: the same data gives the same one on every screen.
/** @param {unknown} data */
export function hashOf(data) {
  if (typeof data !== 'object' || data === null) throw new TypeError('Data blocks must be an object');
  const blocks = Object.fromEntries(Object.entries(data));
  const text = JSON.stringify(BLOCKS.map((id) => blocks[id] ?? null));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + text.length.toString(16);
}

// Reads every block with read(id) (it returns the parsed JSON of data/<id>.json, or a promise of it),
// and checks them. Returns { data, hash, problems }: use the data only when problems is empty.
/** @param {(id: keyof import('./contracts.ts').GameData) => unknown | Promise<unknown>} read */
export async function readData(read) {
  /** @type {Record<string, unknown>} */
  const data = {};
  /** @type {import('./check.js').DataProblem[]} */
  const problems = [];
  for (const id of BLOCKS) {
    try {
      data[id] = await read(id);
    } catch (error) {
      problems.push({
        block: id,
        path: '/',
        message: `couldn't be read: ${error instanceof Error ? error.message : error}`,
      });
    }
  }
  if (!problems.length) problems.push(...checkData(data));
  return { data, hash: hashOf(data), problems };
}

/** @param {unknown} data @returns {import('./contracts.ts').GameData} */
function requiredData(data) {
  if (!isGameData(data)) throw new TypeError('Cannot activate invalid game data');
  return data;
}
