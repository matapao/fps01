// The play adapter (src/agent/play.ts): a seat that plays the way a page does, for agents. Here
// the room is a recording of a real one (test/fixtures/play-session.json, made with tools/play.js
// on a local hub), played to the adapter through a stand-in connection, on a clock of its own.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Connection } from '/zirbel-net.js';
import type { Vector3 } from '../shared/contracts.ts';
import type { ServerMessage } from '../shared/server-messages.js';
import { readServerMessage } from '../shared/server-messages.js';
import { indexed } from '../shared/indexed.js';
import { finite, isRecord } from '../shared/snapshot-parts.js';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import adapter from '../src/agent/play.ts';
import { validate } from '../shared/schema.js';
import { SNAPSHOT, SnapshotWriter, readState } from '../shared/wire.js';

interface CapturedMessage extends Record<string, unknown> {
  type: string;
}
interface FireMessage extends CapturedMessage {
  type: 'fire';
  weapon: string;
  hits: { id: number }[];
}
interface Sent {
  to: number;
  type: number;
  message: CapturedMessage;
}
interface Recorded {
  at: number;
  from: number;
  text: string;
}

function captured(value: unknown): CapturedMessage {
  assert.ok(isRecord(value) && typeof value['type'] === 'string');
  return { ...value, type: value['type'] };
}
function fireMessage(value: CapturedMessage): value is FireMessage {
  return (
    value.type === 'fire' &&
    typeof value['weapon'] === 'string' &&
    Array.isArray(value['hits']) &&
    value['hits'].every((hit: unknown) => isRecord(hit) && finite(hit['id']))
  );
}
function recorded(value: unknown): value is Recorded {
  return isRecord(value) && finite(value['at']) && finite(value['from']) && typeof value['text'] === 'string';
}
const recordingData: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/play-session.json', import.meta.url), 'utf8'),
);
assert.ok(isRecord(recordingData) && finite(recordingData['seat']));
const recordedMessages = recordingData['messages'];
assert.ok(Array.isArray(recordedMessages) && recordedMessages.every(recorded));
const recording = { seat: recordingData['seat'], messages: recordedMessages };
const messages = recording.messages.map((m) => {
  const message = readServerMessage(m.text);
  assert.ok(message, m.text);
  return { ...m, message };
});
function firstSnapshot() {
  const message = messages.map((entry) => entry.message).find((entry) => entry.type === 'snapshot');
  assert.ok(message);
  return message;
}
const LANE: Vector3 = [-15, 0, 14.5]; // open asphalt on the Depot, 30 m clear to the east

