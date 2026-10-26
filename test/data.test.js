// The game's data (data/*.json): every block passes its schema and the game's own checks
// (src/agent/check.ts), which refuse what would break the game, saying where and why; the schemas
// say what every field is and keep every number in bounds; the asset catalogue covers every asset a
// block names. And the engine's side of the data (on the tests' own copy of it, test/fixtures/data/):
// the layouts build exactly the arenas the maps were built as, new data takes over everywhere, and
// data is read and checked block by block.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { FIXTURE } from './fixtures/data.js'; // the data the tests play by
import check from '../src/agent/check.ts';
import { BLOCKS, BUNDLED, HASH, REVISION, hashOf, readData, useData } from '../shared/data.js';
import { SCHEMAS, checkData } from '../shared/check.js';
import { MAPS, MAP, buildCells } from '../shared/map.js';
import { M } from '../shared/materials.js';
import { WEAPONS } from '../shared/weapons.js';

const ROOT = new URL('..', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const fnv = (bytes) => {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

test('every block passes its schema, and names only what is there', () => {
  assert.deepEqual(checkData(BUNDLED), []);
  assert.deepEqual(Object.keys(SCHEMAS).sort(), [...BLOCKS].sort());
});

test("the game's own checks find nothing wrong with its data, and count what the budgets limit", () => {
  const { problems, counts } = check(BUNDLED);
  assert.deepEqual(problems, []);
  for (const name of ['boxes', 'pieces', 'cells', 'triangles']) assert.ok(counts[name] > 0, name);
});

test("the game's own checks refuse what would break it, saying where and why", () => {
  const bad = structuredClone(FIXTURE);
  const depot = bad.layouts.layouts[0];
  const part = depot.parts.push(
    { type: 'block', at: [0.25, 0, 25], size: [1, 1, 1], m: 'crate' }, // between grid lines
    { type: 'block', at: [0, 8, -10], size: [2, 1, 2], m: 'crate' }, // in mid-air
    { type: 'block', at: [-15, 0, 25], size: [1, 3, 4], m: 'brick' }, // a wall…
  );
  const pad = depot.pads.push({ at: [-20, 0, 25], to: [-10, 0, 25] }) - 1; // …a jump pad throws you into
  const spawn = depot.spawns.push({ at: [-15, 0, 25] }) - 1; // and a spawn inside it
  depot.zones.flags.red = [5, 0, 25]; // on Blue's half
  const { problems } = check(bad);
  const said = (path, pattern) =>
    assert.ok(
      problems.some((p) => p.block === 'layouts' && p.path === path && pattern.test(p.message)),
      `${path}: ${pattern} in ${JSON.stringify(problems, null, 1)}`,
    );
  said(
    `/layouts/0/parts/${part - 3}`,
    /^depot: a box off the half-metre grid .*: \[-0\.25, 0, 24\.5\] … \[0\.75, 1, 25\.5\]/,
  );
  said('/layouts/0/parts', /cells float, held up by nothing \(round \[/);
  said(`/layouts/0/pads/${pad}`, /throws you into something at \[.*\], on the way to \[-10, 0, 25\]/);
  said(`/layouts/0/spawns/${spawn}`, /the spawn at \[-15, 0, 25\] is inside something/);
  said('/layouts/0/zones/flags/red', /must be on its team's half: the west/);
  // A box with a corner off the grid by a hair doesn't get as far: its schema refuses it.
  const hair = structuredClone(FIXTURE);
  const at =
    hair.layouts.layouts[0].parts.push({
      type: 'box',
      min: [-36, -0.4999, 8.5],
      max: [36, 0.0001, 11.5],
      m: 'asphalt',
    }) - 1;
  assert.deepEqual(
    check(hair).problems.map((p) => `${p.path} ${p.message}`),
    [
      `/layouts/0/parts/${at}/min/1 should be a multiple of 0.5`,
      `/layouts/0/parts/${at}/max/1 should be a multiple of 0.5`,
    ],
  );
});

test('bad data is caught, with where and why', () => {
  const bad = structuredClone(FIXTURE);
  bad.weapons.weapons[0].damage = 5000;
  bad.layouts.layouts[0].parts[0].mirror = 'diagonal';
  const problems = checkData(bad);
  assert.ok(
    problems.some(
      (p) => p.block === 'weapons' && p.path === '/weapons/0/damage' && /at most/.test(p.message),
    ),
    JSON.stringify(problems),
  );
  assert.ok(
    problems.some((p) => p.block === 'layouts' && p.path === '/layouts/0/parts/0/mirror'),
    JSON.stringify(problems),
  );
  const missing = structuredClone(FIXTURE);
  missing.layouts.layouts[1].parts.push({ type: 'prefab', id: 'castle', at: [0, 0, 0] });
  missing.pieces.pieces = missing.pieces.pieces.filter((piece) => piece.id !== 'orb');
  assert.deepEqual(
    checkData(missing)
      .map((p) => `${p.block}${p.path} ${p.message}`)
      .sort(),
    [
      "layouts/layouts/0/pickups/0/piece names orb, which isn't one of the pieces",
      "layouts/layouts/1/parts/12/id names castle, which isn't one of the prefabs",
      "layouts/layouts/1/pickups/0/piece names orb, which isn't one of the pieces",
      "layouts/layouts/2/pickups/0/piece names orb, which isn't one of the pieces",
    ],
  );
});

test('the schemas use only what a zirbel host checks, say what every field is, and bound every number', () => {
  const KNOWN = new Set([
    'type',
    'enum',
    'const',
    'properties',
    'required',
    'additionalProperties',
    'patternProperties',
    'propertyNames',
    'items',
    'prefixItems',
    'minItems',
    'maxItems',
    'uniqueItems',
    'contains',
    'minContains',
    'maxContains',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'pattern',
    'minProperties',
    'maxProperties',
    'allOf',
    'anyOf',
    'oneOf',
    'not',
    'if',
    'then',
    'else',
    'dependentRequired',
    '$ref',
    '$defs',
    '$id',
    '$schema',
    '$comment',
    'title',
    'description',
    'default',
    'examples',
    'deprecated',
    'readOnly',
    'format',
    'x-zirbel-ref',
  ]);
  for (const file of readdirSync(new URL('data/', ROOT)).filter((name) => name.endsWith('.schema.json'))) {
    const walk = (schema, path) => {
      if (typeof schema !== 'object' || schema === null) return;
      for (const key of Object.keys(schema))
        assert.ok(KNOWN.has(key), `${file}${path}: ${key} isn't a keyword a host checks`);
      for (const [name, sub] of Object.entries(schema.properties ?? {})) {
        assert.ok(sub.description || sub.$ref, `${file}${path}/properties/${name} says what it is`);
        walk(sub, `${path}/properties/${name}`);
      }
      if (
        schema.type === 'number' ||
        schema.type === 'integer' ||
        (Array.isArray(schema.type) && schema.type.includes('integer'))
      ) {
        assert.ok(
          schema.minimum !== undefined && schema.maximum !== undefined,
          `${file}${path} has a minimum and a maximum`,
        );
      }
      for (const key of [
        'items',
        'additionalProperties',
        'propertyNames',
        'not',
        'if',
        'then',
        'else',
        'contains',
      ])
        if (typeof schema[key] === 'object') walk(schema[key], `${path}/${key}`);
      for (const key of ['prefixItems', 'allOf', 'anyOf', 'oneOf'])
        (schema[key] ?? []).forEach((sub, i) => walk(sub, `${path}/${key}/${i}`));
      for (const [name, sub] of Object.entries(schema.$defs ?? {})) walk(sub, `${path}/$defs/${name}`);
      for (const [name, sub] of Object.entries(schema.patternProperties ?? {}))
        walk(sub, `${path}/patternProperties/${name}`);
    };
    walk(read(`data/${file}`), '');
  }
});

test('every asset a schema offers is in the catalogue, and the catalogue says where each comes from', () => {
  const assets = read('assets/assets.json');
  const ids = new Set(assets.map((asset) => asset.id));
  assert.equal(ids.size, assets.length, 'no id twice');
  for (const asset of assets) {
    for (const field of ['id', 'file', 'kind', 'use', 'by', 'license', 'source'])
      assert.ok(asset[field], `${asset.id} has ${field}`);
    assert.ok(
      ['model', 'texture', 'sound', 'font', 'image'].includes(asset.kind),
      `${asset.id}: ${asset.kind}`,
    );
    assert.ok(Number.isInteger(asset.bytes), `${asset.id} says how big it is`);
  }
  const offered = [];
  const walk = (schema) => {
    if (typeof schema !== 'object' || schema === null) return;
    if (
      Array.isArray(schema.enum) &&
      schema.enum.some(
        (v) => typeof v === 'string' && /^(sounds|weapons|pickups|props|projectiles|sky)\//.test(v),
      )
    )
      offered.push(...schema.enum);
    for (const value of Object.values(schema)) walk(value);
  };
  for (const file of readdirSync(new URL('data/', ROOT)).filter((name) => name.endsWith('.schema.json')))
    walk(read(`data/${file}`));
  for (const id of offered) assert.ok(ids.has(id), `${id} is in assets/assets.json`);
});

// Each map's arena, cell by cell, as it was when the maps were code: the layouts build the same.
const ARENAS = {
  'depot dm': 'e252fa45',
  'depot ctf': 'c42d6e31',
  'canal dm': '4085bc35',
  'canal ctf': '8d8b0ff9',
  'fort dm': '3d62f837',
  'fort ctf': '9edc1213',
};

test('the layouts build the arenas the maps were built as, cell for cell', () => {
  for (const [key, sum] of Object.entries(ARENAS)) {
    const [id, mode] = key.split(' ');
    assert.equal(fnv(buildCells(MAPS[id], mode)), sum, key);
  }
  assert.deepEqual(
    Object.values(MAPS).map((map) => [map.id, map.spawns.length, map.items.length, map.pads.length]),
    [
      ['depot', 26, 20, 10],
      ['canal', 28, 19, 8],
      ['fort', 28, 20, 8],
    ],
  );
});

test('new data takes over everywhere: the maps, the materials and the weapons', () => {
  const next = structuredClone(FIXTURE);
  next.weapons.weapons[0].damage = 30;
  next.layouts.layouts.reverse();
  next.materials.materials.push({ id: 'marble', name: 'marble', color: '#f0f0f0', breakable: true, hits: 9 });
  assert.deepEqual(checkData(next), []);
  assert.equal(useData(next), true);
  try {
    assert.notEqual(HASH, hashOf(FIXTURE));
    assert.equal(WEAPONS.rifle.damage, 30);
    assert.deepEqual(Object.keys(MAPS), ['fort', 'canal', 'depot']);
    assert.ok(M.marble > 0);
    assert.equal(MAP.id, 'depot', 'the map in play stays, if it is still there');
  } finally {
    useData(FIXTURE);
  }
  assert.equal(WEAPONS.rifle.damage, 18);
});

test('data is read and checked block by block', async () => {
  const good = await readData((id) => FIXTURE[id]);
  assert.deepEqual([good.problems, good.hash], [[], HASH]);
  const bad = await readData((id) => (id === 'rules' ? Promise.reject(new Error('gone')) : FIXTURE[id]));
  assert.deepEqual(bad.problems, [{ block: 'rules', path: '/', message: "couldn't be read: gone" }]);
});

test('an identical data revision updates its label without rebuilding the data', () => {
  const previous = REVISION;
  try {
    assert.equal(useData(FIXTURE, { revision: 'same-data-new-revision' }), false);
    assert.equal(REVISION, 'same-data-new-revision');
  } finally {
    useData(FIXTURE, { revision: previous });
  }
});
