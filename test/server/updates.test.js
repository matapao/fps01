// Updating while people play. The first tests cover names and scores carrying over, and the games
// themselves; the last runs the real supervisor (what npm start runs) on a copy of the game and
// edits the copy's code.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Game } from '../../server/game.js';
import { Lobbies } from '../../server/lobbies.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const fakeSocket = () => ({ readyState: 1, OPEN: 1, send() {}, on() {} });
const score = (player) => [player.name, player.kills, player.deaths, player.color];

test('your name, score and colour follow your browser tab across a reload and into the next server', () => {
  const game = new Game();
  game.broadcast = () => {};
  const first = fakeSocket();
  game.join(first, 'aaaa1111');
  const ada = game.bySocket.get(first);
  Object.assign(ada, { kills: 3, deaths: 1 });
  game.disconnect(first);
  const reloaded = fakeSocket();
  game.join(reloaded, 'aaaa1111');
  assert.deepEqual(score(game.bySocket.get(reloaded)), ['Player One', 3, 1, ada.color]);
  game.bySocket.get(reloaded).kills = 4;

  const next = new Game({ restore: game.saveState() });
  next.broadcast = () => {};
  const bo = fakeSocket();
  next.join(bo, 'bbbb2222'); // someone new, first in: gets a name and a colour nobody is coming back for
  const again = fakeSocket();
  next.join(again, 'aaaa1111');
  assert.deepEqual(score(next.bySocket.get(again)), ['Player One', 4, 1, ada.color]);
  assert.equal(next.bySocket.get(bo).name, 'Player Two');
  assert.notEqual(next.bySocket.get(bo).color, ada.color);

  const twin = fakeSocket();
  next.join(twin, 'aaaa1111'); // a duplicated tab starts fresh
  assert.deepEqual(score(next.bySocket.get(twin)).slice(0, 3), ['Player Three', 0, 0]);
  const stranger = fakeSocket();
  next.join(stranger, 'not a token');
  assert.equal(next.bySocket.get(stranger).token, null);
});

test('the games carry over into the next server: their codes, names, maps, modes and players', () => {
  const lobbies = new Lobbies();
  const socket = fakeSocket();
  lobbies.connect(socket);
  lobbies.receive(socket, JSON.stringify({ type: 'create', map: 'fort', mode: 'ctf', token: 'aaaa1111' }));
  const [{ code }] = lobbies.list();
  lobbies.game(code).bySocket.get(socket).kills = 2;
  const next = new Lobbies({ restore: JSON.parse(JSON.stringify(lobbies.saveState())) });
  assert.deepEqual(next.list(), [{ code, name: 'Game One', map: 'fort', mode: 'ctf', players: [] }]);
  const back = fakeSocket();
  next.connect(back);
  next.receive(back, JSON.stringify({ type: 'join', code, token: 'aaaa1111' }));
  assert.deepEqual(score(next.game(code).bySocket.get(back)).slice(0, 2), ['Player One', 2]);
  assert.deepEqual(
    new Lobbies({ restore: { players: [], map: 'thermae' } }).list(),
    [],
    'a server from before there were games: none',
  );
});

