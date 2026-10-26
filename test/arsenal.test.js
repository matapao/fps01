// Weapons, armor, pickups, kicks and medals, on a fake clock, with players on stand-in connections,
// on the Fort.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { Game } from '../server/game.js';
import { EYE_HEIGHT, KICK_COOLDOWN_MS, KICK_DAMAGE, KICK_PUSH, MAX_HEALTH } from '../shared/constants.js';
import { ITEMS } from '../shared/map.js';
import { MAX_ARMOR, OVERHEAL, WEAPONS, costOf } from '../shared/weapons.js';
import { moveState, stepMovement } from '../shared/movement.js';

const Y = 0; // the floor
const LANE = 13; // an open lane across the field, from x = -12 to the east fort's south tower at x = 22
const RING = 2.25; // a line through the chapel's west wall, at x = -6 … -5

function setup({ mode = 'dm', map = 'fort' } = {}) {
  const clock = { now: 1_000_000 };
  const game = new Game({ protectionMs: 0, now: () => clock.now, restore: { players: [], mode, map } });
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
  const fire = (player, weapon, dir, hits = [], alt = false) =>
    game.arsenal.fire(player, { weapon, alt, feet: player.feet, dir, hits });
  return { game, clock, sent, add, run, fire };
}

// Gives someone a weapon with a full load, as if they had walked over it.
function arm(player, weapon) {
  player.weapons.add(weapon);
  player.ammo[weapon] = WEAPONS[weapon].ammo;
}

// The direction from someone's eyes to the middle of someone else.
function aimAt(from, to) {
  const offset = [
    to.feet[0] - from.feet[0],
    to.feet[1] + 0.9 - from.feet[1] - EYE_HEIGHT,
    to.feet[2] - from.feet[2],
  ];
  const length = Math.hypot(...offset);
  return offset.map((v) => v / length);
}

const EAST = [1, 0, 0];

test('hostile JSON fields cannot invoke coercion while selecting weapons or counting pellets', () => {
  const { game, add, fire } = setup();
  try {
    const shooter = add('One', [-12, Y, LANE]);
    const target = add('Two', [-6, Y, LANE]);
    const malformed = { toString: null, valueOf: null };
    for (const weapon of [malformed, [malformed], null, 7]) {
      assert.doesNotThrow(() => fire(shooter, weapon, EAST));
    }
    assert.doesNotThrow(() => fire(shooter, 'shotgun', EAST, [{ id: target.id, count: malformed }]));
    assert.equal(target.hp, MAX_HEALTH);
  } finally {
    game.stop();
  }
});

test('you spawn with the rifle and the shotgun and no armor, and only you are told your ammo', () => {
  const { game, add } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  assert.deepEqual([[...ada.weapons], ada.armor], [['rifle', 'shotgun'], 0]);
  game.sockets.add(ada.socket);
  game.snapshot();
  const self = ada.socket.inbox.find((m) => m.type === 'self');
  assert.deepEqual([self.weapons, self.ammo], [['rifle', 'shotgun'], {}]);
});

test('the shotgun hits everyone in its cone, pellet by pellet, but never with more pellets than it has', () => {
  const { game, add, fire } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  const bo = add('Bo', [-6, Y, LANE]);
  const cy = add('Cy', [-6, Y, LANE + 1]);
  const di = add('Di', [-12, Y, LANE - 6]); // off to the side
  const { pellets, damage } = WEAPONS.shotgun;
  fire(ada, 'shotgun', EAST, [
    { id: di.id, count: 4 },
    { id: bo.id, count: 8 },
    { id: cy.id, count: 8 },
  ]);
  assert.equal(di.hp, MAX_HEALTH, 'outside the cone');
  assert.equal(bo.hp, MAX_HEALTH - 8 * damage);
  assert.equal(cy.hp, MAX_HEALTH - (pellets - 8) * damage, 'only the pellets that were left');
  fire(ada, 'shotgun', EAST, [{ id: bo.id, count: 8 }]);
  assert.equal(bo.hp, MAX_HEALTH - 8 * damage, 'too soon after the last');
  assert.equal(costOf('shotgun', true).key, 'shotgun', 'the slug waits for the same pump');
});

