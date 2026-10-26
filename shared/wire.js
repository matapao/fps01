import { indexed } from './indexed.js';
import { mapVector } from './vector.js';
import { applySnapshotPart, isTeam } from './snapshot-parts.js';
/** @typedef {import('./contracts.ts').Vector3} Vector3 */
/** @typedef {import('./runtime-types.ts').Snapshot} Snapshot */
/** @typedef {import('./runtime-types.ts').PlayerSnapshot} PlayerSnapshot */
/** @typedef {ReturnType<typeof onWire>} WirePlayer */
// The game's wire on zirbel. A page is told how the game stands 20 times a second (a snapshot): as
// bytes, and only what changed since the snapshot it was sent before (the first, and the first after
// the page starts again, is whole: a keyframe); players far from it and out of its view, less often.
// A page says where it is (its state) as bytes, and only when that changes. All the other messages
// are the game's own JSON, and on a LAN everything is JSON.
//
//   const writer = new SnapshotWriter();  writer.write(snapshot, viewerId) → Uint8Array, or null for nothing new
//   const reader = new SnapshotReader();  reader.read(bytes) → the snapshot, as the JSON one would be
//                                         (null until it has had a keyframe)
//   writeState({ feet, yaw, pitch, held }) → Uint8Array;  readState(bytes) → { type: 'state', … }

// zirbel-net message types, beside the game's JSON (1 up, 2 down: see zirbel/room.js).
export const SNAPSHOT = 3; // a snapshot, from the authority
export const STATE = 4; // a page's state, to it

const CM = 100; // positions are sent in centimetres…
const ANGLE = 10000; // …angles in ten-thousandths of a radian
const STEP_MOST = 127; // centimetres: someone who moved less than this each way goes as a step
const FAR = 40; // metres: players farther than this…
const OUT_OF_VIEW = Math.cos((70 * Math.PI) / 180); // …and more than 70° from where you look…
const FAR_EVERY = 4; // …are sent every this many snapshots (5 a second)
const KEY = 1; // a frame's flags: a keyframe (the reader starts afresh)

// What can change about a player, a bit each; what changes most in the first seven, which go in a byte.
const FEET = 1 << 0; // where their feet are
const STEP = 1 << 1; // or how far they moved, when it's a little
const YAW = 1 << 2;
const PITCH = 1 << 3;
const HP = 1 << 4;
const ARMOR = 1 << 5;
const FLAGS = 1 << 6; // alive, shielded, cloaked
const KILLS = 1 << 7;
const DEATHS = 1 << 8;
const HELD = 1 << 9;
const TEAM = 1 << 10;
const CARRYING = 1 << 11;
const POWERUP = 1 << 12;
const HOOK = 1 << 13;
const WHO = 1 << 14; // seat, name and colour
const EVERYTHING = ((1 << 15) - 1) & ~STEP;

/** @param {number} v */
const clamp16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
/** @param {number | undefined} v */
const count = (v) => Math.max(0, Math.min(0xffff, Math.round(v ?? 0)));
/** @param {number} a */
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** @param {number} v */
const at16 = (v) => clamp16(v * CM);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A player as the wire has them: whole numbers, so comparing them says what a page would see change.
/** @param {PlayerSnapshot} p */
function onWire(p) {
  return {
    feet: mapVector(p.feet, at16),
    yaw: clamp16(wrapAngle(p.yaw ?? 0) * ANGLE),
    pitch: clamp16((p.pitch ?? 0) * ANGLE),
    hp: count(p.hp),
    armor: count(p.armor),
    kills: count(p.kills),
    deaths: count(p.deaths),
    held: p.held ?? null,
    team: p.team ?? null,
    carrying: p.carrying ?? null,
    flags: (p.alive ? 1 : 0) | (p.shielded ? 2 : 0) | (p.cloaked ? 4 : 0),
    powerup: p.powerup ?? null,
    hook: p.hook ? mapVector(p.hook, at16) : null,
    seat: count(p.seat),
    name: p.name ?? '',
    color: p.color ?? '',
  };
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]));

