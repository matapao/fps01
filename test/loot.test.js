// Loot: powerups on the pedestal and crates with specials, on a fake clock, with players on
// stand-in connections. On Arena's Depot, where a server starts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { Game } from '../server/game.js';
import { MAX_HEALTH } from '../shared/constants.js';
import {
  PEDESTAL,
  POWERUP_FIRST_MS,
  POWERUP_MS,
  POWERUP_WARNING_MS,
  POWERUPS,
  PILOT_TURN,
  WOOLLY,
} from '../shared/loot.js';
import { TOP } from '../shared/map.js';
import { M } from '../shared/materials.js';
import { cellOf } from '../shared/voxels.js';
import { PROJECTILES, WEAPONS } from '../shared/weapons.js';

const Y = 0; // the floor of the Depot
const LANE = 14.5; // an open lane right across it, from one outer wall to the other, south of the trains

function setup() {
  const clock = { now: 1_000_000 };
  const game = new Game({ protectionMs: 0, now: () => clock.now });
  const sent = [];
  game.broadcast = (message) => sent.push(message);
  const add = (name, feet) => {
    const socket = {
      readyState: 1,
      OPEN: 1,
      inbox: [],
      send: (data) => socket.inbox.push(JSON.parse(data)),
      on() {},
    };
    game.join(socket, name);
    const player = game.bySocket.get(socket);
    player.feet = [...feet];
    return player;
  };
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      clock.now += 1000 / 30;
      game.tick(1 / 30);
    }
  };
  // Hands someone a special, as if they'd opened a crate with it in.
  const special = (player, kind, message) => {
    player.special = kind;
    game.crates.use(player, { feet: player.feet, velocity: [0, 0, 0], ...message });
  };
  return { game, clock, sent, add, run, special };
}

const powerupNews = (sent) => sent.filter((m) => m.type === 'powerup').map((m) => [m.event, m.kind]);

test('a powerup is announced ten seconds ahead, appears on the pedestal, and lasts its taker 30 seconds', () => {
  const { game, clock, sent, add } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  game.powerups.pedestal.next = 'triple';
  clock.now += POWERUP_FIRST_MS - POWERUP_WARNING_MS;
  game.tick(0);
  clock.now += POWERUP_WARNING_MS;
  game.tick(0);
  assert.deepEqual(powerupNews(sent), [
    ['soon', 'triple'],
    ['appeared', 'triple'],
  ]);
  ada.feet = [...PEDESTAL];
  game.tick(0);
  assert.equal(game.powerups.of(ada), 'triple');
  assert.equal(game.powerups.pedestal.kind, null, 'gone from the pedestal');
  clock.now += POWERUP_MS;
  game.tick(0);
  assert.equal(game.powerups.of(ada), null);
  assert.deepEqual(powerupNews(sent).slice(2), [
    ['taken', 'triple'],
    ['ended', 'triple'],
  ]);
});

test('Triple Damage triples your damage; a Blast Guard shrugs off blasts and halves the rest', () => {
  const { game, add } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  const bo = add('Bo', [12, Y, LANE]);
  game.powerups.give(ada, 'triple', POWERUP_MS);
  game.damage(ada, bo, 10);
  assert.equal(bo.hp, MAX_HEALTH - 10 * POWERUPS.triple.damage);
  bo.hp = MAX_HEALTH;
  game.powerups.give(bo, 'guard', POWERUP_MS);
  game.damage(ada, bo, 10, { weapon: 'rocket', splash: true });
  assert.equal(bo.hp, MAX_HEALTH, 'no blast damage');
  game.damage(ada, bo, 10);
  assert.equal(bo.hp, MAX_HEALTH - 10 * POWERUPS.triple.damage * POWERUPS.guard.share);
});

test('Mend heals you, Rush makes you fire faster, Shimmer hides you even while you fire', () => {
  const { game, clock, sent, add, run } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  game.powerups.give(ada, 'mend', POWERUP_MS);
  ada.hp = 50;
  run(3);
  assert.ok(
    ada.hp >= 50 + 2 * POWERUPS.mend.perSecond && ada.hp <= 50 + 4 * POWERUPS.mend.perSecond,
    `hp ${ada.hp}`,
  );

  ada.powerup = null;
  game.powerups.give(ada, 'rush', POWERUP_MS);
  assert.equal(game.rushOf(ada), POWERUPS.rush.speed);
  const shots = () => sent.filter((m) => m.type === 'shot').length;
  game.arsenal.fire(ada, { weapon: 'rifle', feet: ada.feet, dir: [1, 0, 0], hits: [] });
  clock.now += 80;
  game.arsenal.fire(ada, { weapon: 'rifle', feet: ada.feet, dir: [1, 0, 0], hits: [] });
  assert.equal(shots(), 2);

  ada.powerup = null;
  game.powerups.give(ada, 'shimmer', POWERUP_MS);
  game.sockets.add(ada.socket);
  clock.now += 500;
  game.arsenal.fire(ada, { weapon: 'rifle', feet: ada.feet, dir: [1, 0, 0], hits: [] });
  game.snapshot();
  assert.equal(
    sent
      .filter((m) => m.type === 'snapshot')
      .at(-1)
      .players.find((p) => p.id === ada.id).cloaked,
    true,
  );
});

