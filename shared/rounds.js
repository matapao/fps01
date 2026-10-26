// The round's rhythm: rounds have a time limit (data/rules.json), and a tie at the end means sudden
// death: the floor crumbles away, and the next kill (or capture) wins.

import { onData } from './data.js';

/** @type {Record<import('./runtime-types.ts').Mode, number>} */
export let TIME_LIMIT_MS; // by mode: { dm, ctf }
/** @type {number} */
export let CRUMBLE_PER_SECOND; // floor cells sudden death crumbles away each second

onData(({ rules }) => {
  TIME_LIMIT_MS = {
    dm: rules.deathmatch.timeLimitMs,
    ctf: rules.ctf?.timeLimitMs ?? rules.deathmatch.timeLimitMs,
  };
  CRUMBLE_PER_SECOND = rules.round.crumblePerSecond;
});