// Which of a player's parts differ from what was sent before (all of them, for one not sent yet);
// where their feet are as a step, when that's near enough.
/** @param {WirePlayer} now @param {WirePlayer | undefined} before */
function changes(now, before) {
  if (!before) return EVERYTHING;
  let mask = 0;
  if (!same(now.feet, before.feet))
    mask |= now.feet.every((v, i) => Math.abs(v - indexed(before.feet, i)) <= STEP_MOST) ? STEP : FEET;
  if (now.yaw !== before.yaw) mask |= YAW;
  if (now.pitch !== before.pitch) mask |= PITCH;
  if (now.hp !== before.hp) mask |= HP;
  if (now.armor !== before.armor) mask |= ARMOR;
  if (now.flags !== before.flags) mask |= FLAGS;
  if (now.kills !== before.kills) mask |= KILLS;
  if (now.deaths !== before.deaths) mask |= DEATHS;
  if (now.held !== before.held) mask |= HELD;
  if (now.team !== before.team) mask |= TEAM;
  if (now.carrying !== before.carrying) mask |= CARRYING;
  if (now.powerup !== before.powerup) mask |= POWERUP;
  if (!same(now.hook, before.hook)) mask |= HOOK;
  if (now.seat !== before.seat || now.name !== before.name || now.color !== before.color) mask |= WHO;
  return mask;
}

// Whether someone is far from the viewer and out of their view: they can wait a few snapshots.
/** @param {PlayerSnapshot} me @param {PlayerSnapshot} p */
function outOfSight(me, p) {
  const [dx, dy, dz] = [p.feet[0] - me.feet[0], p.feet[1] - me.feet[1], p.feet[2] - me.feet[2]];
  if (Math.hypot(dx, dy, dz) <= FAR) return false;
  const ahead = -Math.sin(me.yaw) * dx - Math.cos(me.yaw) * dz; // how far along where the viewer looks
  return ahead < Math.hypot(dx, dz) * OUT_OF_VIEW;
}

// Everything in a snapshot but the players and what's in flight, part by part (the round, the
// pickups, the powerups, the crates, the water): each changes seldom, and goes as JSON when it does.
// The clocks to the second, as a page shows them; a carried flag without where it is, which is
// where its carrier is (the reader puts it there).
/** @param {Snapshot} snapshot */
function restOf(snapshot) {
  const rest = new Map();
  for (const key of ['round', 'items', 'water', 'powerups', 'crates', 'woollies']) {
    let value =
      key === 'round'
        ? snapshot.round
        : key === 'items'
          ? snapshot.items
          : key === 'water'
            ? snapshot.water
            : key === 'powerups'
              ? snapshot.powerups
              : key === 'crates'
                ? snapshot.crates
                : snapshot.woollies;
    if (value === undefined) continue;
    if (key === 'round' && snapshot.round) {
      const round = { ...snapshot.round, ms: Math.ceil(snapshot.round.ms / 1000) * 1000 };
      if (round.flags)
        round.flags = Object.fromEntries(
          Object.entries(round.flags).map(([team, flag]) => [
            team,
            flag.state === 'carried' ? { ...flag, at: null } : flag,
          ]),
        );
      value = round;
    }
    if (key === 'powerups' && snapshot.powerups?.soon) {
      value = {
        ...snapshot.powerups,
        soon: { ...snapshot.powerups.soon, ms: Math.ceil(snapshot.powerups.soon.ms / 1000) * 1000 },
      };
    }
    rest.set(key, JSON.stringify(value));
  }
  return rest;
}

// Bytes, written one after another.
class Out {
  constructor() {
    this.bytes = new Uint8Array(512);
    this.view = new DataView(this.bytes.buffer);
    this.at = 0;
  }
  /** @param {number} n */
  room(n) {
    if (this.at + n <= this.bytes.length) return;
    const bigger = new Uint8Array(Math.max(this.bytes.length * 2, this.at + n));
    bigger.set(this.bytes);
    this.bytes = bigger;
    this.view = new DataView(bigger.buffer);
  }
  /** @param {number} v */
  u8(v) {
    this.room(1);
    this.view.setUint8(this.at++, v);
  }
  /** @param {number} v */
  i8(v) {
    this.room(1);
    this.view.setInt8(this.at++, v);
  }
  /** @param {number} v */
  i16(v) {
    this.room(2);
    this.view.setInt16(this.at, v);
    this.at += 2;
  }
  // A whole number of any size, seven bits a byte: one byte under 128.
  /** @param {number} v */
  varint(v) {
    let n = Math.max(0, Math.floor(v));
    while (n >= 128) {
      this.u8((n % 128) | 128);
      n = Math.floor(n / 128);
    }
    this.u8(n);
  }
  // A short string, or null (length 255).
  /** @param {string | null | undefined} s */
  str(s) {
    if (s === null || s === undefined) return this.u8(255);
    const bytes = encoder.encode(String(s)).subarray(0, 254);
    this.u8(bytes.length);
    this.room(bytes.length);
    this.bytes.set(bytes, this.at);
    this.at += bytes.length;
  }
  // A long one.
  /** @param {string} s */
  text(s) {
    const bytes = encoder.encode(s);
    this.varint(bytes.length);
    this.room(bytes.length);
    this.bytes.set(bytes, this.at);
    this.at += bytes.length;
  }
  done() {
    return this.bytes.slice(0, this.at);
  }
}

