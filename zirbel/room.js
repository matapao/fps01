// fps01 on zirbel: one zirbel room is one game. This is the room's authority, in place of
// server/lobbies.js: a zirbel host runs it headless (authority.js), and a player's page runs it while
// that player is the room's host (public/js/transport.js). Every seat in the room gets a socket-like
// object that carries the game's own JSON messages over zirbel-net's reliable lane, in order, like the
// WebSocket the game was written for; snapshots and pages' states go as bytes, to and from a page
// that reads them (shared/wire.js). Everything else is the game's own server code.
//
// A seat is a player, with the name the hub gives it (Player One, Bot One …): the hub keeps the seat
// across a reload, so it keeps its name, colour and score, and it keeps them when a new authority
// takes over from what its page saw.
//
// The room plays by the data of the revision it follows (data/*.json, read through zirbel-net's
// net.data() where the host has it, or else the data bundled in), and by a newer revision from the
// next round on. Every page gets the room's data from here when its own is different, so every
// screen plays by the same.

import { isRecord } from '../shared/snapshot-parts.js';
import { isGameData } from '../shared/check.js';
import { SERVER, playerName } from '/zirbel-net.js';
import { MODES, TICK_RATE } from '../shared/constants.js';
import { DATA, HASH, REVISION, readData } from '../shared/data.js';
import { reader } from './data-reader.js';
import { MAPS } from '../shared/map.js';
import { MAX_PLAYERS, MessageBudget } from '../shared/messages.js';
import { SNAPSHOT, STATE, SnapshotWriter, readState } from '../shared/wire.js';
import { Game } from '../server/game.js';

const OPEN = 1;
const CLOSED = 3;
// The zirbel-net message types the game's JSON travels in, one for each way (see transport.js);
// snapshots and pages' states travel as bytes (shared/wire.js: SNAPSHOT, STATE), between an
// authority and a page that both read them: the authority says so in its hello, and the page
// answers { type: 'wire' }. A page of a version before them gets the JSON, and its JSON is taken.
const UP = 1; // a page to the authority
const DOWN = 2; // the authority to a page
const LIST_EVERY_MS = 1000; // how often seats not yet in the game hear who's in it, if that changed
const VERSION = 'zirbel'; // what the page compares across reloads: this host's version is the room's
// What the game's server code needs from a socket: readyState, OPEN and send(); and, as a seat,
// its own way with snapshots and what only its player needs: as little as it can, as bytes where
// its page reads them. What a seat whose link is down misses, the snapshots, it's told when it's
// back: what changed since the last it had. Everything else waits for it at the hub, so the page's
// arena stays the authority's.
class Seat {
  /** @param {import('/zirbel-net.js').GameNet} net @param {number} id */
  constructor(net, id) {
    this.net = net;
    this.id = id;
    this.seat = id; // in snapshots, so a page can tell a new authority who had which score
    this.label = ''; // what the hub calls the seat
    this.readyState = OPEN;
    this.OPEN = OPEN;
    this.bufferedAmount = 0;
    /** @type {string | undefined} */
    this.dataHash = undefined;
    this.inGame = false;
    this.away = false; // its link is down: zirbel-net is bringing it back
    this.wire = false; // its page reads snapshots as bytes (it said so)
    this.snapshots = new SnapshotWriter();
    /** @type {string | null} */
    this.selfSent = null; // the last of what only its player needs, as sent
    this.budget = new MessageBudget();
  }

  /** @param {unknown} data */
  send(data) {
    if (this.readyState === OPEN) this.net.send(this.id, DOWN, String(data));
  }

  // A snapshot: what changed since the last one this seat was sent, as bytes; or, to a page that
  // doesn't read them, its JSON (text).
  /** @param {import('../shared/runtime-types.ts').Snapshot} snapshot @param {() => string} [text] */
  snapshot(snapshot, text = () => JSON.stringify(snapshot)) {
    if (this.readyState !== OPEN || this.away) return;
    if (!this.wire) return this.send(text());
    const bytes = this.snapshots.write(snapshot, this.id);
    if (bytes) this.net.send(this.id, SNAPSHOT, bytes);
  }

