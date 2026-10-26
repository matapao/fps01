// The planets round the arena (server/planets.js): shoot one and it blows up, and its pieces chip
// bits off the side of the arena facing it, hurting nobody. On a fake clock, with players on
// stand-in connections.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { Game } from '../server/game.js';
import { GRID_SIZE, MAPS } from '../shared/map.js';
import { DEBRIS, PLANETS, planetAt } from '../shared/planets.js';
import { WEAPONS } from '../shared/weapons.js';

const [NX, , NZ] = GRID_SIZE;

function setup(map) {
  const clock = { now: 1_000_000 };
  const game = new Game({ protectionMs: 0, now: () => clock.now, restore: { map } });
  const sent = [];
  game.broadcast = (message) => sent.push(message);
  const add = (name) => {
    const socket = { readyState: 1, OPEN: 1, send() {}, on() {} };
    game.join(socket, name);
    return game.bySocket.get(socket);
  };
  const ada = add('Ada');
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      clock.now += 1000 / 30;
      game.tick(1 / 30);
    }
  };
  const solid = () => game.world.cells.reduce((count, m) => count + (m ? 1 : 0), 0);
  // The floor: the bottom layer of cells.
  const floor = () => {
    let count = 0;
    for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) if (game.world.get(ix, 0, iz)) count++;
    return count;
  };
  const shoot = (dir) => {
    clock.now += WEAPONS.rifle.cooldownMs;
    game.arsenal.fire(ada, { weapon: 'rifle', feet: ada.feet, dir, hits: [] });
  };
  return { game, ada, add, sent, run, solid, floor, shoot };
}

const which = (look) => PLANETS.findIndex((planet) => planet.look === `sky/planet-${look}`);

test('five planets: a shot goes straight at one only inside how big it looks', () => {
  assert.equal(PLANETS.length, 5);
  PLANETS.forEach((planet, i) => assert.equal(planetAt(planet.dir), i, planet.name));
  const red = PLANETS[which('rocky')];
  const off = [red.dir[0], red.dir[1] + red.size * 1.5, red.dir[2]];
  const length = Math.hypot(...off);
  assert.equal(planetAt(off.map((v) => v / length)), -1, 'just above it: a miss');
  assert.equal(planetAt(red.dir, new Set([which('rocky')])), -1, 'and not once it has gone');
});

test('a shot out between the pillars straight at a planet blows it up, and its pieces chip bits off the side facing it, hurting nobody', () => {
  const { game, ada, add, sent, run, solid, floor, shoot } = setup('depot');
  const bob = add('Bob');
  const red = which('rocky'); // low in the north-west
  ada.feet = [-34, 0, -24];
  const before = solid();
  const ground = floor();
  shoot(PLANETS[red].dir);
  const news = sent.find((m) => m.type === 'planet');
  assert.deepEqual([news?.event, news?.planet, news?.by], ['exploded', red, ada.id]);
  assert.ok(game.planets.gone.has(red));
  assert.ok(news.strikes.length >= DEBRIS.strikes / 2, `${news.strikes.length} strikes`);
  const [dx, , dz] = PLANETS[red].dir;
  const toward =
    news.strikes.reduce((sum, [x, , z]) => sum + (x * dx + z * dz) / Math.hypot(dx, dz), 0) /
    news.strikes.length;
  assert.ok(
    toward > 3,
    `on the side of the arena facing it: their middle ${toward.toFixed(1)} m out that way`,
  );
  // Bob stands right where the first piece strikes, and Ada right where the last one does.
  const [first, last] = [news.strikes[0], news.strikes.at(-1)];
  bob.feet = [first[0], Math.max(0, first[1] - 1), first[2]];
  ada.feet = [last[0], Math.max(0, last[1] - 1), last[2]];
  run(4.5);
  assert.equal(
    sent.filter((m) => m.type === 'boom' && m.kind === 'meteor').length,
    news.strikes.length,
    'every piece strikes',
  );
  assert.deepEqual([ada.alive, ada.hp, bob.alive, bob.hp], [true, 100, true, 100], 'and hurts nobody');
  assert.ok(!sent.some((m) => m.type === 'kill' || m.type === 'hit'), 'nobody hit');
  const share = (before - solid()) / before;
  assert.ok(share > 0 && share < 0.01, `a bit chipped off: ${(share * 100).toFixed(2)}% of the arena`);
  assert.equal(floor(), ground, 'and none of the floor');
  shoot(PLANETS[red].dir);
  assert.equal(sent.filter((m) => m.type === 'planet').length, 1, 'it can only go once');
  game.startRound();
  assert.equal(game.planets.gone.size, 0, 'a new round brings it back');
  assert.deepEqual(sent.findLast((m) => m.type === 'world').planets, []);
});

test('the planet overhead, shot through a skylight, chips mostly the roof', () => {
  const { game, ada, sent, run, shoot } = setup('depot'); // a skylight over the middle of the platform
  const violet = which('violet');
  ada.feet = [0, 1, 0];
  shoot(PLANETS[violet].dir);
  const news = sent.find((m) => m.type === 'planet');
  assert.equal(news?.planet, violet);
  const high = news.strikes.filter(([, y]) => y > 13).length;
  assert.ok(
    high >= news.strikes.length / 2,
    `mostly on the roof, 15 m up (some down through the skylights): ${high} of ${news.strikes.length}`,
  );
  run(4.5);
  assert.ok(sent.some((m) => m.type === 'boom' && m.kind === 'meteor' && m.at[1] > 13));
  assert.deepEqual(game.worldMessage().planets, [violet], 'and whoever joins now sees it gone');
});

test("a planet's pieces leave the canal alone: the water stays", () => {
  const { game, ada, sent, run, shoot } = setup('canal'); // open to the sky over the canal
  const violet = which('violet');
  ada.feet = [0, 2.5, 0]; // on the middle bridge
  const water = game.world.water;
  shoot(PLANETS[violet].dir);
  const news = sent.find((m) => m.type === 'planet');
  assert.ok(news?.strikes.length, 'it blows up');
  const { min, max } = MAPS['canal'].pool.basin;
  const clear = (strike) =>
    [0, 1, 2].some((a) => strike[a] <= min[a] - DEBRIS.radius[0] || strike[a] >= max[a] + DEBRIS.radius[0]);
  assert.ok(news.strikes.every(clear), 'none reaches the basin');
  run(4.5);
  assert.equal(game.world.water, water, 'not a drop runs out');
});