// A seat's connection as the adapter sees it, with a clock the test moves. With wire, the room says in
// its hello that it sends snapshots as bytes (shared/wire.js), and does.
function seat({ wire = false } = {}) {
  const handlers = new EventEmitter();
  const sent: Sent[] = [];
  let time = messages[0]!.at - 50;
  const net: Connection = {
    id: recording.seat,
    name: 'Player One',
    hostId: 254,
    peers: new Map([[254, 'Server']]),
    local: false,
    url: 'ws://localhost/test',
    game: 'fps01',
    room: 'TEST',
    closed: false,
    revision: null,
    stats: { framesIn: 0, framesOut: 0, bytesIn: 0, bytesOut: 0, dropped: 0 },
    close() {},
    async data() {
      return undefined;
    },
    metric() {},
    connected: true,
    isHost: () => false,
    now: () => time,
    send: (to: number, type: number, data: string | Uint8Array) =>
      sent.push({
        to,
        type,
        message: captured(typeof data === 'string' ? JSON.parse(data) : readState(data)),
      }),
    stream: () => {},
    on(name, fn) {
      handlers.on(name, fn);
      return net;
    },
    off(name, fn) {
      handlers.off(name, fn);
      return net;
    },
  };
  // What the platform says: the hub's names for this seat and the others, by seat.
  const names = new Map<number, string>();
  for (const { message } of messages)
    if (message.type === 'snapshot') {
      for (const player of message.players)
        if (player.seat !== undefined)
          names.set(player.seat, player.seat === recording.seat ? 'Bot One' : 'Player Nine');
    }
  const session = adapter.start(net, { name: 'Bot One', seat: recording.seat, names: () => names });
  clearInterval(session.timer); // the test ticks it
  const snapshots = new SnapshotWriter();
  const say = (text: string, at?: number) => {
    if (at !== undefined) time = at;
    const message = readServerMessage(text);
    if (wire && message?.type === 'hello') text = JSON.stringify({ ...message, wire: 1 });
    if (wire && message?.type === 'snapshot') {
      const bytes = snapshots.write(message, recording.seat);
      if (bytes)
        handlers.emit(
          'message',
          254,
          SNAPSHOT,
          { text: () => '', rest: () => bytes, left: () => bytes.length },
          true,
        );
      return;
    }
    handlers.emit(
      'message',
      254,
      2,
      { text: () => text, rest: () => new TextEncoder().encode(text), left: () => text.length },
      true,
    );
  };
  // The recording up to (and with) the first message that passes `until`.
  const play = (until: (message: ServerMessage) => boolean = () => false) => {
    for (const m of messages) {
      say(m.text, m.at);
      if (until(m.message)) return m;
    }
    return null;
  };
  const tick = (ms = 1000 / 30, times = 1) => {
    for (let i = 0; i < times; i++) {
      time += ms;
      session.tick();
    }
  };
  // Puts the seat in the open, as a teleport would: the Depot's lane at z = 14.5, looking east along it.
  const lane = () => {
    say(JSON.stringify({ type: 'moved', feet: LANE }));
    session.act({ look: { heading: 90 } });
    tick();
  };
  // What it said to the room: its JSON, and its states (as bytes, read back).
  return {
    net,
    session,
    sent,
    say,
    play,
    tick,
    lane,
    ups: () => sent.filter((s) => s.to === 255 && (s.type === 1 || s.type === 4)).map((s) => s.message),
  };
}

test('the adapter says what it is for agents: what the game is, and schemas for what it shows and takes', () => {
  assert.ok(adapter.about.split(/\s+/).length <= 150, `${adapter.about.split(/\s+/).length} words`);
  assert.equal(adapter.observation.type, 'object');
  assert.equal(adapter.action.type, 'object');
  for (const ok of [
    {},
    { move: 'forward', fire: true },
    { move: { forward: 0.5, strafe: -1 }, jump: true, for_ms: 500 },
    { look: { heading: 270, pitch: -10 } },
    { aim_at: 2, fire: true },
    { goto: [10, 0, -4] },
  ]) {
    assert.deepEqual(validate(adapter.action, ok).problems, [], JSON.stringify(ok));
  }
});

test('it asks the room what there is, and joins its game with the data it plays by', () => {
  const { play, ups } = seat();
  assert.deepEqual(ups()[0], { type: 'hello' }, 'a seat that is seated asks at once');
  play((m) => m.type === 'hello');
  const create = ups().find((m) => m.type === 'create');
  assert.ok(
    create &&
      typeof create['map'] === 'string' &&
      create['mode'] === 'dm' &&
      typeof create['data'] === 'string',
    JSON.stringify(create),
  );
});

