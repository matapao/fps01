import { isRecord } from '../shared/snapshot-parts.js';
/** @typedef {import('./connections.js').LanSocket} LanSocket */
/** @typedef {import('./server-types.ts').Lobby} Lobby */
// The games on the server, each with its own map, mode, players and arena (game.js). Anyone opening
// the page sees them all, by the name each was given (Game One, Game Two …), and can join one or
// create another: whoever creates it picks its map and mode, and gets its code back, four letters to
// share (friends can type it, or open the address with it on the end: http://…/#CODE). A game
// nobody has been in for a minute closes. This is also where every browser connects, where new code
// is offered to everyone (and taken up by itself when nobody is playing), and what the next server
// picks up after an update.

import { DATA, HASH, REVISION } from '../shared/data.js';
import { MAPS } from '../shared/map.js';
import { MAX_PLAYERS, MessageBudget } from '../shared/messages.js';
import { Game } from './game.js';
import { firstFree, send, sendText } from './util.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // a code's letters: no I or O, which look like 1 and 0
const CODE = /^[A-Z]{4}$/;
const EMPTY_MS = 60_000; // how long a game nobody is in stays open
const MOST_GAMES = 16;
const LIST_EVERY_MS = 1000; // how often the browsers in the menu hear about the games, if anything changed

export class Lobbies {
  // game: options for every game (respawnMs, protectionMs). restore: what the last server had (saveState).
  /** @param {import('./server-types.ts').LobbiesOptions} options */
  constructor({
    addresses = [],
    version = null,
    now = Date.now,
    game = {},
    restore = null,
    reportMetric,
  } = {}) {
    this.addresses = addresses; // LAN URLs, shown in the menu so others know where to join
    this.version = version; // of the code this server runs, so browsers can tell when it changes
    this.now = now;
    this.options = game;
    this.reportMetric = reportMetric;
    /** @type {Map<string, Lobby>} */
    this.lobbies = new Map(); // code → { code, name, game, emptySince }
    /** @type {Set<LanSocket>} */
    this.sockets = new Set(); // every open connection
    /** @type {Map<LanSocket, Lobby>} */
    this.inGame = new Map(); // socket → the lobby it's in
    /** @type {WeakMap<LanSocket, MessageBudget>} */
    this.budgets = new WeakMap();
    this.updateReady = false; // whether newer code is waiting for the players to switch to it
    /** @type {((by: string | null) => void | Promise<void>) | null} */
    this.onUpdate = null; // set by the server when it can switch to new code: (by) => …
    this.listed = '';
    this.listedAt = 0;
    for (const saved of isRecord(restore) && Array.isArray(restore['lobbies']) ? restore['lobbies'] : []) {
      if (
        isRecord(saved) &&
        typeof saved['code'] === 'string' &&
        CODE.test(saved['code']) &&
        !this.lobbies.has(saved['code']) &&
        typeof saved['name'] === 'string'
      )
        this.open(saved['code'], saved['name'], saved);
    }
  }

  // A browser has connected: it's told what there is, and can create a game or join one.
  /** @param {LanSocket} socket */
  connect(socket) {
    this.sockets.add(socket);
    this.budgets.set(socket, new MessageBudget(this.now));
    send(socket, {
      type: 'hello',
      addresses: this.addresses,
      version: this.version,
      update: this.updateReady,
      games: this.list(),
      data: HASH,
    });
    socket.on('message', (data) => this.receive(socket, data));
    socket.on('close', () => this.disconnect(socket));
  }

  /** @param {LanSocket} socket @param {unknown} data */
  receive(socket, data) {
    const message = this.budgets.get(socket)?.read(data);
    if (!message) return;
    const lobby = this.inGame.get(socket);
    const type = message.type;
    if (type === 'ping' && Number.isFinite(message['t'])) send(socket, { type: 'pong', t: message['t'] });
    else if (type === 'update') this.requestUpdate(lobby?.game.bySocket.get(socket)?.name ?? null);
    else if (type === 'data') {
      // A browser with other data asks for the server's.
      send(
        socket,
        lobby ? lobby.game.dataMessage() : { type: 'data', hash: HASH, revision: REVISION, blocks: DATA },
      );
      socket.dataHash = lobby ? lobby.game.dataHash : HASH;
    } else if (lobby) lobby.game.handle(socket, message);
    else {
      if (typeof message['data'] === 'string') socket.dataHash = message['data'].slice(0, 40);
      if (type === 'create') this.create(socket, message);
      else if (type === 'join') this.join(socket, message);
    }
  }

  // A new game, on the map and in the mode asked for, and whoever asked goes into it.
  /** @param {LanSocket} socket @param {Record<string, unknown>} message */
  create(socket, { map, mode, token }) {
    if (typeof map !== 'string' || !Object.hasOwn(MAPS, map) || (mode !== 'dm' && mode !== 'ctf')) return;
    if (this.lobbies.size >= MOST_GAMES) {
      send(socket, { type: 'full' });
      return;
    }
    const lobby = this.open(
      this.newCode(),
      firstFree('Game', new Set([...this.lobbies.values()].map((other) => other.name))),
      { map, mode },
    );
    this.enter(socket, lobby, token);
  }

