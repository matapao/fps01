import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DATA, HASH, REVISION, useData } from '../shared/data.js';
import { indexed, lookup } from '../shared/indexed.js';
import { applySnapshotPart, isSnapshot } from '../shared/snapshot-parts.js';
import type { Snapshot } from '../shared/runtime-types.ts';

function snapshot(): Snapshot {
  return {
    type: 'snapshot',
    players: [],
    projectiles: [],
    round: {
      mode: 'dm',
      map: 'depot',
      over: false,
      captures: { red: 0, blue: 0 },
      ms: 1000,
      sudden: false,
    },
  };
}

test('invalid game data cannot partially change the active revision', () => {
  const before = { data: DATA, hash: HASH, revision: REVISION };
  assert.throws(
    () => useData({}, { hash: 'invalid-data', revision: 'invalid-revision' }),
    /invalid game data/,
  );
  assert.equal(DATA, before.data);
  assert.equal(HASH, before.hash);
  assert.equal(REVISION, before.revision);
});

test('snapshot parts reject malformed wire data before mutating the snapshot', () => {
  const state = snapshot();
  const original = structuredClone(state);
  for (const [part, value] of [
    ['round', { ...state.round, mode: 'unknown' }],
    ['water', Infinity],
    ['items', [0, 'soon']],
    ['powerups', { pedestal: null, soon: { kind: 'rush', ms: 'later' }, loose: [] }],
    ['crates', [[1, 'unknown', 0, 1, 2, 0]]],
    ['woollies', [[1, 0, 0]]],
  ] as const) {
    assert.throws(() => applySnapshotPart(state, part, value), /Invalid snapshot part/);
    assert.deepEqual(state, original);
  }
  applySnapshotPart(state, 'items', [0, 5]);
  assert.deepEqual(state.items, [0, 5]);
  assert.ok(isSnapshot(state));
  assert.equal(isSnapshot({ ...state, players: [{ id: 1 }] }), false);
});

test('required entries reject a broken bounds or identifier invariant instead of inventing a value', () => {
  assert.equal(indexed(new Uint8Array([7, 12]), 1), 12);
  assert.equal(lookup({ red: 2 }, 'red'), 2);
  assert.throws(() => indexed([7], 1), RangeError);
  assert.throws(() => indexed([7], -1), RangeError);
  assert.throws(() => lookup({ red: 2 }, 'blue'), /Missing validated reference/);
});

test('host flag states are checked without invoking untrusted string conversion', () => {
  const state = snapshot();
  const malformed = {
    ...state.round,
    flags: { red: { state: { toString: null }, at: null } },
  };
  assert.equal(isSnapshot({ ...state, round: malformed }), false);
  assert.throws(() => applySnapshotPart(state, 'round', malformed), /Invalid snapshot part round/);
  assert.ok(isSnapshot(state));
  applySnapshotPart(state, 'round', { ...state.round, flags: { red: { state: 'home', at: [0, 0, 0] } } });
  assert.ok(isSnapshot(state));
  assert.deepEqual(state.round?.flags?.red, { state: 'home', at: [0, 0, 0] });
});
