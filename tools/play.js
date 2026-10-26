import { indexed } from '../shared/indexed.js';
/** @typedef {import('/zirbel-net.js').Connection} Connection */
/** @typedef {import('../src/agent/play.ts').PlaySession} PlaySession */
/** @typedef {ReturnType<PlaySession['observe']>} Observation */
/** @typedef {import('../shared/contracts.ts').Vector3} Vector3 */
// Plays fps01 as an agent would, through the play adapter (src/agent/play.ts), as a seat on a
// zirbel hub: a small scripted player that observes four times a second and acts on what it sees
// (engage whoever it can see, else go to the nearest pickup, else look round). Until the
// platform's MCP runtime drives the adapter, this is how to watch it play.
//
//   node tools/play.js --url ws://127.0.0.1:7777/mp --room TEST --net ../zirbel.gg/packages/net/src/index.ts
//     [--agents 2] [--hunt] [--seconds 20] [--record test/fixtures/play-session.json] [--quiet]
//
// --net: zirbel-net's source (from a zirbel checkout), for a seat outside a browser.
// --agents: how many seats play, each its own session (they fight each other).
// --hunt: each runs to where another is when it can't see anyone (this script knows; they don't).
// --record: what the room said to the first seat (the first of each kind of message, and a snapshot
// now and then, as the JSON its bytes stand for), for the adapter's tests.
//
// At the end it says what each seat saw and did, and what it cost on the wire (joining too).

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { SNAPSHOT, SnapshotReader } from '../shared/wire.js';

const { values: o } = parseArgs({
  options: {
    url: { type: 'string' },
    room: { type: 'string', default: 'AGENT' },
    net: { type: 'string' },
    seconds: { type: 'string', default: '20' },
    agents: { type: 'string', default: '1' },
    hunt: { type: 'boolean' },
    record: { type: 'string' },
    quiet: { type: 'boolean' },
    game: { type: 'string', default: 'fps01' },
  },
});
if (!o.url || !o.net) {
  console.error(
    'usage: node tools/play.js --url ws://127.0.0.1:7777/mp --room TEST --net <zirbel>/packages/net/src/index.ts',
  );
  process.exit(2);
}
const url = o.url;
/** @type {{connect: typeof import('/zirbel-net.js').connect}} */
const { connect } = await import(pathToFileURL(resolve(o.net)).href);
const adapter = (await import('../src/agent/play.ts')).default;
/** @param {unknown[]} args */
const log = (...args) =>
  !o.quiet && console.log(`${(performance.now() / 1000).toFixed(1).padStart(6)}s`, ...args);

// One seat: a connection, a session, and what it saw.
/** @param {number} n */
async function seat(n) {
  const net = connect({ url, game: o.game, room: o.room, storage: null, loopback: true });
  /** @type {{at: number, from: number, text: string}[]} */
  const recorded = [];
  /** @type {Map<string, number>} */
  const counts = new Map();
  if (o.record && n === 0) {
    const snapshots = new SnapshotReader();
    net.on('message', (from, type, r) => {
      if (from !== net.hostId || (type !== 2 && type !== SNAPSHOT)) return;
      const snapshot = type === SNAPSHOT ? snapshots.read(r.rest()) : null;
      if (type === SNAPSHOT && !snapshot) return;
      const text = snapshot ? JSON.stringify(snapshot) : r.text();
      const kind = /"type":"([a-z]+)"/.exec(text)?.[1] ?? '?';
      const k = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, k);
      if (
        k <= (kind === 'snapshot' || kind === 'self' ? 1 : 6) ||
        (kind === 'snapshot' && k % 30 === 0 && k <= 300)
      )
        recorded.push({ at: Math.round(net.now()), from, text });
    });
  }
  const opened = new Promise((ok) => net.on('open', () => ok(undefined)));
  const session = adapter.start(net, {
    get name() {
      return net.name;
    },
    get seat() {
      return net.id;
    },
  });
  await opened;
  log(`seat ${n + 1}: ${net.name} in ${o.game}/${o.room}`);
  return {
    n,
    net,
    session,
    recorded,
    seen: {
      observations: 0,
      acted: 0,
      refused: 0,
      events: new Map(/** @type {[string, number][]} */ ([])),
      path: 0,
      at: /** @type {Vector3 | null} */ (null),
    },
  };
}