  // What only its player needs (weapons, ammo, special, powerup), when it changes: the powerup's time
  // left to the second.
  /** @param {import('../shared/runtime-types.ts').SelfMessage} message */
  self(message) {
    if (this.readyState !== OPEN || this.away) return;
    const text = JSON.stringify(
      message['powerup']
        ? {
            ...message,
            powerup: { ...message['powerup'], ms: Math.ceil(message['powerup'].ms / 1000) * 1000 },
          }
        : message,
    );
    if (text === this.selfSent) return;
    this.selfSent = text;
    this.send(text);
  }

  // The page starts again: the next snapshot and the next of its own are whole, as JSON until it
  // says it reads bytes.
  restart() {
    this.wire = false;
    this.snapshots.reset();
    this.selfSent = null;
  }

  terminate() {
    this.close();
  }

  close() {
    this.readyState = CLOSED;
  }
}

// The token the game keeps a player's score under: their seat's, which outlasts a reload.
/** @param {number} id */
export const seatToken = (id) => `5ea7${id.toString(16).padStart(4, '0')}`;

// net: the room's connection (a GameNet). seed: what a page saw of the game, for an authority that
// takes over from another to go on from: { map, mode, history, water, planets, players: [{ seat,
// name, color, kills, deaths }] }. base: where the game's own files are, for reading its data where
// zirbel-net can't (a page). Returns { stop }.
/** @param {import('/zirbel-net.js').GameNet} net @param {import('/zirbel-net.js').RoomInfo} room @param {{seed?: unknown, base?: string | null}} [options] */
export default function langame(net, room, { seed = null, base = null } = {}) {
  /** @type {Map<number, Seat>} */
  const seats = new Map(); // seat number → Seat
  // The data the room plays by: what's in force here until the revision's own is read.
  let data = { data: DATA, hash: HASH, revision: REVISION };
  /** @type {Promise<void> | null} */
  let loading = null; // reading a revision's data: games wait for it to start
  let stopped = false;
  /** @type {NonNullable<import('../shared/runtime-types.ts').GameOptions['reportMetric']>} */
  const reportMetric = (name, value, labels) => net.metric?.(name, value, labels);
  let game = seeded(seed, data, reportMetric);
  let listed = '';
  let listedAt = 0;

  /** @param {Seat} seat @param {unknown} message */
  const say = (seat, message) => seat.send(JSON.stringify(message));
  // The room's one game, as the menu lists games.
  const list = () =>
    game
      ? [
          {
            code: room.room,
            name: 'Game One',
            map: game.map,
            mode: game.mode,
            players: [...game.players.values()].map((p) => p['name']),
          },
        ]
      : [];
  const current = () => (game ? { data: game.data, hash: game.dataHash, revision: game.revision } : data);
  // back: the seat was in the game when its page started again (a reload), so the page goes back in.
  /** @param {Seat} seat @param {boolean} [back] */
  const greet = (seat, back = false) =>
    say(seat, {
      type: 'hello',
      addresses: [],
      version: VERSION,
      update: false,
      games: list(),
      data: current().hash,
      wire: 1,
      ...(back ? { back } : {}),
    });

  // A revision's data, read and checked: games start with it, and the one going on takes it at its
  // next round. Data that doesn't check is left alone: the room goes on with what it has.
  /** @param {string} revision */
  function load(revision) {
    const read = readData(reader(net, base, revision))
      .then(({ data: blocks, hash, problems }) => {
        if (stopped || loading !== read || problems.length || !isGameData(blocks)) return;
        data = { data: blocks, hash, revision: revision ?? net.revision?.id ?? '' };
        game?.offer(data);
      })
      .catch(() => {});
    loading = read;
    read.then(() => {
      if (loading === read) loading = null;
    });
  }
  if (net.revision?.id && typeof net.data === 'function') load(net.revision.id);
  /** @param {import('/zirbel-net.js').Revision} rev */
  const onRevision = (rev) => {
    if (rev && !rev.engine && typeof rev.id === 'string') load(rev.id);
  };
  net.on('revision', onRevision);

  // A seat comes in, with what the hub calls it (Player One, Bot Two…): nobody chooses a name.
  /** @param {number} id @param {string} [label] */
  function arrive(id, label = '') {
    if (id === SERVER || seats.has(id)) return null;
    const seat = new Seat(net, id);
    if (typeof label === 'string') seat.label = label.slice(0, 40);
    seats.set(id, seat);
    return seat;
  }

  /** @param {Seat} seat */
  function enter(seat) {
    if (!game) throw new Error('Active seat requires a game');
    if (game.players.size >= MAX_PLAYERS) return say(seat, { type: 'full', scope: 'players' });
    seat.inGame = true;
    say(seat, { type: 'joined', code: room.room, name: 'Game One', map: game.map, mode: game.mode });
    game.add(seat);
    game.join(seat, seatToken(seat.id), seat.label || playerName(seat.id), seat.id);
    listedAt = 0;
  }

  // A page has started (a reload, or the first time): out of the game, if its seat was in it,
  // keeping its score, and told what there is. It comes back in when it asks.
  /** @param {Seat} seat */
  function restart(seat) {
    const back = seat.inGame;
    if (seat.inGame) {
      seat.inGame = false;
      game?.disconnect(seat);
    }
    seat.restart();
    greet(seat, back);
    listedAt = 0;
  }

  /** @param {Seat} seat @param {unknown} text */
  function receive(seat, text) {
    const message = seat.budget.read(text);
    if (!message) return;
    handle(seat, message);
  }

  /** @param {Seat} seat @param {Record<string, unknown> & {type: string}} message */
  function handle(seat, message) {
    if (stopped || seats.get(seat.id) !== seat) return;
    const type = message['type'];
    if (type === 'ping' && Number.isFinite(message['t'])) say(seat, { type: 'pong', t: message['t'] });
    else if (type === 'hello') restart(seat);
    else if (type === 'wire') {
      // Its page reads snapshots as bytes: from the next one, whole.
      seat.wire = true;
      seat.snapshots.reset();
    } else if (type === 'update')
      return; // a zirbel host updates games from its catalog, not here
    else if (type === 'data') {
      // A page with other data asks for the room's.
      const { data: blocks, hash, revision } = current();
      say(seat, { type: 'data', hash, revision, blocks });
      seat.dataHash = hash;
    } else if (seat.inGame && game) game.handle(seat, message);
    else if ((type === 'create' || type === 'join') && loading) loading.then(() => handle(seat, message));
    else if (type === 'create') {
      if (typeof message['data'] === 'string') seat.dataHash = message['data'].slice(0, 40);
      // Whoever comes first picks the map and the mode; anyone later just joins.
      if (!game) {
        if (
          typeof message['map'] !== 'string' ||
          !Object.hasOwn(MAPS, message['map']) ||
          (message['mode'] !== 'dm' && message['mode'] !== 'ctf') ||
          !MODES.includes(message['mode'])
        )
          return;
        game = new Game({
          now: Date.now,
          restore: { map: message['map'], mode: message['mode'] },
          data,
          reportMetric,
        });
      }
      enter(seat);
    } else if (type === 'join') {
      if (typeof message['data'] === 'string') seat.dataHash = message['data'].slice(0, 40);
      if (game) enter(seat);
      else say(seat, { type: 'nogame', code: room.room });
    }
  }

  // Gone for good: out of the game, and its score with it, so whoever gets the seat next starts afresh.
  /** @param {number} id */
  function leave(id) {
    const seat = seats.get(id);
    seats.delete(id);
    if (!seat) return;
    seat.close();
    if (seat.inGame) game?.disconnect(seat);
    game?.forget(seatToken(id));
    listedAt = 0;
  }

  /** @type {import('/zirbel-net.js').GameEvents['message']} */
  const onMessage = (from, type, r) => {
    const seat = seats.get(from);
    if (!seat) return;
    if (type === UP) receive(seat, r.text());
    else if (type === STATE && seat.inGame && game) {
      if (!seat.budget.take()) return;
      let state;
      try {
        state = readState(r.rest());
      } catch {
        return; // not a state
      }
      game.handle(seat, state);
    }
  };
  /** @param {number} id */
  const away = (id) => {
    const seat = seats.get(id);
    if (seat) seat.away = true;
  };
  /** @param {number} id */
  const back = (id) => {
    const seat = seats.get(id);
    if (seat) seat.away = false;
  };
  net.on('peer', arrive);
  net.on('leave', leave);
  net.on('away', away);
  net.on('back', back);
  net.on('message', onMessage);

  // Everyone here already: the room's seats, and this page's own when a player's page runs it. A new
  // authority greets them all, so pages that were in the game come back into it.
  for (const [id, label] of net.peers) arrive(id, label);
  if (!net.local) arrive(net.id, net.name);
  if (game) for (const seat of seats.values()) greet(seat);

  // Every tick the game moves on and tells its players; once a second, seats still in the menu
  // hear who's in it.
  const timer = setInterval(() => {
    if (game) {
      game.tick(1 / TICK_RATE);
      game.snapshot();
    }
    const now = Date.now();
    if (now - listedAt < LIST_EVERY_MS) return;
    listedAt = now;
    const games = list();
    const key = JSON.stringify(games);
    if (key === listed) return;
    listed = key;
    for (const seat of seats.values()) if (!seat.inGame) say(seat, { type: 'games', games });
  }, 1000 / TICK_RATE);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    net
      .off('peer', arrive)
      .off('leave', leave)
      .off('away', away)
      .off('back', back)
      .off('message', onMessage)
      .off('revision', onRevision)
      .off('close', stop);
    for (const seat of seats.values()) seat.close();
    game?.stop();
  }
  net.on('close', stop);
  return { stop };
}

