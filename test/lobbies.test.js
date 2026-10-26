// The games on a server (server/lobbies.js): creating one, with a code to share, joining one, the list
// everyone in the menu sees, the names everyone gets, closing empty games, and updates. On a fake
// clock, with stand-in connections.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { HASH } from '../shared/data.js';
import { MAX_PLAYERS } from '../shared/messages.js';
import { Lobbies } from '../server/lobbies.js';

function setup() {
  const clock = { now: 1_000_000 };
  const lobbies = new Lobbies({ now: () => clock.now, addresses: ['http://10.0.0.5:7777'] });
  const browser = () => {
    const socket = {
      readyState: 1,
      OPEN: 1,
      inbox: [],
      handlers: {},
      send: (data) => socket.inbox.push(JSON.parse(data)),
      on: (event, handler) => (socket.handlers[event] = handler),
    };
    lobbies.connect(socket);
    socket.say = (message) => lobbies.receive(socket, JSON.stringify(message));
    socket.last = (type) => socket.inbox.findLast((m) => m.type === type);
    socket.close = () => socket.handlers.close();
    return socket;
  };
  const tick = (seconds) => {
    for (let t = 0; t < seconds; t += 0.5) {
      clock.now += 500;
      lobbies.tick(0.5);
    }
  };
  return { clock, lobbies, browser, tick };
}

test('a full LAN game rejects another player without claiming they joined', () => {
  const { lobbies, browser } = setup();
  const first = browser();
  first.say({ type: 'create', map: 'depot', mode: 'dm' });
  const { code } = first.last('joined');
  for (let i = 1; i < MAX_PLAYERS; i++) browser().say({ type: 'join', code });
  const extra = browser();
  extra.say({ type: 'join', code });
  assert.deepEqual(extra.last('full'), { type: 'full', scope: 'players' });
  assert.equal(extra.last('joined'), undefined);
  assert.equal(lobbies.game(code).players.size, MAX_PLAYERS);
  lobbies.stop();
});

test('anyone can create a game: on the map and in the mode they picked, with a name and a code to share', () => {
  const { lobbies, browser } = setup();
  const ada = browser();
  assert.deepEqual(ada.last('hello'), {
    type: 'hello',
    addresses: ['http://10.0.0.5:7777'],
    version: null,
    update: false,
    games: [],
    data: HASH,
  });
  ada.say({ type: 'create', map: 'canal', mode: 'ctf', token: 'aaaa1111' });
  const joined = ada.last('joined');
  assert.match(joined.code, /^[A-HJ-NP-Z]{4}$/, 'four letters, no I or O');
  assert.deepEqual([joined.name, joined.map, joined.mode], ['Game One', 'canal', 'ctf']);
  const game = lobbies.game(joined.code);
  assert.deepEqual([game.map, game.mode, game.players.size], ['canal', 'ctf', 1]);
  assert.ok(ada.inbox.some((m) => m.type === 'world' && m.map === 'canal'));
  assert.equal(ada.last('welcome').name, 'Player One');
  const bo = browser();
  bo.say({ type: 'create', map: 'nowhere', mode: 'dm' });
  bo.say({ type: 'create', map: 'fort', mode: 'tag' });
  bo.say({ type: 'create', map: '__proto__', mode: 'dm' });
  assert.equal(lobbies.list().length, 1, 'no such map or mode: no game');
  bo.say({ type: 'create', map: 'fort', mode: 'dm' });
  assert.equal(bo.last('joined').name, 'Game Two');
  assert.notEqual(bo.last('joined').code, joined.code);
});

test('anyone can join a game by its code, and everyone in the menu sees the games and who is in them', () => {
  const { lobbies, browser, tick } = setup();
  const ada = browser();
  ada.say({ type: 'create', map: 'depot', mode: 'dm' });
  const { code } = ada.last('joined');
  const looking = browser();
  assert.deepEqual(looking.last('hello').games, [
    { code, name: 'Game One', map: 'depot', mode: 'dm', players: ['Player One'] },
  ]);
  looking.say({ type: 'join', code: 'QQQQ' });
  assert.deepEqual(looking.last('nogame'), { type: 'nogame', code: 'QQQQ' });
  const bo = browser();
  bo.say({ type: 'join', code: code.toLowerCase() });
  assert.equal(bo.last('joined').code, code);
  assert.equal(bo.last('welcome').name, 'Player Two');
  tick(1.5);
  assert.deepEqual(looking.last('games').games[0].players, ['Player One', 'Player Two']);
  assert.ok(!ada.inbox.some((m) => m.type === 'games'), 'those playing are not bothered with it');
  bo.say({ type: 'create', map: 'fort', mode: 'dm' });
  bo.say({ type: 'join', code: 'QQQQ' });
  assert.equal(lobbies.list().length, 1, 'once in a game, creating or joining another does nothing');
  assert.equal(lobbies.game(code).players.size, 2);
});

test('a name stays free for whoever left for a while, then goes to someone new', () => {
  const { clock, lobbies, browser } = setup();
  const ada = browser();
  ada.say({ type: 'create', map: 'depot', mode: 'dm', token: 'aaaa1111' });
  const { code } = ada.last('joined');
  const bo = browser();
  bo.say({ type: 'join', code, token: 'bbbb2222' });
  ada.close();
  const cy = browser();
  cy.say({ type: 'join', code, token: 'cccc3333' });
  assert.equal(cy.last('welcome').name, 'Player Three', 'not Player One: Ada may be back');
  const back = browser();
  back.say({ type: 'join', code, token: 'aaaa1111' });
  assert.equal(back.last('welcome').name, 'Player One', 'and she is');
  back.close();
  clock.now += 5 * 60_000;
  const di = browser();
  di.say({ type: 'join', code, token: 'dddd4444' });
  assert.equal(di.last('welcome').name, 'Player One', 'long gone: someone new gets the name');
  assert.deepEqual(
    [...lobbies.game(code).players.values()].map((p) => p.name),
    ['Player Two', 'Player Three', 'Player One'],
  );
});

test('a game nobody has been in for a minute closes', () => {
  const { lobbies, browser, tick } = setup();
  const ada = browser();
  ada.say({ type: 'create', map: 'fort', mode: 'dm' });
  const { code } = ada.last('joined');
  tick(90);
  assert.ok(lobbies.game(code), 'open while someone plays');
  ada.close();
  tick(30);
  assert.ok(lobbies.game(code), 'open for a while after they leave');
  tick(40);
  assert.equal(lobbies.game(code), null);
  const late = browser();
  late.say({ type: 'join', code });
  assert.equal(late.last('nogame').code, code);
});

test('new code is offered to everyone, and taken up by itself when nobody is playing', () => {
  const { lobbies, browser } = setup();
  const updates = [];
  lobbies.onUpdate = (by) => updates.push(by);
  const looking = browser();
  const ada = browser();
  ada.say({ type: 'create', map: 'depot', mode: 'dm' });
  lobbies.offerUpdate(true);
  assert.deepEqual(
    [looking.last('update'), ada.last('update')],
    [
      { type: 'update', ready: true },
      { type: 'update', ready: true },
    ],
  );
  assert.deepEqual(updates, [], 'someone is playing: they choose when');
  looking.say({ type: 'update' });
  ada.say({ type: 'update' });
  assert.deepEqual(updates, [null, 'Player One']);
  updates.length = 0;
  ada.close();
  assert.deepEqual(updates, [null], 'the last one out: it goes ahead');
});