test(
  'npm start offers new code to the players, and switches everyone over when one of them asks',
  { timeout: 120_000 },
  async (t) => {
    // A copy of the game to edit, sharing node_modules.
    const dir = await mkdtemp(join(tmpdir(), 'langame-update-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    for (const part of ['package.json', 'server', 'shared', 'public', 'data', 'src'])
      await cp(join(ROOT, part), join(dir, part), { recursive: true });
    await symlink(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');

    const supervisor = spawn(process.execPath, ['server/run.js'], {
      cwd: dir,
      env: { ...process.env, PORT: '0' },
    });
    t.after(() => supervisor.kill());
    let output = '';
    supervisor.stdout.on('data', (chunk) => (output += chunk));
    supervisor.stderr.on('data', (chunk) => (output += chunk));
    const said = (text) => until(() => output.includes(text), `the server to say "${text}"`);
    await until(() => /localhost:\d+/.test(output), 'the server to start').catch((error) => {
      error.message += `\nCaptured server output:\n${output}`;
      throw error;
    });
    const port = Number(output.match(/localhost:(\d+)/)[1]);
    const get = (path) => fetch(`http://127.0.0.1:${port}${path}`).then((response) => response.text());

    const ada = await enter(port, 'aaaa1111');
    const bo = await enter(port, 'bbbb2222', ada.joined.code);
    const before = ada.hello.version;
    const colours = { ada: ada.welcome.color, bo: bo.welcome.color };

    // A change, plus a mistake: the broken version is never offered.
    const constants = join(dir, 'shared/constants.js');
    const original = await readFile(constants, 'utf8');
    const gameFile = join(dir, 'server/game.js');
    const gameCode = await readFile(gameFile, 'utf8');
    await appendFile(constants, '\n// tweaked\n');
    await appendFile(gameFile, '\n}{\n');
    await said("isn't offered");
    assert.equal(await get('/shared/constants.js'), original, 'browsers still get the files the server runs');
    assert.ok(!ada.inbox.some((m) => m.type === 'update' && m.ready));

    // Fixed: now it's offered, and Ada takes it.
    const offered = ada.next((m) => m.type === 'update' && m.ready);
    await writeFile(gameFile, gameCode);
    await offered;
    const notices = [ada, bo].map((player) => player.next((m) => m.type === 'updating'));
    ada.send({ type: 'update' });
    assert.deepEqual(
      (await Promise.all(notices)).map((m) => m.by),
      ['Player One', 'Player One'],
    );
    assert.deepEqual(await Promise.all([ada.closed, bo.closed]), [1012, 1012]);
    await said('Player One pressed Update');

    // Everyone comes back to the new version, in the same game, and keeps their name and colour even
    // when rejoining in another order.
    const boAgain = await until(
      () => enter(port, 'bbbb2222', ada.joined.code).catch(() => null),
      'the new server to come up',
    );
    const adaAgain = await enter(port, 'aaaa1111', ada.joined.code);
    assert.notEqual(boAgain.hello.version, before);
    assert.equal(boAgain.hello.update, false);
    assert.deepEqual({ ada: adaAgain.welcome.color, bo: boAgain.welcome.color }, colours);
    assert.deepEqual([adaAgain.welcome.name, boAgain.welcome.name], ['Player One', 'Player Two']);
    assert.ok((await get('/shared/constants.js')).includes('// tweaked'));

    // With nobody playing, a new version goes live by itself.
    const current = boAgain.hello.version;
    adaAgain.close();
    boAgain.close();
    await appendFile(join(dir, 'src/game-metrics.ts'), '\n// tweaked runtime\n');
    await until(async () => {
      const visitor = await connect(port).catch(() => null);
      visitor?.close();
      return visitor && visitor.hello.version !== current;
    }, 'the update with nobody playing');
    await said('nobody was playing');

    // Stopping the supervisor stops the game server too.
    supervisor.kill();
    await until(async () => !(await connect(port).catch(() => null)), 'the game server to stop');
  },
);

// Calls check until it returns something truthy, and returns that.
async function until(check, what, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function connect(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiting = [];
  const client = {
    inbox,
    send: (message) => socket.send(JSON.stringify(message)),
    // Resolves with the next message that matches.
    next(match, ms = 30_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for a message')), ms);
        waiting.push({ match, resolve: (message) => (clearTimeout(timer), resolve(message)) });
      });
    },
    closed: new Promise((resolve) => socket.addEventListener('close', (event) => resolve(event.code))),
    close: () => socket.close(),
  };
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    inbox.push(message);
    for (const waiter of [...waiting]) {
      if (!waiter.match(message)) continue;
      waiting.splice(waiting.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect')), { once: true });
  });
  client.hello = inbox.find((m) => m.type === 'hello') ?? (await client.next((m) => m.type === 'hello'));
  return client;
}

// Into a game: the one with this code, or a new one.
async function enter(port, token, code = null) {
  const client = await connect(port);
  const joined = client.next((m) => m.type === 'joined');
  const welcome = client.next((m) => m.type === 'welcome');
  client.send(code ? { type: 'join', code, token } : { type: 'create', map: 'depot', mode: 'dm', token });
  client.joined = await joined;
  client.welcome = await welcome;
  return client;
}
