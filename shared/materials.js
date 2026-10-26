// What the arena is built of, cell by cell (data/materials.json). A cell holds a material's place in
// the list, from 1; 0 is air. Bullets chip at breakable cells: hits is how many a cell takes before it
// breaks off. floor: a map's floor, which sudden death crumbles away. slippery: ground you slide on
// (spilt oil). ceiling: the colour of its underside. tiles: drawn in 1 m tiles. rubble: it falls in
// heaps when what's under it is blown away (gravel, hay).

import { onData } from './data.js';
import { lookup } from './indexed.js';

export const AIR = 0;
/** @type {(import('./contracts.ts').Materials['materials'][number] | null)[]} */
export let MATERIALS; // [null, …each material], by its place
/** @type {Record<string, number>} */
export let M; // each material's place, by its id: M.brick, M['roof-tiles'] …
/** @type {number} */
export let PILLAR; // the pillars round the edge, and the beam along their tops
/** @type {number[]} */
export let RUBBLE; // by place: what it lands as when it falls (itself), or 0: it just breaks
/** @type {boolean[]} */
export let SLIPPERY; // by place: whether you slide on it
/** @type {boolean[]} */
export let BREAKABLE; // by place: whether blasts and bullets break it
/** @type {number[]} */
export let HITS; // by place: bullet hits a cell of it takes before it breaks off

onData(({ materials }) => {
  MATERIALS = [null, ...materials.materials];
  M = Object.fromEntries(MATERIALS.flatMap((material, id) => (material ? [[material.id, id]] : [])));
  PILLAR = lookup(M, 'pillar');
  RUBBLE = MATERIALS.map((material, id) => (material?.rubble ? id : 0));
  SLIPPERY = MATERIALS.map((material) => Boolean(material?.slippery));
  BREAKABLE = MATERIALS.map((material) => Boolean(material?.breakable));
  HITS = MATERIALS.map((material) => (material?.breakable ? (material.hits ?? 1) : 0));
});