test("the shotgun's slug blows a doorway into a wall close by, but not one far away", () => {
  const { game, sent, clock, add, fire } = setup();
  const ada = add('Ada', [-12, Y, RING]); // facing the chapel's wall at x = -6
  fire(ada, 'shotgun', EAST, [], true);
  const breach = sent.find((m) => m.type === 'boom' && m.kind === 'breach');
  assert.deepEqual([breach.at, breach.hole], [[-5.75, Y + EYE_HEIGHT, RING], WEAPONS.shotgun.alt.hole]);
  for (const x of [-5.75, -5.25])
    assert.equal(game.world.solidAt(x, Y + EYE_HEIGHT, RING), false, `a way through at x = ${x}`);
  assert.equal(game.world.solidAt(-5.75, Y + EYE_HEIGHT, RING + 1.25), true, 'the rest of the wall stands');

  sent.length = 0;
  ada.feet = [-12, Y, LANE];
  clock.now += 2000;
  fire(ada, 'shotgun', EAST, [], true); // nothing within reach: the tower at the end of the lane is 34 m away
  assert.equal(sent.filter((m) => m.type === 'boom').length, 0);
});

test('a rocket flies straight until it hits something, and runs out after ten', () => {
  const { game, clock, sent, add, run, fire } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  fire(ada, 'rocket', EAST);
  assert.equal(game.arsenal.flying.size, 0, 'nobody starts with one');
  arm(ada, 'rocket');
  fire(ada, 'rocket', EAST);
  fire(ada, 'rocket', EAST); // too soon
  assert.deepEqual([game.arsenal.flying.size, ada.ammo.rocket], [1, 9]);
  run(2);
  const boom = sent.find((m) => m.type === 'boom' && m.kind === 'rocket');
  assert.ok(boom, 'it went off');
  assert.ok(
    Math.abs(boom.at[0] - 21.85) < 0.3 && Math.abs(boom.at[1] - (Y + EYE_HEIGHT)) < 1e-6,
    `straight into the tower at the end of the lane, at ${boom.at}`,
  );
  for (let i = 0; i < 12; i++) {
    clock.now += WEAPONS.rocket.cooldownMs;
    fire(ada, 'rocket', EAST);
  }
  assert.equal(ada.ammo.rocket, 0);
  assert.equal(sent.filter((m) => m.type === 'launch').length, 10);
});

test('firing a rocket at nearby ground pressure-jumps without damage or breaking the floor', () => {
  const { game, clock, sent, add, fire } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  const bo = add('Bo', [-11, Y, LANE]);
  arm(ada, 'rocket');
  const before = game.world.cells.slice();
  fire(ada, 'rocket', [0, -1, 0]);
  assert.equal(game.arsenal.flying.size, 0, 'air instead of a rocket');
  assert.deepEqual([ada.hp, bo.hp], [MAX_HEALTH, MAX_HEALTH], 'nobody is hurt');
  assert.deepEqual(game.world.cells, before, 'every cell stays intact');
  assert.equal(game.world.history.length, 0);
  assert.equal(
    sent.some((m) => ['boom', 'launch', 'hit'].includes(m.type)),
    false,
  );
  const pressure = sent.find((m) => m.type === 'pressure');
  assert.deepEqual(pressure.at, [-12, 0, LANE]);
  assert.equal(pressure.id, ada.id);
  const pushes = () => ada.socket.inbox.filter((m) => m.type === 'push');
  assert.deepEqual(pushes()[0].velocity, [0, WEAPONS.rocket.pressure.push, 0]);
  assert.equal(
    bo.socket.inbox.some((m) => m.type === 'push'),
    false,
    'only the shooter jumps',
  );
  assert.equal(ada.ammo.rocket, WEAPONS.rocket.ammo - 1);
  fire(ada, 'rocket', [0, -1, 0]);
  assert.equal(pushes().length, 1, 'normal rocket cooldown');
  clock.now += WEAPONS.rocket.cooldownMs;
  fire(ada, 'rocket', [0.6, -0.8, 0]);
  assert.deepEqual(pushes()[1].velocity, [-8.4, 11.2, 0], 'aim behind you to gain forward momentum');
  clock.now += WEAPONS.rocket.cooldownMs;
  ada.ammo.rocket = 0;
  fire(ada, 'rocket', [0, -1, 0]);
  assert.equal(pushes().length, 2, 'an empty launcher cannot jump');

  const state = moveState(ada.feet);
  state.velocity = [...pushes()[0].velocity];
  let highest = Y;
  for (let i = 0; i < 120; i++) {
    stepMovement(state, { forward: 0, strafe: 0, yaw: 0 }, 1 / 60, game.world, (i * 1000) / 60);
    highest = Math.max(highest, state.feet[1]);
  }
  assert.ok(highest > 4.5 && highest < 5, `a useful rocket jump: ${highest} m`);
});