// And read back.
class In {
  /** @param {Uint8Array | ArrayBuffer} bytes */
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.at = 0;
  }
  u8() {
    return this.view.getUint8(this.at++);
  }
  i8() {
    return this.view.getInt8(this.at++);
  }
  i16() {
    const v = this.view.getInt16(this.at);
    this.at += 2;
    return v;
  }
  varint() {
    let v = 0;
    for (let scale = 1; scale <= 2 ** 49; scale *= 128) {
      const b = this.u8();
      v += (b & 127) * scale;
      if (!Number.isSafeInteger(v)) throw new RangeError('Invalid wire integer');
      if (b < 128) return v;
    }
    throw new RangeError('Invalid wire integer');
  }
  /** @param {number} length */
  string(length) {
    if (length > this.bytes.length - this.at) throw new RangeError('Truncated wire string');
    const s = decoder.decode(this.bytes.subarray(this.at, this.at + length));
    this.at += length;
    return s;
  }
  str() {
    const length = this.u8();
    if (length === 255) return null;
    return this.string(length);
  }
  text() {
    return this.string(this.varint());
  }
  end() {
    if (this.at !== this.bytes.length) throw new RangeError('Trailing wire bytes');
  }
}

// What one page is sent: each snapshot against the one before it, as that page has it.
export class SnapshotWriter {
  constructor() {
    /** @type {Map<number, WirePlayer>} */
    this.sent = new Map();
    /** @type {Map<number, Vector3>} */
    this.shots = new Map();
    /** @type {Map<string, string>} */
    this.rest = new Map();
    this.frame = 0;
    this.key = true;
  }

  // The page starts again (or will): the next snapshot is whole.
  reset() {
    /** @type {Map<number, WirePlayer>} */
    this.sent = new Map(); // id → the player as last sent
    /** @type {Map<number, Vector3>} */
    this.shots = new Map(); // id → where what's in flight was last sent
    /** @type {Map<string, string>} */
    this.rest = new Map(); // part → its JSON as last sent
    this.frame = 0;
    this.key = true;
  }