// What a simple player does with what it sees, by the adapter's intents, which carry on by
// themselves: engage whoever it can see; else go after the other (with --hunt); else go to the
// nearest pickup there is; else look round, running where there's room. Nothing new while an intent
// is going (null).
/** @param {Observation} view @param {Vector3 | null | undefined} prey */
function decide(view, prey) {
  const enemy = view.players.find(
    (p) => p.alive && p.visible && (!view.you.team || p.team !== view.you.team),
  );
  if (enemy)
    return view.doing?.intent === 'engage' && 'id' in view.doing && view.doing.id === enemy.id
      ? null
      : { engage: enemy.id };
  if (view.doing) return null;
  if (prey) return { goto: prey };
  /** @param {Observation['pickups'][number]} p */
  const useful = (p) =>
    p.gives === 'health'
      ? view.you.hp < 100
      : p.gives === 'armor'
        ? view.you.armor < 150
        : !(p.gives in view.you.weapons);
  const pickup = view.pickups.find((p) => p.back === 0 && p.distance > 1.5 && useful(p));
  if (pickup) return { goto: pickup.at };
  return { turn: { right: 50 }, move: view.around.ahead.clear > 3 ? 'forward' : 'right', for_ms: 800 };
}

const seats = await Promise.all(Array.from({ length: Number(o.agents) }, (_, n) => seat(n)));
const began = performance.now();
const end = began + Number(o.seconds) * 1000;
while (performance.now() < end) {
  await new Promise((r) => setTimeout(r, 250));
  for (const { n, session, seen } of seats) {
    const view = session.observe();
    seen.observations++;
    for (const event of session.events()) {
      seen.events.set(event.type, (seen.events.get(event.type) ?? 0) + 1);
      if (
        [
          'hit',
          'hurt',
          'kill',
          'died',
          'pickup',
          'round',
          'drop',
          'spawn',
          'arrived',
          'blocked',
          'lost',
        ].includes(event.type)
      )
        log(`seat ${n + 1}`, JSON.stringify(event));
    }
    if (!view.joined || !view.you.alive) continue;
    if (seen.at) seen.path += Math.hypot(view.you.at[0] - seen.at[0], view.you.at[2] - seen.at[2]);
    seen.at = view.you.at;
    const other = o.hunt ? seats.find((s) => s.n !== n && s.seen.at)?.seen.at : null;
    const action = decide(view, other);
    if (!action) continue;
    const result = session.act(action);
    if (result.ok) seen.acted++;
    else {
      seen.refused++;
      log(`seat ${n + 1} refused`, JSON.stringify(action), result.error);
    }
  }
}
const seconds = (performance.now() - began) / 1000;
/** @param {number} bytes */
const kbs = (bytes) => Math.round((bytes / 1024 / seconds) * 100) / 100;
const summary = seats.map(({ n, net, session, seen }) => {
  const last = session.observe();
  session.stop();
  net.close();
  return {
    seat: n + 1,
    observations: seen.observations,
    acted: seen.acted,
    refused: seen.refused,
    events: Object.fromEntries(seen.events),
    ran: Math.round(seen.path * 10) / 10,
    you: { hp: last.you.hp, kills: last.you.kills, deaths: last.you.deaths, at: last.you.at },
    sees: last.players.length,
    pickups: last.pickups.length,
    match: last.match,
    wire: { in: kbs(net.stats.bytesIn), out: kbs(net.stats.bytesOut) },
  };
});
console.log(JSON.stringify(summary, null, 1));
if (o.record) {
  const { net, recorded } = indexed(seats, 0);
  writeFileSync(o.record, JSON.stringify({ game: o.game, seat: net.id, messages: recorded }, null, 1) + '\n');
  console.log(`recorded ${recorded.length} messages to ${o.record}`);
}
process.exit(0);