test('played the recording, it is in the game, alive where it spawned, armed, and sees the match', () => {
  const { session, play } = seat();
  play((m) => m.type === 'self');
  const view = session.observe();
  const spawn = messages
    .map((entry) => entry.message)
    .find((message) => message.type === 'spawn' && message.id === recording.seat);
  assert.ok(spawn?.type === 'spawn');
  assert.equal(view.joined, true);
  assert.equal(view.you.alive, true);
  assert.deepEqual(
    view.you.at,
    spawn.feet.map((v: number) => Math.round(v * 10) / 10),
  );
  assert.deepEqual(Object.keys(view.you.weapons).sort(), ['rifle', 'shotgun']);
  assert.equal(view.you.weapons['rifle'], null, 'the rifle never runs out');
  assert.equal(view.you.hp, 100);
  assert.equal(view.match.map, 'depot');
  assert.ok(view.match.timeLeft > 0 && view.match.killsToWin === 25);
  assert.ok(
    view.pickups.every((p) => p.distance <= 30),
    'only what the radar would show',
  );
  assert.ok(
    view.pickups.every((p, i: number, all) => i === 0 || indexed(all, i - 1).distance <= p.distance),
    'nearest first',
  );
  assert.deepEqual(validate(adapter.observation, view).problems, []);
  for (const way of ['ahead', 'left', 'right', 'behind'] as const)
    assert.ok(
      view.around[way].clear >= 0 &&
        view.around[way].clear <= 30 &&
        ['wall', 'jump', 'drop', 'void', null].includes(view.around[way].then),
      `${way}: ${JSON.stringify(view.around[way])}`,
    );
  assert.deepEqual(
    [view.you.name, view.you.seat],
    ['Bot One', recording.seat],
    'what the room calls you, and your seat',
  );
  assert.ok(
    view.players.every((p) => p.name === 'Player Nine' && Number.isInteger(p.seat)),
    'and the others, as the room calls them',
  );
});

test('every observation fits its schema: before joining, in the game, dead, and between rounds', () => {
  const { session, say } = seat();
  const fits = (when: string) =>
    assert.deepEqual(validate(adapter.observation, session.observe()).problems, [], when);
  fits('before it has heard anything');
  let died = false;
  for (const m of messages) {
    say(m.text, m.at);
    fits(`after ${m.text.slice(0, 40)}`);
    died ||= m.message.type === 'kill' && m.message.victim === recording.seat;
  }
  assert.ok(died, 'it was killed in the recording, and looked dead');
  say(JSON.stringify({ type: 'round', state: 'over', mode: 'dm', winner: null, ms: 8000 }));
  fits('between rounds');
});

test('what happened comes back once, in order: hits, kills, deaths, spawns, pickups, drops', () => {
  const { session, play } = seat();
  play();
  const events = session.events();
  const types: Set<string> = new Set(events.map((e) => e.type));
  for (const type of ['spawn', 'hit', 'hurt', 'died', 'kill', 'pickup', 'drop'])
    assert.ok(types.has(type), `${type} in ${[...types]}`);
  assert.ok(
    events.every((e, i: number) => i === 0 || indexed(events, i - 1).t <= e.t),
    'in order',
  );
  assert.ok(
    events.find((e) => e.type === 'kill' && e.yours),
    'one of its own kills',
  );
  assert.deepEqual(session.events(), [], 'and only once');
});