  // The snapshot for whoever has the id `viewer`; null when there's nothing new to tell them.
  /** @param {Snapshot} snapshot @param {number | null} viewer */
  write(snapshot, viewer = null) {
    const players = snapshot.players ?? [];
    const frame = this.frame++;
    // While the viewer plays: dead, they watch whoever killed them, and at the end the winner.
    const me = players.find((p) => p.id === viewer);
    const watching = me?.alive && !snapshot.round?.over;
    /** @type {[number, WirePlayer, number, WirePlayer | undefined][]} */
    const entries = [];
    for (const player of players) {
      const before = this.sent.get(player.id);
      // Far off and out of view, less often (but someone new at once, and everything in a keyframe).
      if (
        watching &&
        before &&
        !this.key &&
        player.id !== viewer &&
        (frame + player.id) % FAR_EVERY !== 0 &&
        outOfSight(me, player)
      )
        continue;
      const now = onWire(player);
      const mask = changes(now, before);
      if (mask) entries.push([player.id, now, mask, before]);
    }
    const here = new Set(players.map((p) => p.id));
    const gone = [...this.sent.keys()].filter((id) => !here.has(id));
    // What's in flight: new, moved, or landed since.
    /** @type {[number, string | null, Vector3][]} */
    const fresh = [];
    /** @type {[number, Vector3][]} */
    const moved = [];
    const flying = new Set();
    for (const [id, kind, x, y, z] of snapshot.projectiles ?? []) {
      flying.add(id);
      /** @type {Vector3} */
      const at = [at16(x), at16(y), at16(z)];
      const before = this.shots.get(id);
      if (!before) fresh.push([id, kind, at]);
      else if (!same(at, before)) moved.push([id, at]);
    }
    const landed = [...this.shots.keys()].filter((id) => !flying.has(id));
    // The rest, part by part.
    const rest = restOf(snapshot);
    const changed = [...rest].filter(([key, json]) => this.rest.get(key) !== json);
    const dropped = [...this.rest.keys()].filter((key) => !rest.has(key));
    if (
      !this.key &&
      !entries.length &&
      !gone.length &&
      !fresh.length &&
      !moved.length &&
      !landed.length &&
      !changed.length &&
      !dropped.length
    )
      return null;

    const out = new Out();
    out.u8(this.key ? KEY : 0);
    out.varint(entries.length);
    for (const [id, now, mask, before] of entries) {
      out.varint(id);
      out.varint(mask);
      if (mask & FEET) for (const v of now.feet) out.i16(v);
      if (mask & STEP) {
        if (!before) throw new Error('Delta step requires a previous player');
        for (const [i, v] of now.feet.entries()) out.i8(v - indexed(before.feet, i));
      }
      if (mask & YAW) out.i16(now.yaw);
      if (mask & PITCH) out.i16(now.pitch);
      if (mask & HP) out.varint(now.hp);
      if (mask & ARMOR) out.varint(now.armor);
      if (mask & FLAGS) out.u8(now.flags);
      if (mask & KILLS) out.varint(now.kills);
      if (mask & DEATHS) out.varint(now.deaths);
      if (mask & HELD) out.str(now.held);
      if (mask & TEAM) out.str(now.team);
      if (mask & CARRYING) out.str(now.carrying);
      if (mask & POWERUP) out.str(now.powerup);
      if (mask & HOOK) {
        out.u8(now.hook ? 1 : 0);
        if (now.hook) for (const v of now.hook) out.i16(v);
      }
      if (mask & WHO) {
        out.varint(now.seat);
        out.str(now.name);
        out.str(now.color);
      }
      this.sent.set(id, now);
    }
    out.varint(gone.length);
    for (const id of gone) {
      out.varint(id);
      this.sent.delete(id);
    }
    out.varint(fresh.length);
    for (const [id, kind, at] of fresh) {
      out.varint(id);
      out.str(kind);
      for (const v of at) out.i16(v);
      this.shots.set(id, at);
    }
    out.varint(moved.length);
    for (const [id, at] of moved) {
      out.varint(id);
      for (const v of at) out.i16(v);
      this.shots.set(id, at);
    }
    out.varint(landed.length);
    for (const id of landed) {
      out.varint(id);
      this.shots.delete(id);
    }
    out.varint(changed.length);
    for (const [key, json] of changed) {
      out.str(key);
      out.text(json);
    }
    out.varint(dropped.length);
    for (const key of dropped) out.str(key);
    this.rest = rest;
    this.key = false;
    return out.done();
  }
}

// What one page makes of them: the game as it stands, snapshot after snapshot.
export class SnapshotReader {
  constructor() {
    this.started = false; // whether it has had a keyframe: until then it can't make sense of the rest
    /** @type {Map<number, PlayerSnapshot>} */
    this.players = new Map(); // id → the player, as the JSON snapshot has them
    /** @type {Map<number, import('./runtime-types.ts').ProjectileSnapshot>} */
    this.shots = new Map(); // id → [id, kind, x, y, z]
    /** @type {Map<string, string>} */
    this.rest = new Map(); // part → its JSON
    /** @type {Map<string, Vector3>} */
    this.flagAt = new Map(); // team → where its flag was last carried
  }