// The game a new authority goes on with: the map and mode, the arena as it was, and everyone's name,
// colour and score, by seat. Null without a usable seed.
/** @param {unknown} seed @param {import('../shared/runtime-types.ts').DataRevision} data @param {NonNullable<import('../shared/runtime-types.ts').GameOptions['reportMetric']>} reportMetric */
function seeded(seed, data, reportMetric) {
  if (
    !isRecord(seed) ||
    typeof seed['map'] !== 'string' ||
    !Object.hasOwn(MAPS, seed['map']) ||
    (seed['mode'] !== 'dm' && seed['mode'] !== 'ctf') ||
    !MODES.includes(seed['mode'])
  )
    return null;
  const players = (Array.isArray(seed['players']) ? seed['players'] : [])
    .filter(
      (p) =>
        isRecord(p) &&
        typeof p['seat'] === 'number' &&
        Number.isInteger(p['seat']) &&
        p['seat'] > 0 &&
        p['seat'] < SERVER,
    )
    .flatMap((p) => {
      if (!isRecord(p) || typeof p['seat'] !== 'number') return [];
      return [
        {
          token: seatToken(p['seat']),
          name: typeof p['name'] === 'string' ? p['name'].slice(0, 40) : '',
          color: typeof p['color'] === 'string' ? p['color'].slice(0, 40) : '',
          kills: count(p['kills']),
          deaths: count(p['deaths']),
        },
      ];
    });
  return new Game({
    now: Date.now,
    reportMetric,
    restore: {
      map: seed['map'],
      mode: seed['mode'],
      players,
      history: seed['history'],
      water: seed['water'],
      planets: seed['planets'],
    },
    data,
  });
}

/** @param {unknown} n */
const count = (n) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? Math.min(n, 9999) : 0);
