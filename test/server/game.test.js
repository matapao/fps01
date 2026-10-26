// End-to-end tests: a real server on a free port, with scripted players over real WebSockets.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { EYE_HEIGHT, MAX_HEALTH } from '../../shared/constants.js';
import { ARENA_HALF, VOID_Y } from '../../shared/map.js';
import { PROJECTILES, WEAPONS } from '../../shared/weapons.js';
import { startServer } from '../../server/index.js';

let server;
let code; // the game every test plays in…
let game; // …and the server's side of it
const Y = 0; // the floor of the Depot (Arena's), where a server starts: z = 12, along the south train, is open from x = -10 to 0
const RIFLE = WEAPONS.rifle;

before(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', respawnMs: 200, protectionMs: 0 });
  const host = await connect();
  const joined = host.next((m) => m.type === 'joined');
  host.send({ type: 'create', map: 'depot', mode: 'dm' });
  ({ code } = await joined);
  game = server.lobbies.game(code);
  host.close();
});

after(() => server.close());

const url = (path) => `http://127.0.0.1:${server.port}${path}`;

async function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  const inbox = [];
  const waiting = [];
  const player = {
    id: null,
    inbox,
    send: (message) => socket.send(JSON.stringify(message)),
    raw: (data) => socket.send(data),
    // Resolves with the next message that matches.
    next(match, ms = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for a message')), ms);
        waiting.push({
          match,
          resolve(message) {
            clearTimeout(timer);
            resolve(message);
          },
        });
      });
    },
    close: () => socket.close(),
  };
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    inbox.push(message);
    // Set the id right away: several messages can arrive in one go, and the
    // spawn that follows the welcome is matched by id.
    if (message.type === 'welcome') Object.assign(player, { id: message.id, name: message.name });
    for (const waiter of [...waiting]) {
      if (!waiter.match(message)) continue;
      waiting.splice(waiting.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return player;
}

async function join() {
  const player = await connect();
  const spawned = player.next((m) => m.type === 'spawn' && m.id === player.id);
  player.send({ type: 'join', code });
  await spawned;
  return player;
}

// Moves a player and waits until the server's snapshots show it there.
async function place(player, feet) {
  const seen = player.next(
    (m) => m.type === 'snapshot' && sameSpot(m.players.find((p) => p.id === player.id)?.feet, feet),
  );
  player.send({ type: 'state', feet, yaw: 0, pitch: 0 });
  await seen;
}

function sameSpot(a, b) {
  return Boolean(a) && a.every((value, i) => Math.abs(value - b[i]) < 1e-3);
}

// The direction from someone's eyes, standing at feet, to a point.
function aim(feet, point) {
  const dir = point.map((value, i) => value - (i === 1 ? feet[1] + EYE_HEIGHT : feet[i]));
  const length = Math.hypot(...dir);
  return dir.map((v) => v / length);
}

// Fires the rifle from the shooter's eyes towards a point, claiming a hit on target.
function shoot(shooter, feet, point, target, head = false) {
  const hits = target.id ? [{ id: target.id, head }] : [];
  shooter.send({ type: 'fire', weapon: 'rifle', feet, dir: aim(feet, point), hits });
}

// Waits for the target to see the shot, then one more snapshot, and returns the hits it got.
async function hitsAfterShot(shooter, target, fire) {
  const shot = target.next((m) => m.type === 'shot' && m.id === shooter.id);
  fire();
  const tracer = await shot;
  await target.next((m) => m.type === 'snapshot');
  return { tracer, hits: target.inbox.filter((m) => m.type === 'hit' && m.to === target.id) };
}

test('serves the game page, its scripts and three.js', async () => {
  const files = {
    '/': 'text/html',
    '/js/main.js': 'text/javascript',
    '/shared/map.js': 'text/javascript',
    '/vendor/three/three.module.js': 'text/javascript',
    '/vendor/three/three.core.js': 'text/javascript',
  };
  for (const [path, type] of Object.entries(files)) {
    const response = await fetch(url(path));
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type').startsWith(type), path);
    await response.arrayBuffer();
  }
});

test('refuses paths outside the served folders', async () => {
  assert.equal((await fetch(url('/..%2fpackage.json'))).status, 403);
  assert.equal((await fetch(url('/shared/..%2f..%2fpackage.json'))).status, 403);
  assert.equal((await fetch(url('/missing.js'))).status, 404);
});

test('joining spawns you at full health', async () => {
  const ada = await join();
  const snapshot = await ada.next((m) => m.type === 'snapshot');
  const self = snapshot.players.find((p) => p.id === ada.id);
  assert.match(self.name, /^Player [A-Z][a-z]+$/, 'named Player One, Player Two …');
  assert.deepEqual([self.name, self.hp, self.alive], [ada.name, MAX_HEALTH, true]);
  ada.close();
});

test('reported hits deal damage, six rifle shots kill, and the victim respawns', async () => {
  const shooter = await join();
  const target = await join();
  const from = [-10, Y, 12];
  await place(target, [0, Y, 12]);
  const killed = target.next((m) => m.type === 'kill' && m.victim === target.id);
  const respawned = target.next((m) => m.type === 'spawn' && m.id === target.id);

  const shots = Math.ceil(MAX_HEALTH / RIFLE.damage);
  assert.equal(shots, 6);
  for (let shot = 1; shot <= shots; shot++) {
    const hit = target.next((m) => m.type === 'hit' && m.to === target.id);
    shoot(shooter, from, [0, Y + 1, 12], target);
    assert.equal((await hit).hp, Math.max(0, MAX_HEALTH - RIFLE.damage * shot));
    await delay(RIFLE.cooldownMs + 10);
  }

  assert.equal((await killed).killer, shooter.id);
  await respawned;
  const snapshot = await shooter.next((m) => m.type === 'snapshot');
  const [s, t] = [shooter.id, target.id].map((id) => snapshot.players.find((p) => p.id === id));
  assert.deepEqual([s.kills, t.deaths, t.hp, t.alive], [1, 1, MAX_HEALTH, true]);
  shooter.close();
  target.close();
});

test('a headshot deals double damage', async () => {
  const shooter = await join();
  const target = await join();
  await place(target, [0, Y, 12]);
  const hit = target.next((m) => m.type === 'hit' && m.to === target.id);
  shoot(shooter, [-10, Y, 12], [0, Y + 1.7, 12], target, true);
  const { hp, head } = await hit;
  assert.deepEqual([hp, head], [MAX_HEALTH - RIFLE.damage * RIFLE.headshot, true]);
  shooter.close();
  target.close();
});

test('a hit claimed through a wall is rejected', async () => {
  const shooter = await join();
  const target = await join();
  await place(target, [0, Y, 28]); // behind the signal box in the south yard
  const { tracer, hits } = await hitsAfterShot(shooter, target, () => {
    shoot(shooter, [0, Y, 14], [0, Y + 1, 28], target); // through its wall at z = 21 … 21.5, under the window
  });
  assert.equal(hits.length, 0);
  assert.ok(
    Math.abs(tracer.to[2] - 21) < 1e-6,
    `tracer should stop at the signal box, ended at z = ${tracer.to[2]}`,
  );
  shooter.close();
  target.close();
});

test('a hit claimed while aiming away is rejected', async () => {
  const shooter = await join();
  const target = await join();
  await place(target, [0, Y, 12]);
  const { hits } = await hitsAfterShot(shooter, target, () => {
    shooter.send({
      type: 'fire',
      weapon: 'rifle',
      feet: [-10, Y, 12],
      dir: [-1, 0, 0],
      hits: [{ id: target.id, head: false }],
    });
  });
  assert.equal(hits.length, 0);
  shooter.close();
  target.close();
});

test('the gun cannot fire faster than its cooldown', async () => {
  const shooter = await join();
  const target = await join();
  await place(target, [0, Y, 12]);
  const { hits } = await hitsAfterShot(shooter, target, () => {
    shoot(shooter, [-10, Y, 12], [0, Y + 1, 12], target);
    shoot(shooter, [-10, Y, 12], [0, Y + 1, 12], target);
  });
  assert.equal(hits.length, 1);
  shooter.close();
  target.close();
});

test('bad messages are ignored', async () => {
  const player = await join();
  player.raw('not json');
  player.raw('null');
  player.send({ type: 'state', feet: ['x', 1, 2] });
  player.send({ type: 'fire', weapon: 'rifle', dir: [0, 0, 0] });
  player.send({ type: 'fire', weapon: 'rail', dir: [1, 0, 0] }); // not carrying one
  player.send({ type: 'fire', weapon: 'toString', dir: [1, 0, 0] });
  player.send({ type: 'fire', weapon: { toString: null, valueOf: null }, dir: [1, 0, 0] });
  player.send({ type: 'fire', weapon: 'shotgun', dir: [1, 0, 0], hits: 'lots' });
  player.send({ type: 'throw', kind: '__proto__', dir: [1, 0, 0] });
  player.send({ type: 'throw', kind: 'frag', dir: null });
  player.send({ type: 'throw', kind: 'mine', at: 'here' });
  player.send({ type: 'hook', at: [1, 'x', 2] });
  player.send({ type: 'kit', kit: 'striker' }); // there are no kits any more
  player.send({ type: 'kick', hit: player.id });
  player.send({ type: 'join', code: 'ZZZZ' }); // already in a game
  player.send({ type: 'create', map: 'fort', mode: 'dm' });
  player.send({ type: 'state', feet: [1e9, Y, 3] }); // kept within reach of the building
  const snapshot = await player.next(
    (m) => m.type === 'snapshot' && m.players.find((p) => p.id === player.id)?.feet[2] === 3,
  );
  const self = snapshot.players.find((p) => p.id === player.id);
  assert.equal(self.name, player.name);
  assert.equal(server.lobbies.list().length, 1, 'no new game');
  assert.deepEqual(self.feet, [ARENA_HALF + 60, Y, 3]); // out in space, where the void takes them
  player.close();
});

test('players who leave disappear from the game', async () => {
  const stay = await join();
  const go = await join();
  go.close();
  const snapshot = await stay.next((m) => m.type === 'snapshot' && !m.players.some((p) => p.id === go.id));
  assert.equal(
    snapshot.players.some((p) => p.id === stay.id),
    true,
  );
  stay.close();
});

// Hands someone a weapon on the server, as if they'd walked over its pad.
function arm(player, weapon) {
  const record = game.players.get(player.id);
  record.weapons.add(weapon);
  record.ammo[weapon] = WEAPONS[weapon].ammo;
}

test('a grenade launched at someone flies, explodes and kills them', async () => {
  const thrower = await join();
  const target = await join();
  await place(target, [-6, Y, 12]);
  arm(thrower, 'launcher');
  const launched = target.next((m) => m.type === 'launch' && m.id === thrower.id);
  const boom = target.next((m) => m.type === 'boom');
  const killed = target.next((m) => m.type === 'kill' && m.victim === target.id, 4000);
  const from = [-10, Y, 12];
  thrower.send({
    type: 'fire',
    weapon: 'launcher',
    feet: from,
    dir: aim(from, [-6, Y + 1.2, 12]),
    velocity: [0, 0, 0],
  });
  await launched;
  const { at } = await boom;
  assert.ok(Math.abs(at[0] - -6) < 1, `blew up at ${at}`);
  const kill = await killed;
  assert.deepEqual([kill.killer, kill.weapon], [thrower.id, 'nade']);
  thrower.close();
  target.close();
});

test('holes are shared: someone who joins later gets the same arena', async () => {
  const digger = await join();
  await place(digger, [-16, Y, -8]);
  arm(digger, 'launcher');
  const boom = digger.next((m) => m.type === 'boom', 4000);
  digger.send({
    type: 'fire',
    weapon: 'launcher',
    feet: [-16, Y, -8],
    dir: [0.6, -0.8, 0],
    velocity: [0, 0, 0],
  });
  const { at, hole } = await boom;
  assert.equal(hole, PROJECTILES.frag.blast.hole);
  const late = await join(); // someone joining later
  const world = late.inbox.find((m) => m.type === 'world') ?? (await late.next((m) => m.type === 'world'));
  assert.ok(
    world.history.some(([x, y, z, radius]) => [x, y, z].every((v, i) => v === at[i]) && radius === hole),
  );
  digger.close();
  late.close();
});

test('falling out of the bottom of the arena kills you', async () => {
  const faller = await join();
  const killed = faller.next((m) => m.type === 'kill' && m.victim === faller.id);
  faller.send({ type: 'state', feet: [-15, VOID_Y - 1, 0], yaw: 0, pitch: 0 });
  const kill = await killed;
  assert.deepEqual([kill.killer, kill.weapon], [null, 'void']);
  faller.close();
});

test('bullets chip the block they hit, and enough of them break it off', async () => {
  const shooter = await join();
  const watcher = await join();
  const from = [17.5, Y, 4.75]; // facing a box beside a stack of crates, at x = 20 … 21
  await place(shooter, from);
  const chips = [];
  for (let i = 0; i < 4; i++) {
    const chip = watcher.next((m) => m.type === 'chip');
    shoot(shooter, from, [20.5, Y + 0.5, 4.75], { id: null });
    chips.push(await chip);
    await delay(RIFLE.cooldownMs + 10);
  }
  assert.deepEqual(
    chips.map((m) => [m.wear, m.broke]),
    [
      [1, false],
      [2, false],
      [3, false],
      [0, true],
    ],
  ); // a box takes 4 hits
  assert.deepEqual(chips[0].cell, chips[3].cell);
  const late = await join(); // someone joining later
  const world = late.inbox.find((m) => m.type === 'world') ?? (await late.next((m) => m.type === 'world'));
  assert.ok(
    world.history.some(([, , , radius]) => radius < 0.1),
    'someone joining later gets the broken-off cell too',
  );
  shooter.close();
  watcher.close();
  late.close();
});