test('rockets stay explosive when the floor is distant, missing, or hidden behind a wall', () => {
  for (const where of ['distant', 'missing', 'wall']) {
    const { game, sent, add, fire } = setup();
    const ada = add('Ada', [-12, where === 'distant' ? 4 : Y, LANE]);
    arm(ada, 'rocket');
    let dir = [0, -1, 0];
    if (where === 'missing') game.world.carve([-12, -0.25, LANE], 1);
    if (where === 'wall') {
      ada.feet = [-6.4, Y, RING];
      dir = [0.6, -0.8, 0];
    }
    fire(ada, 'rocket', dir);
    assert.equal(game.arsenal.flying.size, 1, where);
    assert.equal(
      sent.some((m) => m.type === 'pressure'),
      false,
      where,
    );
    const launch = sent.find((m) => m.type === 'launch');
    const [shot] = game.arsenal.flying.values();
    assert.equal(launch.shot, shot.id, 'graphics receive the projectile identity');
    assert.deepEqual(
      launch.velocity,
      dir.map((v) => v * 30),
      'graphics receive its initial heading',
    );
  }
});

test("the rocket launcher's mortar takes two rockets and splits into three bomblets", () => {
  const { game, sent, add, run, fire } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  arm(ada, 'rocket');
  const up = [1, 0.3, 0].map((v, _, a) => v / Math.hypot(...a));
  fire(ada, 'rocket', up, [], true);
  assert.equal(ada.ammo.rocket, WEAPONS.rocket.ammo - WEAPONS.rocket.alt.cost);
  run(1.2);
  assert.ok(
    sent.some((m) => m.type === 'boom' && m.kind === 'mortar'),
    'the mortar went off',
  );
  assert.equal(sent.filter((m) => m.type === 'launch' && m.kind === 'bomblet').length, 3);
  run(2.5);
  assert.equal(sent.filter((m) => m.type === 'boom' && m.kind === 'bomblet').length, 3);
  assert.equal(game.arsenal.flying.size, 0);
});

test("the grenade launcher's second grenade bounces until its fuse runs out", () => {
  const { game, sent, add, run, fire } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  arm(ada, 'launcher');
  fire(
    ada,
    'launcher',
    [1, -0.3, 0].map((v, _, a) => v / Math.hypot(...a)),
    [],
    true,
  );
  run(1.5);
  assert.deepEqual(
    [game.arsenal.flying.size, sent.filter((m) => m.type === 'boom').length],
    [1, 0],
    'still bouncing',
  );
  run(1.2);
  assert.equal(sent.filter((m) => m.type === 'boom' && m.kind === 'bouncer').length, 1);
  assert.equal(ada.ammo.launcher, WEAPONS.launcher.ammo - 1);
});

test('the spark gun hurts every tick out to its range, and its overload arcs on to two more people', () => {
  const { clock, sent, add, fire } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  const bo = add('Bo', [0, Y, LANE]);
  arm(ada, 'spark');
  const { damage, range, alt: overload } = WEAPONS.spark;
  fire(ada, 'spark', aimAt(ada, bo), [{ id: bo.id }]);
  fire(ada, 'spark', aimAt(ada, bo), [{ id: bo.id }]); // the same tick
  assert.deepEqual([bo.hp, ada.ammo.spark], [MAX_HEALTH - damage, WEAPONS.spark.ammo - 1]);
  bo.feet = [-12 + range + 2, Y, LANE];
  clock.now += 100;
  fire(ada, 'spark', aimAt(ada, bo), [{ id: bo.id }]);
  assert.equal(bo.hp, MAX_HEALTH - damage, 'out of reach');

  bo.hp = MAX_HEALTH;
  bo.feet = [-6, Y, LANE];
  const cy = add('Cy', [-2, Y, LANE]);
  const di = add('Di', [2, Y, LANE]);
  const ed = add('Ed', [6, Y, LANE]);
  clock.now += 100;
  fire(ada, 'spark', aimAt(ada, bo), [{ id: bo.id }], true);
  assert.deepEqual(
    [bo, cy, di, ed].map((p) => p.hp),
    [MAX_HEALTH - overload.damage, MAX_HEALTH - overload.chain, MAX_HEALTH - overload.chain, MAX_HEALTH],
  );
  assert.equal(sent.find((m) => m.type === 'arc').points.length, 4);
});

