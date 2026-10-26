import { indexed } from './indexed.js';
import { mapVector } from './vector.js';
// The planets round the arena, out in the universe it floats in (data/sky.json): four low round it,
// seen between the pillars, and one high above it, seen through the skylights. They're infinitely far
// away, so all that matters is which way each is (dir, made a unit vector) and how big it looks
// (size, its angular radius in radians). Shoot one, with a bullet or a rail that gets out of the
// arena and goes straight at it, and it blows up, and its pieces streak in and chip bits off the side
// of the arena facing it (server/planets.js): a show, which hurts nobody. A new round brings them all
// back. The browser draws them (public/js/world.js).

import { onData } from './data.js';

/** @param {import('./contracts.ts').Vector3} v */
const unit = (v) => {
  const length = Math.hypot(...v) || 1;
  return mapVector(v, (c) => c / length);
};

/** @type {import('./contracts.ts').Sky['planets']} */
export let PLANETS; // [{ name, dir, size, look }]
/** @type {{strikes: number, radius: [number, number], arrive: [number, number]}} */
export let DEBRIS; // a planet's pieces: how many strike, how big a bit each chips off (m), and how long after (ms)

onData(({ sky }) => {
  PLANETS = sky.planets.map((planet) => ({ ...planet, dir: unit(planet.dir) }));
  DEBRIS = { strikes: sky.debris.strikes, radius: sky.debris.radius, arrive: sky.debris.arriveMs };
});

// The planet (its index) that a shot heading along dir goes straight at, if any, among those not
// yet blown up (gone: a set of indices).
/** @param {import('./contracts.ts').Vector3} dir @param {Set<number>} gone */
export function planetAt(dir, gone = new Set()) {
  return PLANETS.findIndex(
    (planet, i) =>
      !gone.has(i) &&
      Math.acos(
        Math.min(
          1,
          dir.reduce((sum, v, a) => sum + v * indexed(planet.dir, a), 0),
        ),
      ) < planet.size,
  );
}
