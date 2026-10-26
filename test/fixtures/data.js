// The data the engine's tests play by: a copy of data/*.json as it was when they were written, so a
// new revision of the game's data doesn't change what they test. What the data must be, whatever its
// revision, is in data/*.schema.json and src/agent/check.ts (and data.test.js checks the game's own
// data by them).

import { readFileSync } from 'node:fs';
import { BLOCKS, useData } from '../../shared/data.js';

export const FIXTURE = Object.fromEntries(BLOCKS.map((id) => [id, JSON.parse(readFileSync(new URL(`./data/${id}.json`, import.meta.url), 'utf8'))]));
useData(FIXTURE);