  // Into a game, by its code.
  /** @param {LanSocket} socket @param {Record<string, unknown>} message */
  join(socket, { code, token }) {
    const lobby = typeof code === 'string' ? this.lobbies.get(code.trim().toUpperCase()) : null;
    if (!lobby) {
      send(socket, { type: 'nogame', code: typeof code === 'string' ? code.slice(0, 8) : null });
      return;
    }
    this.enter(socket, lobby, token);
  }

  // The game with this code, if there is one.
  /** @param {string} code */
  game(code) {
    return this.lobbies.get(code)?.game ?? null;
  }

  /** @param {string} code @param {string} name @param {import('../shared/runtime-types.ts').RestoreInput} restore */
  open(code, name, restore) {
    const reportMetric = this.reportMetric;
    const lobby = {
      code,
      name,
      game: new Game({
        ...this.options,
        now: this.now,
        restore,
        reportMetric: reportMetric
          ? (name, value, labels) => reportMetric(code, name, value, labels)
          : undefined,
      }),
      emptySince: this.now(),
    };
    this.lobbies.set(code, lobby);
    return lobby;
  }

  /** @param {LanSocket} socket @param {Lobby} lobby @param {unknown} token */
  enter(socket, lobby, token) {
    if (lobby.game.players.size >= MAX_PLAYERS) {
      send(socket, { type: 'full', scope: 'players' });
      return;
    }
    this.inGame.set(socket, lobby);
    send(socket, {
      type: 'joined',
      code: lobby.code,
      name: lobby.name,
      map: lobby.game.map,
      mode: lobby.game.mode,
    });
    lobby.game.add(socket);
    lobby.game.join(socket, token);
    this.listedAt = 0; // everyone in the menu sees who's in it now
  }

  newCode() {
    for (;;) {
      const code = Array.from({ length: 4 }, () =>
        LETTERS.charAt(Math.floor(Math.random() * LETTERS.length)),
      ).join('');
      if (!this.lobbies.has(code)) return code;
    }
  }

  /** @param {LanSocket} socket */
  disconnect(socket) {
    this.sockets.delete(socket);
    const lobby = this.inGame.get(socket);
    this.inGame.delete(socket);
    if (lobby) {
      lobby.game.disconnect(socket);
      this.listedAt = 0;
    }
    if (this.updateReady && this.playing() === 0) this.onUpdate?.(null);
  }

  // The games, as the menu lists them.
  list() {
    return [...this.lobbies.values()].map(({ code, name, game }) => ({
      code,
      name,
      map: game.map,
      mode: game.mode,
      players: [...game.players.values()].map((player) => player.name),
    }));
  }

  playing() {
    let count = 0;
    for (const { game } of this.lobbies.values()) count += game.players.size;
    return count;
  }

  // Every tick: every game moves on and tells its players; a game empty for long enough closes; and
  // the browsers in the menu hear about any change in the games.
  /** @param {number} dt */
  tick(dt) {
    const now = this.now();
    for (const lobby of [...this.lobbies.values()]) {
      if (lobby.game.players.size > 0) lobby.emptySince = now;
      else if (now - lobby.emptySince > EMPTY_MS && lobby.game.sockets.size === 0) {
        lobby.game.stop();
        this.lobbies.delete(lobby.code);
        continue;
      }
      lobby.game.tick(dt);
      lobby.game.snapshot();
    }
    if (now - this.listedAt < LIST_EVERY_MS) return;
    this.listedAt = now;
    const games = this.list();
    const listed = JSON.stringify(games);
    if (listed === this.listed) return;
    this.listed = listed;
    for (const socket of this.sockets) if (!this.inGame.has(socket)) send(socket, { type: 'games', games });
  }

  // ---------- Updates ----------

  // Newer code is waiting, or not any more. The players choose when to switch, unless nobody is playing.
  /** @param {boolean} ready */
  offerUpdate(ready) {
    this.updateReady = ready;
    this.broadcast({ type: 'update', ready });
    if (ready && this.playing() === 0) this.onUpdate?.(null);
  }

  /** @param {string | null} by */
  requestUpdate(by) {
    if (this.updateReady) this.onUpdate?.(by);
  }

  // Every game, with everyone's score, for the next server to pick up.
  saveState() {
    return {
      lobbies: [...this.lobbies.values()].map(({ code, name, game }) => ({
        code,
        name,
        ...game.saveState(),
      })),
    };
  }

  /** @param {unknown} message */
  broadcast(message) {
    const data = JSON.stringify(message);
    for (const socket of this.sockets) sendText(socket, data);
  }

  stop() {
    for (const { game } of this.lobbies.values()) game.stop();
  }
}