test('the railgun kills everyone in its path with one hit, whatever their armor, and two hits in a row are Back to Back', () => {
  const { game, clock, sent, add, fire } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  const bo = add('Bo', [-6, Y, LANE]);
  const cy = add('Cy', [0, Y, LANE]);
  Object.assign(cy, { hp: OVERHEAL, armor: MAX_ARMOR }); // as much as anyone can have
  arm(ada, 'rail');
  fire(ada, 'rail', EAST, [{ id: bo.id }, { id: cy.id }]);
  assert.deepEqual([bo.alive, cy.alive, ada.kills], [false, false, 2]);
  assert.equal(
    sent.some((m) => m.type === 'medal'),
    false,
  );
  game.spawn(bo);
  bo.feet = [-6, Y, LANE];
  clock.now += WEAPONS.rail.cooldownMs;
  fire(ada, 'rail', EAST, [{ id: bo.id }]);
  assert.deepEqual(
    sent.find((m) => m.type === 'medal'),
    { type: 'medal', id: ada.id, medal: 'backtoback' },
  );
});

test('a charged railgun shot goes through a metre of wall and breaks it; an ordinary one stops at the wall', () => {
  const { game, clock, sent, add, fire } = setup();
  const ada = add('Ada', [-12, Y, RING]);
  const bo = add('Bo', [-1.5, Y, RING]); // behind the chapel's wall, inside it
  arm(ada, 'rail');
  fire(ada, 'rail', EAST, [{ id: bo.id }]);
  assert.equal(bo.hp, MAX_HEALTH);
  clock.now += WEAPONS.rail.cooldownMs;
  fire(ada, 'rail', EAST, [{ id: bo.id }], true);
  assert.equal(bo.alive, false);
  const broken = sent.filter((m) => m.type === 'chip' && m.broke);
  assert.equal(broken.length, 2, 'both cells of the wall it went through');
  for (const x of [-5.75, -5.25]) assert.equal(game.world.solidAt(x, Y + EYE_HEIGHT, RING), false);
  assert.equal(game.world.history.length, 2, 'and the arena remembers it, for anyone joining later');
});

test('armor takes two thirds of the damage; health, armor and the Health Orb are picked up and come back', () => {
  const { game, clock, sent, add, run } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  const bo = add('Bo', [12, Y, -LANE]);
  const spot = (piece) => ITEMS.findIndex((item) => item.piece === piece);
  const armor = spot('armor');
  ada.feet = [...ITEMS[armor].at];
  run(0.1);
  assert.equal(ada.armor, 50);
  assert.deepEqual(
    sent.find((m) => m.type === 'item'),
    { type: 'item', spot: armor, event: 'taken', by: ada.id },
  );
  assert.equal(game.items.snapshot()[armor], ITEMS[armor].respawnMs / 1000, 'gone, back in so many seconds');
  game.damage(bo, ada, 30);
  assert.deepEqual([ada.hp, ada.armor], [MAX_HEALTH - 10, 30]);
  game.damage(bo, ada, 90);
  assert.deepEqual([ada.hp, ada.armor], [MAX_HEALTH - 10 - 60, 0], 'armor only takes what it has');

  const health = spot('health');
  ada.feet = [...ITEMS[health].at];
  run(0.1);
  assert.equal(ada.hp, 30 + 25);
  ada.hp = MAX_HEALTH;
  clock.now += ITEMS[health].respawnMs;
  run(0.1);
  assert.equal(game.items.snapshot()[health], 0, 'back, and left there: she has all the health she can take');

  clock.now += ITEMS[armor].respawnMs;
  ada.armor = MAX_ARMOR - 10;
  ada.feet = [...ITEMS[armor].at];
  run(0.1);
  assert.equal(ada.armor, MAX_ARMOR);

  const orb = spot('orb');
  ada.feet = [...ITEMS[orb].at];
  run(0.1);
  assert.equal(ada.hp, OVERHEAL - 0, 'up to 200');
  run(5);
  assert.ok(ada.hp <= OVERHEAL - 4 && ada.hp >= OVERHEAL - 6, `ticks down a point a second: ${ada.hp}`);
  assert.ok(ada.armor <= MAX_ARMOR - 4, 'and so does armor above 100');
});