test('a carrier who dies drops the powerup with the time it had left, for someone else to pick up', () => {
  const { game, clock, add } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  const bo = add('Bo', [12, Y, LANE]);
  game.powerups.give(ada, 'triple', POWERUP_MS);
  clock.now += 10_000;
  game.damage(bo, ada, 1000);
  assert.equal(game.powerups.of(ada), null);
  const [loose] = game.powerups.loose.values();
  assert.deepEqual([loose.kind, loose.at], ['triple', [-12, Y, LANE]]);
  bo.feet = [-12, Y, LANE];
  game.tick(0);
  assert.equal(game.powerups.of(bo), 'triple');
  assert.equal(bo.powerup.until - clock.now, POWERUP_MS - 10_000);
});

test('a crate drifts down onto an open spot and gives what is inside to whoever walks into it', () => {
  const { game, sent, add, run } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  const crate = game.crates.drop(game.now(), 'woolly');
  assert.ok(crate.at[1] > 10 && !crate.landed, 'it starts high in the sky');
  run(6);
  assert.equal(crate.landed, true);
  assert.ok(
    game.world.solidAt(crate.at[0], crate.at[1] - 0.1, crate.at[2]),
    `on something, at y = ${crate.at[1]}`,
  );
  ada.feet = [...crate.at];
  game.tick(0);
  assert.equal(ada.special, 'woolly');
  assert.deepEqual(
    sent.find((m) => m.type === 'crate' && m.event === 'taken'),
    { type: 'crate', event: 'taken', id: crate.id, item: 'woolly', by: ada.id },
  );

  const another = game.crates.drop(game.now(), 'pilot');
  run(6);
  ada.feet = [...another.at];
  game.tick(0);
  assert.equal(ada.special, 'woolly', 'one special at a time: the other crate stays');
  assert.ok(game.crates.crates.has(another.id));

  const health = game.crates.drop(game.now(), 'health');
  run(6);
  Object.assign(ada, { hp: 40 });
  ada.weapons.add('rocket');
  ada.ammo.rocket = 1;
  ada.feet = [...health.at];
  game.tick(0);
  assert.deepEqual([ada.hp, ada.ammo.rocket], [90, WEAPONS.rocket.ammo]);
});

test('a woolly runs off, hops over something low, and blows up when its owner says so', () => {
  const { game, sent, add, run, special } = setup();
  const ada = add('Ada', [-16, Y, LANE]);
  // A row of crate, one cell high, across the lane.
  game.world.build(
    [cellOf(-12, 0), cellOf(Y + 0.25, 1), cellOf(LANE - 1, 2)],
    [cellOf(-12, 0), cellOf(Y + 0.25, 1), cellOf(LANE + 1, 2)],
    M.crate,
  );
  special(ada, 'woolly', { dir: [1, 0, 0] });
  assert.equal(ada.special, null);
  assert.deepEqual(
    ada.socket.inbox.find((m) => m.type === 'guiding'),
    { type: 'guiding', kind: 'woolly', id: [...game.crates.woollies.keys()][0] },
  );
  run(2);
  const [woolly] = game.crates.woollies.values();
  assert.ok(woolly.pos[0] > -11, `over the crate row and on, at x = ${woolly.pos[0].toFixed(2)}`);
  assert.ok(Math.abs(woolly.pos[1] - Y) < 0.01, 'back on the floor');
  game.crates.use(ada, { detonate: true });
  assert.equal(game.crates.woollies.size, 0);
  const boom = sent.find((m) => m.type === 'boom' && m.kind === 'woolly');
  assert.deepEqual([boom.radius, boom.hole], [WOOLLY.blast.radius, WOOLLY.blast.hole]);
  assert.deepEqual(ada.socket.inbox.at(-1), { type: 'guiding', kind: null });
});

