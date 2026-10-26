// Rounds, modes and maps, the announcer's numbers, the round's clock, and capture the flag, on a
// fake clock. On the Depot, unless a test picks another map.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { Game } from '../server/game.js';
import {
  CTF_CAPTURES,
  DM_KILLS,
  FLAG_RETURN_MS,
  MULTI_KILL_MS,
  ROUND_BREAK_MS,
} from '../shared/constants.js';
import { FLAG_BASES, MAPS } from '../shared/map.js';
import { TIME_LIMIT_MS } from '../shared/rounds.js';

const Y = 0; // the floor
const LANE = 14.5; // an open lane across the Depot, south of the trains

function setup(restore) {
  const clock = { now: 1_000_000 };
  const game = new Game({ protectionMs: 0, now: () => clock.now, restore });
  const sent = [];
  game.broadcast = (message) => sent.push(message);
  const add = (name, feet = [-15, Y, LANE]) => {
    const socket = { readyState: 1, OPEN: 1, send() {}, on() {} };
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
  const kill = (killer, victim) => game.damage(killer, victim, 1000, { weapon: 'rifle' });
  return { game, clock, sent, add, run, kill };
}

const kills = (sent) => sent.filter((m) => m.type === 'kill');

test('quick kills add up to multi kills, kills without dying to a spree, and the first is first blood', () => {
  const { game, clock, sent, add, kill } = setup();
  const ada = add('Ada');
  const victims = [add('Bo'), add('Cy'), add('Di')];
  for (const victim of victims) {
    kill(ada, victim);
    clock.now += MULTI_KILL_MS - 500;
    game.spawn(victim);
  }
  clock.now += MULTI_KILL_MS + 1; // too long since the last: the count starts again
  kill(ada, victims[0]);
  assert.deepEqual(
    kills(sent).map((m) => [m.multi, m.spree, m.first ?? false]),
    [
      [1, 1, true],
      [2, 2, false],
      [3, 3, false],
      [1, 4, false],
    ],
  );
});

test("ending someone's killing spree is announced, and dying ends yours", () => {
  const { game, sent, add, kill } = setup();
  const ada = add('Ada');
  const bo = add('Bo');
  for (let i = 0; i < 5; i++) {
    kill(ada, bo);
    game.spawn(bo);
  }
  kill(bo, ada);
  assert.equal(kills(sent).at(-1).ended, 5);
  assert.equal(ada.spree, 0);
});

test('the first to 25 kills wins a deathmatch round; after a break, a new one starts from nothing', () => {
  const { game, sent, add, run, kill } = setup();
  const ada = add('Ada');
  const bo = add('Bo');
  for (let i = 0; i < DM_KILLS; i++) {
    kill(ada, bo);
    if (i < DM_KILLS - 1) game.spawn(bo);
  }
  const over = sent.find((m) => m.type === 'round' && m.state === 'over');
  assert.deepEqual(over.winner, { id: ada.id, name: ada.name });
  game.damage(bo, ada, 1000, { weapon: 'rifle' });
  assert.equal(ada.alive, true, 'nobody gets hurt between rounds');
  game.world.carve([-15, Y - 0.25, 0], 2);
  run(ROUND_BREAK_MS / 1000 + 0.1);
  assert.ok(sent.some((m) => m.type === 'round' && m.state === 'start'));
  assert.deepEqual([ada.kills, bo.deaths, ada.alive, bo.alive], [0, 0, true, true]);
  assert.deepEqual(game.world.history, [], 'and the arena is as good as new');
});

test('a game is played on the map and in the mode it was made with, and the next server keeps them', () => {
  const { game, sent, add } = setup({ map: 'fort', mode: 'ctf' });
  const ada = add('Ada');
  const bo = add('Bo');
  assert.deepEqual([game.map, game.mode], ['fort', 'ctf']);
  const spawned = (player) => sent.find((m) => m.type === 'spawn' && m.id === player.id).feet;
  for (const player of [ada, bo])
    assert.ok(
      MAPS.fort.spawns.some((feet) => feet.join() === spawned(player).join()),
      `${player.name} spawned on the Fort`,
    );
  assert.equal(game.items.spots.length, MAPS.fort.items.length);
  for (const message of [
    { type: 'map', map: 'canal' },
    { type: 'mode', mode: 'dm' },
    { type: 'team', team: ada.team === 'red' ? 'blue' : 'red' },
  ]) {
    game.receive(ada.socket, JSON.stringify(message));
  }
  assert.deepEqual(
    [game.map, game.mode, sent.filter((m) => m.type === 'round').length],
    ['fort', 'ctf', 0],
    'nobody can switch them',
  );
  assert.deepEqual([game.saveState().map, game.saveState().mode], ['fort', 'ctf']);
  const canal = setup({ map: 'canal' });
  canal.game.add({
    readyState: 1,
    OPEN: 1,
    send(data) {
      this.got = JSON.parse(data);
    },
  });
  assert.equal(canal.game.world.water, MAPS.canal.pool.max[1], 'a full canal');
  assert.equal(setup({ map: 'thermae' }).game.map, 'depot', 'a map that is gone: the Depot');
  assert.equal(setup({ map: 'toString' }).game.map, 'depot');
});
test("in capture the flag everyone goes onto a team, the teams kept even when someone leaves, and teammates can't hurt each other", () => {
  const { game, sent, add } = setup({ mode: 'ctf' });
  const players = ['Ada', 'Bo', 'Cy', 'Di', 'Ed'].map((name) => add(name));
  const count = (team) => players.filter((p) => game.players.has(p.id) && p.team === team).length;
  assert.ok(Math.abs(count('red') - count('blue')) <= 1, `${count('red')} red against ${count('blue')} blue`);
  for (const player of players) {
    const { feet } = sent.find((m) => m.type === 'spawn' && m.id === player.id);
    assert.equal(
      Math.sign(feet[0]),
      player.team === 'red' ? -1 : 1,
      `${player.name} spawns on their own half`,
    );
  }
  const [a, b] = players.filter((p) => p.team === players[0].team);
  game.damage(a, b, 30);
  assert.equal(b.hp, 100);
  const enemy = players.find((p) => p.team !== a.team);
  game.damage(a, enemy, 30);
  assert.equal(enemy.hp, 70);
  // The whole of the smaller team leaves: one of the other team swaps sides to even them up.
  const smaller = count('red') < count('blue') ? 'red' : 'blue';
  const before = players.map((p) => p.team);
  for (const player of players.filter((p) => p.team === smaller)) game.disconnect(player.socket);
  assert.ok(Math.abs(count('red') - count('blue')) <= 1, `${count('red')} red against ${count('blue')} blue`);
  assert.ok(
    players.some((p, i) => game.players.has(p.id) && p.team !== before[i]),
    'someone moved to the other team to even them up',
  );
});
test('carrying their flag home scores, but only while your own is at home, and three captures win', () => {
  const { game, sent, add, run } = setup({ players: [], mode: 'ctf' });
  const ada = add('Ada');
  const bo = add('Bo');
  ada.team = 'red';
  bo.team = 'blue';
  const atBase = (team) => [FLAG_BASES[team][0] + 0.5, Y, FLAG_BASES[team][2]];
  ada.feet = atBase('blue');
  run(0.1);
  assert.deepEqual([game.flags.blue.state, ada.carrying], ['carried', 'blue']);
  assert.ok(sent.some((m) => m.type === 'flag' && m.event === 'taken' && m.by === ada.id));
  // Bo has taken Red's flag too: Ada can't score until it's back.
  bo.feet = atBase('red');
  run(0.1);
  ada.feet = atBase('red');
  run(0.1);
  assert.equal(game.captures.red, 0, 'not while her own flag is gone');
  game.damage(ada, bo, 1000);
  assert.equal(game.flags.red.state, 'dropped');
  run(0.1); // Ada is standing on it: she sends it home, then scores
  assert.deepEqual([game.flags.red.state, game.captures.red, game.flags.blue.state], ['home', 1, 'home']);
  for (let i = 1; i < CTF_CAPTURES; i++) {
    ada.feet = atBase('blue');
    run(0.1);
    ada.feet = atBase('red');
    run(0.1);
  }
  assert.deepEqual(sent.find((m) => m.type === 'round' && m.state === 'over').winner, { team: 'red' });
});

test("a dropped flag goes home by itself, and the flag carrier can't use the hook", () => {
  const { game, add, run } = setup({ players: [], mode: 'ctf' });
  const ada = add('Ada');
  ada.team = 'red';
  ada.feet = [FLAG_BASES.blue[0], Y, 0];
  run(0.1);
  ada.feet = [18, Y, 19];
  game.hook(ada, { at: [18, Y + 6, 25] }); // up onto a gravel bunker
  assert.equal(ada.hook, null);
  ada.feet = [0, Y, 17];
  game.damage(null, ada, 1000);
  assert.deepEqual([game.flags.blue.state, game.flags.blue.at], ['dropped', [0, Y, 17]]);
  run(FLAG_RETURN_MS / 1000 + 0.1);
  assert.equal(game.flags.blue.state, 'home');
});

test("for a moment after spawning you can't be hurt, unless you fire first", () => {
  const clock = { now: 1_000_000 };
  const game = new Game({ now: () => clock.now });
  game.broadcast = () => {};
  const join = (name) => {
    const socket = { readyState: 1, OPEN: 1, send() {}, on() {} };
    game.join(socket, name);
    return game.bySocket.get(socket);
  };
  const ada = join('Ada');
  const bo = join('Bo');
  game.damage(bo, ada, 30);
  assert.equal(ada.hp, 100, 'protected');
  game.arsenal.fire(ada, { weapon: 'rifle', feet: ada.feet, dir: [1, 0, 0], hits: [] });
  game.damage(bo, ada, 30);
  assert.equal(ada.hp, 70, 'firing ended it');
  clock.now += 2000;
  game.damage(ada, bo, 30);
  assert.equal(bo.hp, 70, 'and it wears off');
});

test('when time runs out the leader wins; a tie goes to sudden death, the floor crumbles, and the next kill wins', () => {
  const lead = setup();
  const ada = lead.add('Ada');
  lead.add('Bo');
  ada.kills = 3;
  lead.clock.now += TIME_LIMIT_MS.dm;
  lead.run(0.1);
  assert.deepEqual(lead.sent.find((m) => m.type === 'round' && m.state === 'over').winner, {
    id: ada.id,
    name: ada.name,
  });

  const tie = setup();
  const cy = tie.add('Cy');
  const di = tie.add('Di');
  tie.clock.now += TIME_LIMIT_MS.dm;
  tie.run(0.1);
  assert.ok(tie.sent.some((m) => m.type === 'round' && m.state === 'sudden'));
  tie.run(3);
  const holes = tie.game.world.history.filter((entry) => typeof entry[0] === 'number'); // not pieces falling
  assert.ok(holes.length > 40, `the floor crumbles: ${holes.length} holes`);
  assert.ok(
    holes.every(([, y]) => Math.abs(y - (Y - 0.25)) < 0.01),
    'in the floor',
  );
  tie.game.damage(cy, di, 1000);
  assert.deepEqual(tie.sent.find((m) => m.type === 'round' && m.state === 'over').winner, {
    id: cy.id,
    name: cy.name,
  });
});
