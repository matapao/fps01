// The juggling balls (F): what each player holds, as the server keeps it for everyone to see, and
// throwing a ball. On stand-in connections.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { Game } from '../server/game.js';
import { EYE_HEIGHT, MAX_HEALTH } from '../shared/constants.js';
import { MOVES, THROW, TRICK_SPEED } from '../shared/tricks.js';
import { PROJECTILES } from '../shared/weapons.js';

function setup() {
  const game = new Game({ protectionMs: 0 });
  const sent = [];
  game.broadcast = (message) => sent.push(message);
  const socket = {
    readyState: 1,
    OPEN: 1,
    inbox: [],
    send: (data) => socket.inbox.push(JSON.parse(data)),
    on() {},
  };
  game.join(socket);
  const ada = game.bySocket.get(socket);
  const say = (message) => game.receive(socket, JSON.stringify(message));
  return { game, ada, sent, say };
}

test('three juggling tricks, faster running with the balls out, and a ball to throw', () => {
  assert.deepEqual(MOVES, ['Cascade', 'Tower', 'Shower']);
  assert.ok(TRICK_SPEED > 1);
  assert.equal(THROW.projectile, 'ball');
  assert.ok(PROJECTILES.ball.hit.damage > 0);
});

test('everyone sees what you hold: a weapon or your juggling balls', () => {
  const { game, ada, sent, say } = setup();
  assert.equal(ada.held, 'rifle');
  say({ type: 'state', feet: ada.feet, yaw: 0, pitch: 0, held: 'trick' });
  assert.equal(ada.held, 'trick');
  say({ type: 'state', feet: ada.feet, held: 'toString' }); // no such thing
  assert.equal(ada.held, 'trick');
  game.sockets.add(ada.socket);
  game.snapshot();
  const seen = sent.findLast((m) => m.type === 'snapshot').players.find((p) => p.id === ada.id);
  assert.equal(seen.held, 'trick');
  game.spawn(ada);
  assert.equal(ada.held, 'rifle', 'a new life starts with the rifle in your hands');
});

test('the action button throws a juggling ball, one at a time: it bonks, harder in the head, and a kill with one is a Show-off', () => {
  const clock = { now: 1_000_000 };
  const game = new Game({ protectionMs: 0, now: () => clock.now, restore: { map: 'depot' } });
  const sent = [];
  game.broadcast = (message) => sent.push(message);
  const add = (feet) => {
    const socket = { readyState: 1, OPEN: 1, send() {}, on() {} };
    game.join(socket);
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
  const ada = add([-20, 0, 14.5]); // the open lane south of the trains
  const bo = add([-17, 0, 14.5]);
  // From Ada's eyes to a height on someone.
  const toward = (target, height) => {
    const offset = [
      target.feet[0] - ada.feet[0],
      target.feet[1] + height - ada.feet[1] - EYE_HEIGHT,
      target.feet[2] - ada.feet[2],
    ];
    const length = Math.hypot(...offset);
    return offset.map((v) => v / length);
  };
  const toss = (target, height) =>
    game.arsenal.fire(ada, {
      weapon: 'trick',
      feet: ada.feet,
      dir: toward(target, height),
      velocity: [0, 0, 0],
    });

  toss(bo, 1.05);
  toss(bo, 1.05); // too soon: one ball at a time
  assert.equal(game.arsenal.flying.size, 1);
  run(0.6);
  const { damage, headshot } = PROJECTILES.ball.hit;
  assert.equal(bo.hp, MAX_HEALTH - damage, 'a ball, thrown in an arc, bonks');

  bo.hp = 40;
  clock.now += THROW.cooldownMs;
  toss(bo, 1.72);
  run(0.6);
  const kill = sent.find((m) => m.type === 'kill');
  assert.ok(damage * headshot >= 40);
  assert.deepEqual([bo.alive, kill.weapon, kill.head], [false, 'ball', true], 'one in the head, harder');
  assert.ok(sent.some((m) => m.type === 'medal' && m.medal === 'showoff' && m.id === ada.id));
  assert.ok(sent.filter((m) => m.type === 'boom' && m.kind === 'ball').every((m) => m.on === bo.id));
});
