// What you hold when you put your weapon away (F): three juggling balls, to show off with while you
// run, faster than with a gun in your hands, and everyone sees you juggle. Press F again (or the
// right button) for the next trick. The action button throws one of the balls at someone. The browser draws it all (public/js/tricks.js for yours, public/js/avatars.js
// for everyone else's). The numbers are in data/weapons.json (juggling).

import { onData } from './data.js';

/** @type {number} */
export let TRICK_SPEED; // how much faster you run with it out
/** @type {string[]} */
export let MOVES; // the juggling tricks: F goes from one to the next
/** @type {{projectile: string, cooldownMs: number}} */
export let THROW; // { projectile, cooldownMs }: a ball thrown (data/projectiles.json), at most this often

onData(({ weapons }) => {
  const juggling = weapons.juggling ?? { speed: 1, tricks: ['Cascade'], projectile: 'ball', cooldownMs: 450 };
  TRICK_SPEED = juggling.speed;
  MOVES = juggling.tricks;
  THROW = { projectile: juggling.projectile, cooldownMs: juggling.cooldownMs };
});
