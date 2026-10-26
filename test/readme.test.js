// The README stays short: what the game is, how to run, build and test it, its licence and credits.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const MOST_LINES = 50;

test(`the README is at most ${MOST_LINES} lines`, () => {
  const lines = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    .replace(/\n$/, '')
    .split('\n').length;
  assert.ok(lines <= MOST_LINES, `README.md has ${lines} lines`);
});