test('weapons lie on pads: walking over one gives it to you with a full load, and in capture the flag it stays', () => {
  for (const mode of ['dm', 'ctf']) {
    const { game, add, run, fire } = setup({ mode });
    const rail = ITEMS.findIndex((item) => item.weapon === 'rail');
    const ada = add('Ada', [...ITEMS[rail].at]);
    run(0.1);
    assert.equal(ada.ammo.rail, WEAPONS.rail.ammo, mode);
    assert.equal(game.items.snapshot()[rail] === 0, mode === 'ctf', mode);
    ada.feet = [-12, Y, LANE];
    fire(ada, 'rail', EAST);
    assert.equal(ada.ammo.rail, WEAPONS.rail.ammo - 1);
    if (mode === 'ctf') {
      ada.feet = [...ITEMS[rail].at];
      run(0.1);
      assert.equal(ada.ammo.rail, WEAPONS.rail.ammo, 'topped up');
    }
  }
});

test('a kick hurts and sends them flying, and finishing someone with one is a Show-off', () => {
  const { game, clock, sent, add } = setup();
  const ada = add('Ada', [0, Y, LANE]);
  const bo = add('Bo', [1.2, Y, LANE]);
  game.kick(ada, { hit: bo.id });
  assert.equal(bo.hp, MAX_HEALTH - KICK_DAMAGE);
  assert.deepEqual(bo.socket.inbox.find((m) => m.type === 'push').velocity, [KICK_PUSH, 5, 0]);
  game.kick(ada, { hit: bo.id });
  assert.equal(bo.hp, MAX_HEALTH - KICK_DAMAGE, 'not again so soon');
  bo.feet = [5, Y, LANE];
  clock.now += KICK_COOLDOWN_MS;
  game.kick(ada, { hit: bo.id });
  assert.equal(bo.hp, MAX_HEALTH - KICK_DAMAGE, 'out of reach');
  bo.feet = [1, Y, LANE];
  for (let i = 0; i < 2; i++) {
    clock.now += KICK_COOLDOWN_MS;
    game.kick(ada, { hit: bo.id });
  }
  assert.equal(bo.alive, false);
  assert.equal(sent.find((m) => m.type === 'kill').weapon, 'kick');
  assert.deepEqual(
    sent.find((m) => m.type === 'medal'),
    { type: 'medal', id: ada.id, medal: 'showoff' },
  );
});

test('helping with a kill is an assist; killing their flag carrier, or anyone near your flag, is Defender', () => {
  const { game, clock, sent, add } = setup();
  const ada = add('Ada', [-12, Y, LANE]);
  const bo = add('Bo', [12, Y, LANE]);
  const cy = add('Cy', [0, Y, -LANE]);
  game.damage(cy, bo, 20);
  clock.now += 1000;
  game.damage(ada, bo, 1000);
  assert.deepEqual(
    sent.filter((m) => m.type === 'medal'),
    [{ type: 'medal', id: cy.id, medal: 'assist' }],
  );
  game.spawn(bo);
  sent.length = 0;
  game.damage(cy, bo, 20);
  clock.now += 5000; // too long ago
  game.damage(ada, bo, 1000);
  assert.deepEqual(
    sent.filter((m) => m.type === 'medal'),
    [],
  );

  const ctf = setup({ mode: 'ctf' });
  const red = ctf.add('Red', [-27, Y, 3]);
  const blue = ctf.add('Blue', [-26, Y, 2]); // right by Red's flag, at x = -31
  red.team = 'red';
  blue.team = 'blue';
  ctf.game.damage(red, blue, 1000);
  assert.deepEqual(
    ctf.sent.filter((m) => m.type === 'medal'),
    [{ type: 'medal', id: red.id, medal: 'defender' }],
  );
});

test('a rocket blows a hole in the outer wall, and through it there is nothing but space', () => {
  const { game, add, run, fire } = setup();
  const ada = add('Ada', [28, Y, -20]);
  arm(ada, 'rocket');
  fire(ada, 'rocket', EAST);
  run(0.5);
  assert.equal(game.world.solidAt(36.25, Y + EYE_HEIGHT, -20), false, 'a hole in the wall');
  assert.equal(game.world.raycast([30, Y + EYE_HEIGHT, -20], EAST, 200), null, 'and nothing beyond it');
});