test('a woolly turns back from a wall, and goes off by itself in the end', () => {
  const { game, sent, add, run, special } = setup();
  const ada = add('Ada', [30, Y, 12.5]);
  special(ada, 'woolly', { dir: [1, 0, 0] });
  run(3);
  const [woolly] = game.crates.woollies.values();
  assert.equal(woolly.dir[0], -1, 'back from the back wall of the engine shed');
  run(WOOLLY.ms / 1000);
  assert.ok(sent.some((m) => m.type === 'boom' && m.kind === 'woolly'));
});

test('a choir grenade makes a very big blast; a splitter bomb bursts into five more', () => {
  const { sent, add, run, special } = setup();
  const ada = add('Ada', [-16, Y, LANE]);
  special(ada, 'choir', { dir: [1, 0.3, 0] });
  run(3.5);
  const choir = sent.find((m) => m.type === 'boom' && m.kind === 'choir');
  assert.deepEqual(
    [choir.radius, choir.hole],
    [PROJECTILES.choir.blast.radius, PROJECTILES.choir.blast.hole],
  );
  ada.hp = MAX_HEALTH;
  ada.feet = [-16, Y, -LANE];
  special(ada, 'splitter', { dir: [1, 0.3, 0] });
  run(6);
  assert.equal(sent.filter((m) => m.type === 'boom' && m.kind === 'splitter').length, 1);
  assert.equal(sent.filter((m) => m.type === 'boom' && m.kind === 'splitterBit').length, 5);
});

test('the pilot missile turns towards where its owner looks, and goes off when they say so', () => {
  const { game, sent, add, run, special } = setup();
  const ada = add('Ada', [-30, Y, -LANE]);
  special(ada, 'pilot', { dir: [1, 0, 0] });
  const shot = game.arsenal.flying.get(ada.guiding);
  assert.equal(shot.kind, 'pilot');
  game.crates.steer(ada, { dir: [0, 0, -1] });
  run(0.5);
  const turned = Math.atan2(-shot.vel[2], shot.vel[0]);
  assert.ok(Math.abs(turned - PILOT_TURN * 0.5) < 0.1, `turned ${turned.toFixed(2)} rad in half a second`);
  game.crates.use(ada, { detonate: true });
  const boom = sent.find((m) => m.type === 'boom' && m.kind === 'pilot');
  assert.equal(boom.radius, PROJECTILES.pilot.blast.radius);
  assert.deepEqual([ada.guiding, ada.socket.inbox.at(-1)], [null, { type: 'guiding', kind: null }]);
});

test('a teleport takes you anywhere in the arena you fit, and nowhere else', () => {
  const { sent, add, special } = setup();
  const ada = add('Ada', [-16, Y, LANE]);
  special(ada, 'teleport', { at: [9, Y, 16.5] }); // inside a stack of sleepers
  assert.deepEqual([ada.special, ada.feet], ['teleport', [-16, Y, LANE]]);
  special(ada, 'teleport', { at: [0, -6, 0] }); // in the void under the arena
  special(ada, 'teleport', { at: [0, TOP + 2, 0] }); // high in the sky
  assert.equal(ada.special, 'teleport');
  special(ada, 'teleport', { at: [12, Y, LANE] });
  assert.deepEqual([ada.special, ada.feet], [null, [12, Y, LANE]]);
  assert.deepEqual(
    ada.socket.inbox.find((m) => m.type === 'moved'),
    { type: 'moved', feet: [12, Y, LANE] },
  );
  assert.ok(sent.some((m) => m.type === 'teleport' && m.id === ada.id));
});

test('an air strike brings five missiles down from under the roof, in a line through where you picked', () => {
  const { game, sent, add, run, special } = setup();
  const ada = add('Ada', [-16, Y, 17]);
  special(ada, 'airstrike', { at: [-4, Y, LANE], dir: [1, 0, 0] }); // between the footbridges overhead, at x = ±14
  run(0.6);
  assert.equal(sent.filter((m) => m.type === 'boom').length, 0, 'on their way');
  run(2.5);
  const missiles = sent.filter((m) => m.type === 'boom' && m.kind === 'missile');
  assert.equal(missiles.length, 5);
  const xs = missiles.map((m) => m.at[0]).sort((a, b) => a - b);
  [-9, -6.5, -4, -1.5, 1].forEach((x, i) =>
    assert.ok(Math.abs(xs[i] - x) < 0.3, `missiles at x = ${xs.map((v) => v.toFixed(2))}`),
  );
  assert.ok(
    missiles.every((m) => Math.abs(m.at[1] - Y) < 0.5 && Math.abs(m.at[2] - LANE) < 0.3),
    'on the floor where you picked',
  );
  assert.equal(game.world.history.length, 5);
});