  /** @param {Uint8Array | ArrayBuffer} bytes */
  read(bytes) {
    const r = new In(bytes);
    if (r.u8() & KEY) {
      this.started = true;
      this.players.clear();
      this.shots.clear();
      this.rest.clear();
    } else if (!this.started) return null;
    for (let n = r.varint(); n > 0; n--) {
      const id = r.varint();
      const mask = r.varint();
      /** @type {PlayerSnapshot} */
      const p = this.players.get(id) ?? {
        id,
        seat: 0,
        name: '',
        color: '',
        feet: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        hp: 0,
        armor: 0,
        alive: false,
        kills: 0,
        deaths: 0,
        hook: null,
        held: null,
        team: null,
        carrying: null,
        shielded: false,
        cloaked: false,
        powerup: null,
      };
      if (mask & FEET) p.feet = [r.i16() / CM, r.i16() / CM, r.i16() / CM];
      if (mask & STEP) p.feet = mapVector(p.feet, (v) => Math.round(v * CM + r.i8()) / CM);
      if (mask & YAW) p.yaw = r.i16() / ANGLE;
      if (mask & PITCH) p.pitch = r.i16() / ANGLE;
      if (mask & HP) p.hp = r.varint();
      if (mask & ARMOR) p.armor = r.varint();
      if (mask & FLAGS) {
        const f = r.u8();
        Object.assign(p, { alive: Boolean(f & 1), shielded: Boolean(f & 2), cloaked: Boolean(f & 4) });
      }
      if (mask & KILLS) p.kills = r.varint();
      if (mask & DEATHS) p.deaths = r.varint();
      if (mask & HELD) p.held = r.str();
      if (mask & TEAM) {
        const team = r.str();
        if (team !== null && !isTeam(team)) throw new TypeError('Invalid player team');
        p.team = team;
      }
      if (mask & CARRYING) {
        const team = r.str();
        if (team !== null && !isTeam(team)) throw new TypeError('Invalid carried flag');
        p.carrying = team;
      }
      if (mask & POWERUP) p.powerup = r.str();
      if (mask & HOOK) p.hook = r.u8() ? [r.i16() / CM, r.i16() / CM, r.i16() / CM] : null;
      if (mask & WHO) {
        p.seat = r.varint();
        p.name = r.str() ?? '';
        p.color = r.str() ?? '';
      }
      this.players.set(id, p);
    }
    for (let n = r.varint(); n > 0; n--) this.players.delete(r.varint());
    for (let n = r.varint(); n > 0; n--) {
      const id = r.varint();
      this.shots.set(id, [id, r.str(), r.i16() / CM, r.i16() / CM, r.i16() / CM]);
    }
    for (let n = r.varint(); n > 0; n--) {
      const id = r.varint();
      const kind = this.shots.get(id)?.[1] ?? null;
      this.shots.set(id, [id, kind, r.i16() / CM, r.i16() / CM, r.i16() / CM]);
    }
    for (let n = r.varint(); n > 0; n--) this.shots.delete(r.varint());
    for (let n = r.varint(); n > 0; n--) {
      const key = r.str();
      if (key === null) throw new TypeError('Invalid snapshot part name');
      this.rest.set(key, r.text());
    }
    for (let n = r.varint(); n > 0; n--) {
      const key = r.str();
      if (key === null) throw new TypeError('Invalid snapshot part name');
      this.rest.delete(key);
    }
    r.end();

    // As the JSON one would be: every part its own, nothing shared with the snapshot before.
    /** @type {PlayerSnapshot[]} */
    const players = [...this.players.values()]
      .sort((a, b) => a.id - b.id)
      .map((p) => ({ ...p, feet: mapVector(p.feet, (v) => v), hook: p.hook && mapVector(p.hook, (v) => v) }));
    /** @type {Snapshot} */
    const snapshot = {
      type: 'snapshot',
      players,
      projectiles: [...this.shots.values()].map(([id, kind, x, y, z]) => [id, kind, x, y, z]),
    };
    for (const [key, json] of this.rest) applySnapshotPart(snapshot, key, JSON.parse(json));
    // A carried flag is where its carrier is.
    for (const [team, flag] of Object.entries(snapshot.round?.flags ?? {})) {
      if (flag?.state !== 'carried') continue;
      const carrier = players.find((p) => p.carrying === team);
      flag.at = carrier ? [...carrier.feet] : [...(this.flagAt.get(team) ?? [0, 0, 0])];
      this.flagAt.set(team, flag.at);
    }
    return snapshot;
  }
}

// A page's state, as bytes: where its player's feet are, which way they look, and what's in their hands.
/** @param {import('./runtime-types.ts').StateMessage} state */
export function writeState({ feet, yaw, pitch, held }) {
  const out = new Out();
  for (const v of feet) out.i16(at16(v));
  out.i16(clamp16(wrapAngle(yaw) * ANGLE));
  out.i16(clamp16(pitch * ANGLE));
  out.str(held ?? null);
  return out.done();
}

/** @param {Uint8Array | ArrayBuffer} bytes */
export function readState(bytes) {
  const r = new In(bytes);
  /** @type {Vector3} */
  const feet = [r.i16() / CM, r.i16() / CM, r.i16() / CM];
  const yaw = r.i16() / ANGLE;
  const pitch = r.i16() / ANGLE;
  const held = r.str();
  r.end();
  return { type: 'state', feet, yaw, pitch, held };
}

// Whether a state is worth sending: moved, turned or changed what's in their hands since the last
// one sent, or a second has passed.
/** @param {import('./runtime-types.ts').StateMessage} now @param {import('./runtime-types.ts').StateMessage | null | undefined} before @param {number} elapsedMs */
export function stateChanged(now, before, elapsedMs) {
  if (!before || elapsedMs >= 1000 || now.held !== before.held) return true;
  if (Math.abs(wrapAngle(now.yaw - before.yaw)) > 0.002 || Math.abs(now.pitch - before.pitch) > 0.002)
    return true;
  return now.feet.some((v, i) => Math.abs(v - indexed(before.feet, i)) >= 0.01);
}