test('actions are checked against the schema, and against what you have', () => {
  const { session, play } = seat();
  play((m) => m.type === 'self');
  const refused = (action: unknown) => {
    const result = session.act(action);
    assert.equal(result.ok, false, JSON.stringify(action));
    assert.ok(!result.ok);
    return result.error;
  };
  assert.match(refused({ fly: true }), /fly/);
  assert.match(refused({ move: 'up' }), /move/);
  assert.match(refused({ fire: 'yes' }), /fire/);
  assert.match(refused({ for_ms: 5 }), /for_ms/);
  assert.match(refused({ look: { heading: 400 } }), /heading/);
  assert.match(refused([1, 2]), /action/);
  assert.match(refused({ weapon: 'rail' }), /don't carry rail/);
  assert.match(refused({ aim_at: 99 }), /no player 99/);
  assert.deepEqual(session.act({ weapon: 'shotgun', move: 'forward', fire: true, for_ms: 500 }), {
    ok: true,
  });
});

test('running forward, it tells the room where it is twenty times a second, by the same rules as a page', () => {
  const { session, play, tick, ups, lane } = seat();
  play((m) => m.type === 'self');
  lane();
  const before = session.observe();
  assert.ok(before.around.ahead.clear > 10, `room to run: ${JSON.stringify(before.around.ahead)}`);
  session.act({ move: 'forward' });
  const sent = ups().length;
  tick(1000 / 30, 30);
  const states = ups()
    .slice(sent)
    .filter((m) => m.type === 'state');
  assert.ok(
    states.length >= 19 && states.length <= 21,
    `${states.length} in a second: as often as SEND_RATE allows, while it moves`,
  );
  const after = session.observe().you;
  const ran = Math.hypot(after.at[0] - before.you.at[0], after.at[2] - before.you.at[2]);
  assert.ok(ran > 6 && ran < 9.5, `ran ${ran} m in a second`);
  const way = (Math.atan2(after.at[0] - before.you.at[0], -(after.at[2] - before.you.at[2])) * 180) / Math.PI;
  assert.ok(
    Math.abs(((way - before.you.heading + 540) % 360) - 180) < 10,
    `the way it looks: ${way} against ${before.you.heading}`,
  );
});

test('an action holds until the next one, or until its for_ms runs out', () => {
  const { session, play, tick } = seat();
  play((m) => m.type === 'self');
  session.act({ move: 'forward', for_ms: 200 });
  tick(1000 / 30, 15);
  const stopped = session.observe().you.at;
  tick(1000 / 30, 15);
  assert.deepEqual(session.observe().you.at, stopped, 'standing still once it ran out');
});

test('from a room that sends snapshots as bytes, it reads the same game, and says where it is as bytes', () => {
  const json = seat();
  const bytes = seat({ wire: true });
  // The recording up to where the seat first sees someone, both ways.
  const seen = json.play((m) => m.type === 'snapshot' && json.session.observe().players.length > 0);
  bytes.play((m) => m === seen!.message);
  assert.ok(
    bytes.ups().some((m) => m.type === 'wire'),
    'it said it reads them',
  );
  assert.ok(!json.ups().some((m) => m.type === 'wire'), 'and only to a room that sends them');
  const [a, b] = [json.session.observe(), bytes.session.observe()];
  assert.ok(a.players.length > 0, 'it sees someone');
  assert.deepEqual(
    b.players.map((p) => [p.id, p.name, p.hp]),
    a.players.map((p) => [p.id, p.name, p.hp]),
  );
  assert.ok(
    b.players.every((p, i: number) =>
      p.at.every((v: number, k: number) => Math.abs(v - indexed(indexed(a.players, i).at, k)) <= 0.1),
    ),
    'where they are, to the centimetre',
  );
  assert.deepEqual([b.you.id, b.you.hp, b.match.mode], [a.you.id, a.you.hp, a.match.mode]);
  bytes.lane();
  bytes.session.act({ move: 'forward', for_ms: 2000 });
  const sent = bytes.sent.length;
  bytes.tick(1000 / 30, 30);
  const states = bytes.sent.slice(sent).filter((s) => s.to === 255 && s.type === 4);
  assert.ok(states.length >= 19 && states.length <= 21, `${states.length} states as bytes in a second`);
  assert.ok(
    !bytes.sent.slice(sent).some((s) => s.type === 1 && s.message.type === 'state'),
    'and none as JSON',
  );
});

test('standing still, it hardly says anything: its state once a second', () => {
  const { play, tick, ups } = seat();
  play((m) => m.type === 'self');
  tick(1000 / 30, 30);
  const sent = ups().length;
  tick(1000 / 30, 90); // three seconds
  const states = ups()
    .slice(sent)
    .filter((m) => m.type === 'state');
  assert.ok(states.length >= 2 && states.length <= 4, `${states.length} states in 3 s`);
});

test('firing goes as fast as the weapon allows, and says who it hit for the room to check', () => {
  const { session, play, tick, ups, say } = seat();
  play((m) => m.type === 'self');
  const you = session.observe().you;
  // Someone right in front of it, 6 m away, in the open.
  const yaw = (-you.heading * Math.PI) / 180;
  const target = [you.at[0] - Math.sin(yaw) * 6, you.at[1], you.at[2] - Math.cos(yaw) * 6];
  const snapshot = firstSnapshot();
  const existing = snapshot.players.find((p) => p.id !== recording.seat);
  assert.ok(existing);
  const other = { ...existing, feet: target, alive: true };
  say(
    JSON.stringify({
      ...snapshot,
      players: [...snapshot.players.filter((p) => p.id === recording.seat), other],
    }),
  );
  session.act({ fire: true, look: { heading: you.heading, pitch: -5 } });
  const sent = ups().length;
  tick(1000 / 30, 30);
  const shots = ups().slice(sent).filter(fireMessage);
  assert.ok(
    shots.length >= 7 && shots.length <= 9,
    `${shots.length} rifle shots in a second (one every 120 ms)`,
  );
  assert.ok(shots.every((s) => s['weapon'] === 'rifle'));
  assert.ok(
    shots.filter((s) => s['hits'].some((h) => h.id === other.id)).length >= shots.length - 2,
    'standing still, nearly all hit',
  );
});

test('aim_at turns towards a player only as fast as a quick hand would', () => {
  const { session, play, tick, say } = seat();
  play((m) => m.type === 'self');
  const you = session.observe().you;
  const yaw = (-you.heading * Math.PI) / 180;
  const behind = [you.at[0] + Math.sin(yaw) * 5, you.at[1], you.at[2] + Math.cos(yaw) * 5];
  const snapshot = firstSnapshot();
  const existing = snapshot.players.find((p) => p.id !== recording.seat);
  assert.ok(existing);
  const other = { ...existing, feet: behind, alive: true };
  say(
    JSON.stringify({
      ...snapshot,
      players: [...snapshot.players.filter((p) => p.id === recording.seat), other],
    }),
  );
  tick(); // its clock catches up with the recording's
  const you0 = session.observe().you;
  assert.deepEqual(session.act({ aim_at: other.id }), { ok: true });
  tick(1000 / 30, 3);
  const turned = Math.abs(((session.observe().you.heading - you0.heading + 540) % 360) - 180);
  assert.ok(turned > 20 && turned < 35, `turned ${turned}° in 0.1 s`);
  tick(1000 / 30, 30);
  const facing = Math.abs(((session.observe().you.heading - ((you.heading + 180) % 360) + 540) % 360) - 180);
  assert.ok(facing < 4, `facing them after a second: ${facing}° off`);
});

test('the controls stop by themselves after a second and a half, unless for_ms says longer', () => {
  const { session, play, tick, lane } = seat();
  play((m) => m.type === 'self');
  lane();
  session.act({ move: 'forward' });
  tick(1000 / 30, 60); // 2 s: it stopped at 1.5, and slid to a stop
  const stopped = session.observe().you.at;
  tick(1000 / 30, 30);
  assert.deepEqual(session.observe().you.at, stopped, 'standing still');
  session.act({ move: 'back', for_ms: 3000 });
  tick(1000 / 30, 60);
  assert.ok(session.observe().you.speed > 5, 'still going at 2 s');
});

test('goto finds the way on foot, round what is in the way, and stops there', () => {
  const { session, play, tick } = seat();
  play((m) => m.type === 'self');
  // The pickup farthest away within the radar's range, which a straight line won't reach.
  const view = session.observe();
  const target = [...view.pickups].sort((a, b) => b.distance - a.distance)[0];
  assert.ok(target);
  assert.deepEqual(session.act({ goto: target.at }), { ok: true });
  assert.equal(session.observe().doing?.intent, 'goto');
  let arrived: ReturnType<typeof session.events>[number] | undefined;
  for (let s = 0; s < 20 && !arrived; s += 0.5) {
    tick(1000 / 30, 15);
    arrived = session.events().find((e) => e.type === 'arrived' || e.type === 'blocked');
  }
  assert.equal(arrived?.type, 'arrived', JSON.stringify(arrived));
  const at = session.observe().you.at;
  assert.ok(Math.hypot(at[0] - target.at[0], at[2] - target.at[2]) < 1.2, `at ${at}, for ${target.at}`);
  assert.equal(session.observe().doing, null, 'and it is done');
});

test('goto where nobody can go says it is blocked, and gets as near as it can', () => {
  const { session, play, tick } = seat();
  play((m) => m.type === 'self');
  session.act({ goto: [0, 40, 0] }); // high over the arena, above the roof
  let blocked: ReturnType<typeof session.events>[number] | undefined;
  for (let s = 0; s < 25 && !blocked; s += 0.5) {
    tick(1000 / 30, 15);
    blocked = session.events().find((e) => e.type === 'blocked' || e.type === 'arrived');
  }
  assert.equal(blocked?.type, 'blocked', JSON.stringify(blocked));
  assert.ok(blocked?.type === 'blocked');
  assert.match(blocked.why, /no way there on foot|stuck/);
});

test('engage aims at a player, fires when on target and strafes; when they die, they are lost', () => {
  const { session, play, tick, ups, say, lane } = seat();
  play((m) => m.type === 'self');
  lane();
  const target = [LANE[0]! + 9, LANE[1]!, LANE[2]!];
  const snapshot = firstSnapshot();
  const existing = snapshot.players.find((p) => p.id !== recording.seat);
  assert.ok(existing);
  const other = { ...existing, feet: target, alive: true };
  const others = (alive: boolean) =>
    JSON.stringify({
      ...snapshot,
      players: [...snapshot.players.filter((p) => p.id === recording.seat), { ...other, alive }],
    });
  say(others(true));
  tick();
  assert.deepEqual(session.act({ engage: other.id }), { ok: true });
  const sent = ups().length;
  const sideways = new Set<number>(); // which side of the lane it strafed to
  for (let i = 0; i < 60; i++) {
    tick();
    sideways.add(Math.sign(Math.round((session.observe().you.at[2] - LANE[2]!) * 10)));
  }
  assert.ok(sideways.has(1) || sideways.has(-1), 'it strafes');
  const shots = ups().slice(sent).filter(fireMessage);
  assert.ok(shots.length >= 6, `${shots.length} shots in 2 s`);
  assert.ok(
    shots.filter((s) => s['hits'].some((h) => h.id === other.id)).length >= shots.length / 2,
    'most of them hit',
  );
  say(others(false));
  tick();
  assert.ok(session.events().some((e) => e.type === 'lost' && e.id === other.id && /died/.test(e.why)));
  assert.equal(session.observe().doing, null);
});

test('one intent at a time, and only after players there are', () => {
  const { session, play } = seat();
  play((m) => m.type === 'self');
  const conflicting = session.act({ goto: [0, 0, 0], follow: 2 });
  assert.ok(!conflicting.ok);
  assert.match(conflicting.error, /one intent at a time/);
  const absent = session.act({ engage: 99 });
  assert.ok(!absent.ok);
  assert.match(absent.error, /no player 99/);
  assert.deepEqual(session.act({ hold: 'here', fire: true }), { ok: true });
  assert.equal(session.observe().doing?.intent, 'hold');
});

test('stopped, it leaves the room alone', () => {
  const { session, play, ups } = seat();
  play((m) => m.type === 'self');
  session.stop();
  const sent = ups().length;
  play();
  assert.equal(ups().length, sent);
});

test('malformed host movement cannot replace predicted position and a valid update still applies', () => {
  const { session, play, say } = seat();
  play((message) => message.type === 'self');
  const before = session.observe().you.at;
  say(JSON.stringify({ type: 'moved', feet: [1, 'bad', 3] }));
  assert.deepEqual(session.observe().you.at, before);
  say(JSON.stringify({ type: 'moved', feet: [1, 2, 3] }));
  assert.deepEqual(session.observe().you.at, [1, 2, 3]);
});
