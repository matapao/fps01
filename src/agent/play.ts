/**
 * fps01 for agents: a seat in a room that plays the way a page does. It speaks the game's own
 * messages with the room's authority (zirbel/room.js), keeps its own copy of the arena from them,
 * moves its player by the same rules as a page (shared/movement.js) and sends where it is thirty
 * times a second, and says what its shots hit for the authority to check, as a page does. The game
 * needs no changes for it.
 *
 * An agent observes this seat's view (compact JSON, numbers rounded) and acts. An agent thinks for
 * seconds while the game moves at 9 m/s, so besides the controls (move, look, fire …), which hold
 * for a second and a half unless it says otherwise, it can give intents that carry on by themselves
 * until they're done: goto finds the way on foot (src/agent/route.ts) and stops there, follow keeps
 * near a player, engage fights one (aiming, firing when on target, strafing, chasing where it last
 * saw them), hold stays at a point and fights from there. events() is what happened since the last
 * call: arrived, blocked and lost among them. The platform starts one session per agent:
 * start(net, me) with the seat's GameNet; me says what the hub calls the seat (Bot One …) and the
 * others (names()).
 */
import type { GameNet, Connection } from '/zirbel-net.js';
import { readServerMessage } from '../../shared/server-messages.js';
import type { ServerMessages } from '../../shared/server-messages.js';
import type { PlayerSnapshot, RoundSnapshot, Snapshot } from '../../shared/runtime-types.ts';
import { indexed, lookup } from '../../shared/indexed.js';
import { mapVector, AXES } from '../../shared/vector.js';
import { scatter, spreadFor } from '../../shared/aim.js';
import { checkData } from '../../shared/check.js';
import {
  HEAD_HEIGHT,
  KICK_COOLDOWN_MS,
  KICK_REACH,
  MAX_RANGE,
  MOVE_SPEED,
  PLAYER_HEIGHT,
  SEND_RATE,
  SPEED_CAP,
  TICK_RATE,
} from '../../shared/constants.js';
import { DATA, HASH, useData } from '../../shared/data.js';
import { CRATE_ITEMS, POWERUPS } from '../../shared/loot.js';
import { ITEMS, JUMP_PADS, MAP, MAPS, MAP_ORDER, PEDESTAL, useMap } from '../../shared/map.js';
import { stepMovement } from '../../shared/movement.js';
import { validate } from '../../shared/schema.js';
import { eyePosition, playerBox, rayBox } from '../../shared/physics.js';
import { THROW, TRICK_SPEED } from '../../shared/tricks.js';
import { Voxels, cellOf } from '../../shared/voxels.js';
import { ARSENAL, WEAPONS, costOf, railReach, zoomOf } from '../../shared/weapons.js';
import { SNAPSHOT, STATE, SnapshotReader, stateChanged, writeState } from '../../shared/wire.js';
import { type Route, route } from './route.ts';

type Vec = [number, number, number];
type AgentEvent =
  | { type: 'spawn' | 'arrived'; at: number[] }
  | { type: 'hurt'; by: number | null; hp: number; armor: number | undefined; weapon: string }
  | { type: 'hit'; on: number; hp: number; head: boolean; weapon: string }
  | { type: 'died'; by: number | null; weapon: string }
  | { type: 'kill'; by: number | null; victim: number; weapon: string; yours: boolean }
  | { type: 'pickup'; what: string | undefined }
  | { type: 'drop'; at: number[] }
  | { type: 'crate'; what: string; name: string | undefined }
  | { type: 'powerup'; event: string; kind: string; name: string | undefined }
  | { type: 'medal'; medal: string | undefined }
  | { type: 'round'; state: string; winner: ServerMessages['round']['winner'] }
  | { type: 'flag'; team: 'red' | 'blue'; event: string; by: number | null | undefined }
  | { type: 'idle'; was: Intent['kind']; why: string }
  | { type: 'blocked'; at: number[]; to: number[]; why: string }
  | { type: 'lost'; id: number; why: string };
interface Action {
  move?: keyof typeof DIRECTIONS | { forward: number; strafe: number };
  look?: { heading: number; pitch?: number };
  turn?: { right?: number; up?: number };
  aim_at?: number;
  goto?: Vec;
  follow?: number;
  engage?: number;
  hold?: Vec | 'here';
  fire?: boolean;
  alt?: boolean;
  jump?: boolean;
  dodge?: boolean;
  kick?: boolean;
  use?: boolean;
  weapon?: string;
  join?: boolean;
  for_ms?: number;
}
function isConnection(net: GameNet): net is Connection {
  return 'url' in net && typeof net.url === 'string' && 'close' in net && typeof net.close === 'function';
}
function isAction(raw: unknown): raw is Action {
  return invalid(raw) === null;
}

const HOST = 255; // zirbel-net: whoever is the room's host
const UP = 1; // the game's JSON, a page to the authority (zirbel/room.js)
const DOWN = 2; // and the authority to a page
const TURN_RATE = (300 * Math.PI) / 180; // radians a second: how fast aim_at and the intents turn you, as a quick hand would
const AIM_NOISE = 0.006; // radians: how far aim_at's aim wanders off, as a hand's does
const ON_TARGET = 0.1; // radians: engage fires once its aim is this close
const SEEN = 120; // degrees: what you see, round where you look (a page shows 75 across, and you hear the rest close by)
const HEARD = 8; // metres: anyone this close you know is there
const MOST_EVENTS = 200;
const CONTROL_MS = 1500; // how long the controls hold, unless for_ms says
const INTENT_MS = 20000; // …and an intent, at the most, unless for_ms says
const WAYPOINT = 0.45; // metres: a waypoint is passed this close…
const STUCK_MS = 1200; // …and with no headway for this long, the way is worked out again…
const MOST_TRIES = 3; // …this many times, before goto says it's blocked
const CHASE_MS = 1000; // follow and engage work out the way to a moving player again this often
const LOST_MS = 6000; // a player not seen for this long, where they were last seen, is lost
const RANGE: [number, number] = [6, 16]; // metres engage keeps from whoever it fights
const STRAFE_MS: [number, number] = [600, 1400]; // how long engage strafes one way before the other

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const deg = (radians: number) => Math.round((radians * 180) / Math.PI);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
// A compass heading for the game's yaw: 0 north (-z), 90 east (+x), clockwise.
const heading = (yaw: number) => ((-deg(yaw) % 360) + 360) % 360;
const yawOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const flat = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export const about =
  'fps01, an arena shooter. Deathmatch: the first to the kill limit wins the round; in capture the flag, bring their flag to your own. ' +
  'You spawn with a rifle and a shotgun; pickups lie around, and crates drift down with health or a special. The void below the arena kills. ' +
  'observe() shows you, the players you see or hear, pickups and crates near you, what is round you (how far, and whether a step, a jump or a wall stops you), and the match. ' +
  'The game moves fast, so prefer intents, which carry on by themselves: goto a point (it finds the way and stops there), follow or engage a player (engage aims, fires and strafes), hold a point. ' +
  'Controls (move, look, turn, aim_at, fire, alt, jump, dodge, kick, weapon, use) hold 1.5 s unless for_ms says. ' +
  'Renamed in 0.3.2: spark (was lightning), the specials, powerups and medals.';

const NUMBER = (description: string, minimum: number, maximum: number) => ({
  type: 'number',
  description,
  minimum,
  maximum,
});
const VEC = (description: string) => ({
  type: 'array',
  description,
  items: { type: 'number', minimum: -200, maximum: 200 },
  minItems: 3,
  maxItems: 3,
});
const PLAYER = (description: string) => ({ type: 'integer', description, minimum: 1, maximum: 999 });

export const action = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'fps01 action',
  description:
    'What your seat does from now on: everything you leave out goes back to nothing (not moving, not firing). The controls hold for 1.5 s unless for_ms says; an intent (goto, follow, engage, hold: one at a time) carries on until it is done, or for up to 20 s.',
  type: 'object',
  additionalProperties: false,
  properties: {
    move: {
      description:
        'Which way to run, relative to where you look: a direction, or { forward, strafe } from -1 to 1.',
      oneOf: [
        {
          type: 'string',
          description: 'A direction.',
          enum: [
            'stop',
            'forward',
            'back',
            'left',
            'right',
            'forward-left',
            'forward-right',
            'back-left',
            'back-right',
          ],
        },
        {
          type: 'object',
          description: 'How much forward (back is -1) and to the right (left is -1).',
          additionalProperties: false,
          properties: {
            forward: NUMBER('Forward (1) or back (-1).', -1, 1),
            strafe: NUMBER('Right (1) or left (-1).', -1, 1),
          },
          required: ['forward', 'strafe'],
        },
      ],
    },
    look: {
      type: 'object',
      description:
        'Look this way, at once: a compass heading (0 north, 90 east) and a pitch (up is positive).',
      additionalProperties: false,
      properties: {
        heading: NUMBER('Compass degrees, 0 north, 90 east.', 0, 360),
        pitch: NUMBER('Degrees up (down is negative).', -85, 85),
      },
      required: ['heading'],
    },
    turn: {
      type: 'object',
      description: 'Turn from where you look now, at once: degrees right (left is negative), and up.',
      additionalProperties: false,
      properties: {
        right: NUMBER('Degrees to the right; negative turns left.', -180, 180),
        up: NUMBER('Degrees up; negative looks down.', -90, 90),
      },
    },
    aim_at: PLAYER(
      "Keep turning to aim at this player (their id), at a quick hand's speed, while you can see them.",
    ),
    goto: VEC(
      'Intent: go to this point [x, y, z] on foot. It finds the way (round walls, up steps, jumping onto a metre, dropping down, jump pads), and stops there: then the event arrived, or blocked if there is no way (it gets as near as it can).',
    ),
    follow: PLAYER(
      'Intent: keep within a few metres of this player, going round walls to where you last saw them; lost, if you lose them.',
    ),
    engage: PLAYER(
      'Intent: fight this player: aim at them, fire when on target, strafe from side to side, keep 6 to 16 m away, and go after them to where you last saw them; lost, if you lose them.',
    ),
    hold: {
      description:
        'Intent: stay at a point (go there first), aiming at the nearest player you can see; with fire, shooting them.',
      oneOf: [{ type: 'string', description: 'Where you are.', enum: ['here'] }, VEC('A point [x, y, z].')],
    },
    fire: { type: 'boolean', description: 'Hold the trigger: fire as often as the weapon allows.' },
    alt: {
      type: 'boolean',
      description:
        "Hold the weapon's second use: the rifle zooms (a tighter aim, slower running), the shotgun fires a slug that blows a doorway, the launchers fire their other projectile, the spark gun overloads, the railgun fires charged shots through walls.",
    },
    jump: { type: 'boolean', description: 'Hold jump: jump, and bunny hop each time you land.' },
    dodge: { type: 'boolean', description: 'Dodge once: a quick dash the way you move.' },
    kick: {
      type: 'boolean',
      description: 'Kick once: whoever is right in front of you takes a hit and goes flying.',
    },
    use: {
      type: 'boolean',
      description:
        'Use your special from a crate once: throw it, or for a teleport go where you look, or for an air strike call it in where you look.',
    },
    weapon: {
      type: 'string',
      description:
        'Switch to this weapon (one you carry): rifle, shotgun, launcher, rocket, spark, rail; or special, or trick (your juggling balls, faster running).',
      minLength: 1,
      maxLength: 20,
    },
    join: {
      type: 'boolean',
      description:
        "Join the room's game (you do by yourself when you start): on the map and in the mode its first player picked.",
    },
    for_ms: {
      type: 'integer',
      description:
        'How long this holds, in ms: 1500 unless you say for the controls, 20000 at most for an intent.',
      minimum: 33,
      maximum: 30000,
    },
  },
};

const SEEN_PLAYER = {
  type: 'object',
  description: 'A player you can see (or hear close by).',
  properties: {
    id: { type: 'integer' },
    seat: { type: ['integer', 'null'], description: 'Their seat in the room.' },
    name: { type: 'string', description: 'What the room calls them: Player One, Bot Two …' },
    team: { type: ['string', 'null'] },
    alive: { type: 'boolean' },
    hp: { type: 'integer' },
    armor: { type: 'integer' },
    at: { type: 'array' },
    distance: { type: 'number' },
    bearing: { type: 'integer', description: 'Degrees from where you look; negative is to your left.' },
    holding: { type: 'string' },
    visible: { type: 'boolean', description: 'Whether nothing stands between you.' },
  },
};
const WAY = {
  type: 'object',
  description:
    'One way: how far you can run straight on (steps you walk up on the way), and what stops you there: wall, jump (something you can jump onto: rise in metres), drop (the floor ends: depth in metres) or void (nothing below); null for nothing within 30 m.',
  properties: {
    clear: { type: 'number' },
    then: { type: ['string', 'null'] },
    rise: { type: 'number' },
    depth: { type: 'number' },
  },
};
export const observation = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'fps01 observation',
  description:
    "Your seat's view: distances in metres, bearings in degrees from where you look (negative is left), headings in compass degrees (0 north, 90 east), times in seconds.",
  type: 'object',
  properties: {
    t: { type: 'integer', description: 'Hub time, ms.' },
    joined: { type: 'boolean', description: 'Whether you are in the game yet.' },
    you: {
      type: 'object',
      description: 'You.',
      properties: {
        id: {
          type: ['integer', 'null'],
          description: "Your player's id: null until you are in the game. On zirbel, your seat.",
        },
        seat: { type: ['integer', 'null'], description: 'Your seat in the room.' },
        name: { type: 'string', description: 'What the room calls you, and everyone sees.' },
        alive: { type: 'boolean' },
        hp: { type: 'integer' },
        armor: { type: 'integer' },
        at: { type: 'array', description: '[x, y, z] of your feet.' },
        heading: { type: 'integer' },
        pitch: { type: 'integer' },
        speed: { type: 'number' },
        onGround: { type: 'boolean' },
        weapon: { type: 'string' },
        weapons: { type: 'object', description: 'What you carry: shots left (null: never runs out).' },
        special: { type: ['string', 'null'] },
        powerup: { type: ['object', 'null'] },
        team: { type: ['string', 'null'] },
        kills: { type: 'integer' },
        deaths: { type: 'integer' },
        respawnIn: { type: 'number' },
      },
    },
    doing: {
      type: ['object', 'null'],
      description:
        'The intent you are on, if any: what, towards what, how far is left on the way, and how long it has left.',
    },
    players: {
      type: 'array',
      description: 'The players you can see, or hear close by, nearest first.',
      items: SEEN_PLAYER,
    },
    pickups: {
      type: 'array',
      description:
        "Pickups within the radar's range: what, where, and the seconds until each is back (0: it is there).",
      items: { type: 'object' },
    },
    crates: {
      type: 'array',
      description: "Crates within the radar's range, and drops coming down.",
      items: { type: 'object' },
    },
    around: {
      type: 'object',
      description:
        'What is round you, each way (ahead, right, behind, left), from the floor to the top of your head.',
      properties: { ahead: WAY, right: WAY, behind: WAY, left: WAY },
    },
    match: {
      type: 'object',
      description:
        'The round: mode, map, seconds left, sudden death, whether it is over, the kill limit, the leader, your rank.',
    },
  },
};

type Player = PlayerSnapshot;
type Intent =
  | { kind: 'goto'; to: Vec }
  | { kind: 'follow'; id: number }
  | { kind: 'engage'; id: number }
  | { kind: 'hold'; at: Vec };
interface Held {
  move: { forward: number; strafe: number };
  aimAt: number | null;
  intent: Intent | null;
  fire: boolean;
  alt: boolean;
  jump: boolean;
  until: number;
}
// The way an intent is taking: where to, the route, the waypoint it's making for, and its headway.
interface Walk {
  to: Vec;
  route: Route;
  next: number;
  best: number;
  bestAt: number;
  tries: number;
  at: number;
}
// What an intent does in one tick, as the controls would.
interface Steer {
  move: { forward: number; strafe: number };
  face: Vec | null;
  aimAt: number | null;
  fire: boolean;
  jump: boolean;
}
// What the platform says about this seat: what the hub calls it, its seat, and the room's names by seat.
export interface Me {
  name?: string;
  seat?: number;
  names?: () => Record<number, string> | ReadonlyMap<number, string>;
}
export interface PlaySession {
  observe(): ReturnType<Session['observe']>;
  act(action: unknown): { ok: true } | { ok: false; error: string };
  events(): ReturnType<Session['events']>;
  stop(): void;
}

const STILL: Held = {
  move: { forward: 0, strafe: 0 },
  aimAt: null,
  intent: null,
  fire: false,
  alt: false,
  jump: false,
  until: Infinity,
};
const DIRECTIONS: Record<string, [number, number]> = {
  stop: [0, 0],
  forward: [1, 0],
  back: [-1, 0],
  left: [0, -1],
  right: [0, 1],
  'forward-left': [1, -1],
  'forward-right': [1, 1],
  'back-left': [-1, -1],
  'back-right': [-1, 1],
};

export function start(net: GameNet, me: Me = {}): Session {
  return new Session(net, me);
}

export default { about, observation, action, start };

class Session implements PlaySession {
  readonly net: GameNet;
  readonly me: Me;
  data = { data: DATA, hash: HASH as string };
  voxels = new Voxels();
  you = {
    id: null as number | null,
    alive: false,
    feet: [0, 0, 0] as Vec,
    velocity: [0, 0, 0] as Vec,
    yaw: 0,
    pitch: 0,
    onGround: false,
    dodgeAt: -Infinity,
    airDodged: false,
    padAt: -Infinity,
    spread: 0,
    respawnAt: 0,
    powerup: null as { kind: string; until: number } | null,
  };
  weapon = 'rifle';
  owned = new Set<string>(['rifle']);
  ammo: Record<string, number | null> = {};
  special: string | null = null;
  lastFire: Record<string, number> = {};
  lastKick = -Infinity;
  chargeFrom: number | null = null;
  players = new Map<number, Player>();
  seen = new Map<number, { at: Vec; t: number }>(); // where you last saw each player, and when
  items: number[] = [];
  crates: NonNullable<Snapshot['crates']> = [];
  drops: { at: Vec; t: number }[] = [];
  powerups: Snapshot['powerups'] | null = null;
  match: RoundSnapshot = {
    mode: 'dm',
    map: '',
    over: false,
    ms: 0,
    sudden: false,
    captures: { red: 0, blue: 0 },
  };
  joined = false;
  asked = false;
  held: Held = { ...STILL };
  walk: Walk | null = null;
  strafe = { side: 1, until: 0 };
  once = { dodge: false, kick: false, use: false };
  log: (AgentEvent & { t: number })[] = [];
  last = 0;
  wire = false; // the room's authority sends snapshots as bytes, and takes states so (it said in its hello)
  snapshots = new SnapshotReader(); // its snapshots, as bytes with only what changed
  stateSent: { feet: Vec; yaw: number; pitch: number; held: string } | null = null; // the last state sent, and when
  stateSentAt = -Infinity;
  sendClock = 0; // seconds since a state could last go
  timer: ReturnType<typeof setInterval>;
  onMessage: (from: number, type: number, r: { text(): string; rest(): Uint8Array }) => void;
  onOpen: () => void;
  onHost: () => void;

  constructor(net: GameNet, me: Me) {
    this.net = net;
    this.me = me;
    this.onMessage = (from, type, r) => {
      if (from !== net.hostId) return;
      if (type === SNAPSHOT) {
        const snapshot = this.snapshots.read(r.rest()); // null until a whole one has come
        if (snapshot) this.receive(snapshot);
        return;
      }
      if (type !== DOWN) return;
      this.receive(r.text());
    };
    this.onOpen = () => this.send({ type: 'hello' });
    this.onHost = () => (this.wire = false); // until the new host says
    net.on('message', this.onMessage);
    net.on('open', this.onOpen);
    if (isConnection(net)) net.on('resume', this.onOpen);
    net.on('host', this.onHost);
    if (net.connected && net.id) this.onOpen();
    this.last = net.now();
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  send(message: object) {
    this.net.send(HOST, UP, JSON.stringify(message));
  }

  // This session's data and map are the ones in force while it works: several sessions may share a worker.
  enter() {
    useData(this.data.data, { hash: this.data.hash });
    if (this.match['map'] && MAP.id !== this.match['map']) useMap(this.match['map']);
  }

  note(event: AgentEvent) {
    this.log.push({ t: Math.round(this.net.now()), ...event });
    if (this.log.length > MOST_EVENTS) this.log.shift();
  }

  // What the room calls a seat: the platform's name for it, or the game's.
  nameOf(player: Player) {
    const names = this.me.names?.();
    const named =
      player.seat === undefined || !names
        ? undefined
        : names instanceof Map
          ? names.get(player.seat)
          : (names as Record<number, string>)[player.seat];
    return named || player.name;
  }

  // ---- What the room says ----

  receive(raw: unknown) {
    const m = readServerMessage(raw);
    if (!m) return;
    this.enter();
    const you = this.you;
    switch (m['type']) {
      case 'hello':
        if (m['wire'] === 1) {
          this.wire = true;
          this.send({ type: 'wire' }); // it reads them too
        }
        if (m['data'] && m['data'] !== this['data'].hash) this.send({ type: 'data' });
        if (!this.asked || this.joined) this.join();
        break;
      case 'data': {
        if (m['hash'] === this.data['hash'] || checkData(m['blocks']).length) break;
        this.data = { data: m['blocks'], hash: m['hash'] };
        this.enter();
        break;
      }
      case 'joined':
        this.joined = true;
        this.match['mode'] = m['mode'];
        this.match['map'] = m['map'];
        useMap(m['map']);
        break;
      case 'nogame':
        this.asked = false;
        this.join();
        break;
      case 'world': {
        const mode = m.mode ?? 'dm',
          map = m.map ?? 'depot';
        this.match.mode = mode;
        this.match.map = map;
        useMap(map);
        this.voxels.reset(mode, map);
        for (const entry of m['history'] ?? []) this.voxels.apply(entry);
        if (typeof m['water'] === 'number' && Number.isFinite(m['water'])) this.voxels['water'] = m['water'];
        this.drops = [];
        this.walk = null;
        break;
      }
      case 'welcome':
        you['id'] = m['id'];
        break;
      case 'spawn':
        if (m['id'] !== you['id']) break;
        Object.assign(you, {
          alive: true,
          feet: [...m['feet']],
          velocity: [0, 0, 0],
          yaw: m['yaw'],
          pitch: 0,
        });
        this.owned = new Set(DATA.weapons.spawn);
        this.weapon = indexed(DATA.weapons.spawn, 0);
        this.chargeFrom = null;
        this.walk = null;
        this.note({ type: 'spawn', at: m['feet'].map(r1) });
        break;
      case 'snapshot':
        this['players'] = new Map(m['players'].map((p) => [p.id, p]));
        this['items'] = m['items'] ?? [];
        this['crates'] = m['crates'] ?? [];
        this['powerups'] = m['powerups'] ?? null;
        if (m['round']) Object.assign(this.match, m['round']);
        if (typeof m['water'] === 'number' && Number.isFinite(m['water'])) this.voxels['water'] = m['water'];
        break;
      case 'self':
        this.owned = new Set(m['weapons']);
        for (const name of ARSENAL) {
          const value = m.ammo[name];
          if (value === undefined) delete this.ammo[name];
          else this.ammo[name] = value;
        }
        this['special'] = m['special'] ?? null;
        you['powerup'] = m['powerup']
          ? { kind: m['powerup'].kind, until: this.net.now() + m['powerup'].ms }
          : null;
        if (this.weapon !== 'special' && this.weapon !== 'trick' && !this.owned.has(this.weapon))
          this.weapon = indexed(DATA.weapons.spawn, 0);
        break;
      case 'boom':
        if (m['hole']) this.voxels.carve(m['at'], m['hole']);
        if (m['push'] && you.alive) this.knock(m['at'], m['radius'] ?? 4.5, m['push']);
        break;
      case 'chip':
        if (m['broke']) this.voxels.breakOff(...m['cell']);
        else this.voxels['wear'].set(this.voxels.index(...m['cell']), m['wear']);
        break;
      case 'build':
      case 'fall':
        this.voxels.apply(m['entry']);
        break;
      case 'landed':
        if (m['entry']?.length > 1) this.voxels.apply(m['entry']);
        break;
      case 'push':
        if (!you.alive) break;
        for (const i of AXES) you.velocity[i] += m.velocity[i];
        you.onGround = false;
        break;
      case 'moved':
        you['feet'] = [m['feet'][0], m['feet'][1], m['feet'][2]];
        you.velocity = [0, 0, 0];
        this.walk = null;
        break;
      case 'hit':
        if (m['to'] === you.id)
          this.note({ type: 'hurt', by: m['from'], hp: m['hp'], armor: m['armor'], weapon: m['weapon'] });
        else if (m['from'] === you.id)
          this.note({ type: 'hit', on: m['to'], hp: m['hp'], head: Boolean(m['head']), weapon: m['weapon'] });
        break;
      case 'kill':
        if (m['victim'] === you.id) {
          you.alive = false;
          you.respawnAt = this.net.now() + DATA.rules.respawn.delayMs;
          this.note({ type: 'died', by: m['killer'], weapon: m['weapon'] });
        } else
          this.note({
            type: 'kill',
            by: m['killer'],
            victim: m['victim'],
            weapon: m['weapon'],
            yours: m['killer'] === you.id,
          });
        break;
      case 'item':
        if (m['event'] === 'taken' && m['by'] === you.id)
          this.note({ type: 'pickup', what: ITEMS[m['spot']]?.piece });
        break;
      case 'crate':
        if (m['event'] === 'dropping' && m.at) {
          this.drops.push({ at: m['at'], t: this.net.now() });
          this.note({ type: 'drop', at: m['at']?.map(r1) });
        } else if (m['event'] === 'taken' && m['by'] === you.id && m.item !== undefined)
          this.note({ type: 'crate', what: m['item'], name: CRATE_ITEMS[m['item']]?.name });
        break;
      case 'powerup':
        if (m['by'] === you.id || m['event'] === 'soon')
          this.note({ type: 'powerup', event: m['event'], kind: m['kind'], name: POWERUPS[m['kind']]?.name });
        break;
      case 'medal':
        if (m['id'] === you['id']) this.note({ type: 'medal', medal: m['medal'] });
        break;
      case 'round':
        this.note({ type: 'round', state: m['state'], winner: m['winner'] ?? null });
        if (m['state'] === 'over') this.match['over'] = true;
        break;
      case 'flag':
        this.note({ type: 'flag', team: m['team'], event: m['event'], by: m['by'] });
        break;
      default:
        break;
    }
  }

  join() {
    if (this.asked && !this.joined) return;
    this.asked = true;
    const map = MAP_ORDER.includes(this.match['map']) ? this.match['map'] : MAP_ORDER[0];
    this.send({
      type: 'create',
      map,
      mode: DATA.rules.modes[0],
      token: '0000000000000000',
      data: this.data.hash,
    });
  }

  // A blast nearby throws you, as it throws a page's player (main.js knockBack).
  knock(at: Vec, radius: number, strength: number) {
    const you = this.you;
    const centre: Vec = [you.feet[0], you.feet[1] + PLAYER_HEIGHT / 2, you.feet[2]];
    const offset = mapVector(centre, (v, i) => v - at[i]);
    const length = Math.hypot(...offset);
    const reach = radius + 1;
    if (length >= reach) return;
    const dir: Vec = length > 0.01 ? mapVector(offset, (v) => v / length) : [0, 1, 0];
    const wall = this.voxels.raycast(at, dir, length);
    if (wall && wall.distance < length - 0.05) return;
    const push = strength * (1 - length / reach);
    you.velocity[0] += dir[0] * push;
    you.velocity[2] += dir[2] * push;
    you.velocity[1] = Math.max(you.velocity[1], 0) + push * 0.55;
    you.onGround = false;
  }

  // ---- Thirty times a second: the held action (and the intent's), as a page's input ----

  tick() {
    this.enter();
    const now = this.net.now();
    const dt = Math.min(Math.max(now - this.last, 0) / 1000, 0.1);
    this.last = now;
    const you = this.you;
    for (const player of this.players.values())
      if (player.id !== you.id && player.alive && this.sees(player))
        this.seen.set(player.id, { at: [...player.feet], t: now });
    if (now > this.held.until) {
      if (this.held.intent) this.note({ type: 'idle', was: this.held.intent.kind, why: 'its time ran out' });
      this.held = { ...STILL };
      this.walk = null;
    }
    if (!you.alive || !this.joined) return;
    const held = this.held;
    const steer: Steer = held.intent
      ? this.pursue(held.intent, now)
      : { move: held.move, face: null, aimAt: held.aimAt, fire: held.fire, jump: held.jump };
    // Turning: aim at a player, or towards where the intent goes, at a quick hand's speed.
    let wish: Vec | null = null;
    const target = steer.aimAt !== null ? this.players.get(steer.aimAt) : undefined;
    const eye = eyePosition(you.feet);
    if (target?.alive && this.sees(target))
      wish = [target.feet[0] - eye[0], target.feet[1] + 1.2 - eye[1], target.feet[2] - eye[2]];
    else if (steer.face) wish = [steer.face[0] - you.feet[0], 0, steer.face[2] - you.feet[2]];
    let off = Infinity; // how far the aim is from the target, for engage's trigger
    if (wish && Math.hypot(wish[0], wish[2]) > 0.05) {
      const yaw = yawOf(wish[0], wish[2]);
      const pitch = Math.atan2(wish[1], Math.hypot(wish[0], wish[2]));
      const most = TURN_RATE * dt;
      you.yaw += Math.max(-most, Math.min(most, wrap(yaw - you.yaw)));
      you.pitch += Math.max(-most, Math.min(most, pitch - you.pitch));
      if (target) {
        you.yaw += (Math.random() - 0.5) * AIM_NOISE;
        you.pitch += (Math.random() - 0.5) * AIM_NOISE;
        off = Math.hypot(wrap(yaw - you.yaw), pitch - you.pitch);
      }
    }
    // Moving, by the same rules as a page.
    const zoom = held.alt && zoomOf(this.weapon) ? zoomOf(this.weapon) : null;
    const flying = you.powerup?.kind === 'lift' && you.powerup.until > now;
    const lift = DATA.movement.lift;
    const input = {
      forward: steer.move.forward,
      strafe: steer.move.strafe,
      yaw: you.yaw,
      jump: steer.jump && !flying,
      dodge: this.once.dodge,
    };
    this.once.dodge = false;
    const rush = you.powerup?.kind === 'rush' && you.powerup.until > now ? (POWERUPS['rush']?.speed ?? 1) : 1;
    const trick = this.weapon === 'trick' ? TRICK_SPEED : 1;
    const flight =
      flying && lift ? { gravity: steer.jump ? -lift.rise : lift.fall, airAccel: lift.airAccel } : {};
    const push = Math.min(1, Math.hypot(input.forward, input.strafe));
    stepMovement(you, input, dt, this.voxels, now, {
      speed: MOVE_SPEED * push * (zoom ? 1 - zoom.slow : 1) * rush * trick,
      cap: SPEED_CAP * trick,
      ...flight,
    });
    you.spread = spreadFor(you.velocity, you.onGround) * (zoom ? 1 - zoom.steady : 1);
    // Where it is, as a page says it: at most SEND_RATE times a second, and only when it changed.
    this.sendClock = Math.min(this.sendClock + dt, 2 / SEND_RATE);
    if (this.sendClock >= 1 / SEND_RATE) {
      this.sendClock -= 1 / SEND_RATE;
      const state: NonNullable<Session['stateSent']> = {
        feet: [...you.feet],
        yaw: you.yaw,
        pitch: you.pitch,
        held: this.weapon,
      };
      if (stateChanged(state, this.stateSent, now - this.stateSentAt)) {
        this.stateSent = state;
        this.stateSentAt = now;
        if (this.wire) this.net.send(HOST, STATE, writeState(state));
        else
          this.send({
            type: 'state',
            feet: state.feet.map(r2),
            yaw: r2(state.yaw),
            pitch: r2(state.pitch),
            held: state.held,
          });
      }
    }
    // The trigger, the kick and the special.
    if (this.once.kick) this.kick(now);
    if (this.once.use) this.useSpecial();
    this.once.kick = this.once.use = false;
    const firing =
      steer.fire && (held.intent?.kind === 'engage' || held.intent?.kind === 'hold' ? off < ON_TARGET : true);
    if (firing) this.fire(false, now);
    else if (held.alt && this.altFires()) this.fire(true, now);
  }

  // What an intent does this tick, and when it's done, the event that says so.
  pursue(intent: Intent, now: number): Steer {
    const you = this.you;
    const stand: Steer = {
      move: { forward: 0, strafe: 0 },
      face: null,
      aimAt: null,
      fire: false,
      jump: false,
    };
    const done = (event: AgentEvent) => {
      this.note(event);
      this.held = { ...STILL, until: now + CONTROL_MS };
      this.walk = null;
      return stand;
    };
    if (intent.kind === 'goto') {
      const step = this.walkTo(intent.to, now);
      if (step === 'arrived') return done({ type: 'arrived', at: mapVector(you.feet, r1) });
      if (step === 'blocked')
        return done({
          type: 'blocked',
          at: mapVector(you.feet, r1),
          to: intent.to.map(r1),
          why:
            this.walk?.route.reached === false
              ? "there's no way there on foot: this is as near as it goes"
              : 'stuck: the way is blocked',
        });
      return step;
    }
    if (intent.kind === 'hold') {
      const enemy = this.nearestEnemy();
      if (flat(you.feet, intent.at) > 1.2) {
        const step = this.walkTo(intent.at, now);
        if (typeof step !== 'string')
          return { ...step, aimAt: enemy?.id ?? null, fire: this.held.fire && Boolean(enemy) };
        if (step === 'blocked')
          return done({
            type: 'blocked',
            at: mapVector(you.feet, r1),
            to: intent.at.map(r1),
            why: "can't get to where it was to hold",
          });
      }
      this.walk = null;
      return { ...stand, aimAt: enemy?.id ?? null, fire: this.held.fire && Boolean(enemy) };
    }
    // follow and engage: after a player, to where they were last seen.
    const player = this.players.get(intent.id);
    if (!player) return done({ type: 'lost', id: intent.id, why: 'they left' });
    if (!player.alive) return done({ type: 'lost', id: intent.id, why: 'they died' });
    const visible = this.sees(player);
    const last = this.seen.get(intent.id);
    if (!visible && (!last || now - last.t > LOST_MS))
      return done({ type: 'lost', id: intent.id, why: 'out of sight' });
    const where = visible ? player.feet : last!.at;
    const distance = flat(you.feet, where);
    if (intent.kind === 'follow') {
      if (visible && distance < 4) {
        this.walk = null;
        return { ...stand, face: where };
      }
      const step = this.walkTo(where, now, CHASE_MS);
      if (step === 'arrived' && !visible)
        return done({ type: 'lost', id: intent.id, why: 'not where they were last seen' });
      return typeof step === 'string' ? stand : step;
    }
    // engage: in sight, fight from where you are; else after them.
    if (visible) {
      this.walk = null;
      if (now > this.strafe.until)
        this.strafe = {
          side: -this.strafe.side,
          until: now + STRAFE_MS[0] + Math.random() * (STRAFE_MS[1] - STRAFE_MS[0]),
        };
      // Never strafe (or back) off an edge: the other way, or not at all.
      const safe = (turn: number) => {
        const way = this.probe(you.yaw + turn);
        return !((way.then === 'void' || way.then === 'drop') && way.clear < 2.5);
      };
      if (!safe(-this.strafe.side * (Math.PI / 2))) this.strafe.side = -this.strafe.side;
      const strafe = safe(-this.strafe.side * (Math.PI / 2)) ? this.strafe.side : 0;
      let forward = distance > RANGE[1] ? 0.8 : distance < RANGE[0] ? -0.6 : 0;
      if (forward < 0 && !safe(Math.PI)) forward = 0;
      return { move: { forward, strafe }, face: null, aimAt: player.id, fire: true, jump: false };
    }
    const step = this.walkTo(where, now, CHASE_MS);
    if (step === 'arrived')
      return done({ type: 'lost', id: intent.id, why: 'not where they were last seen' });
    return typeof step === 'string' ? stand : step;
  }

  // The nearest player you can see, if any.
  nearestEnemy() {
    const you = this.you;
    let best: Player | undefined;
    for (const player of this.players.values()) {
      if (
        player.id === you.id ||
        !player.alive ||
        (you.id !== null && player.team && player.team === this.players.get(you.id)?.team) ||
        !this.sees(player)
      )
        continue;
      if (!best || flat(you.feet, player.feet) < flat(you.feet, best.feet)) best = player;
    }
    return best;
  }

  // One tick on the way to a point: the way found (again, when the point moved, every `again` ms if
  // it says, or when there's no headway), and the controls to make for its next waypoint. 'arrived'
  // there, or 'blocked'.
  walkTo(to: Vec, now: number, again = Infinity): Steer | 'arrived' | 'blocked' {
    const you = this.you;
    let walk = this.walk;
    if (!walk || flat(walk.to, to) > 1.5 || Math.abs(walk.to[1] - to[1]) > 1 || now - walk.at > again)
      walk = this.walk = this.plan(to, now, walk?.tries ?? 0);
    const path = walk.route.path;
    if (!path.length) return walk.route.reached || flat(you.feet, to) < 1 ? 'arrived' : 'blocked';
    let point = indexed(path, walk.next);
    let distance = flat(you.feet, point);
    // A waypoint is passed when you're on it (or past it, on the level, when it's not the last).
    while (distance < WAYPOINT && (Math.abs(point[1] - you.feet[1]) < 0.6 || !you.onGround)) {
      walk.next++;
      walk.best = Infinity;
      walk.bestAt = now;
      if (walk.next >= path.length) return walk.route.reached ? 'arrived' : 'blocked';
      point = indexed(path, walk.next);
      distance = flat(you.feet, point);
    }
    // No headway for a while: work the way out again, from here; and in the end, give up.
    if (distance < walk.best - 0.15) {
      walk.best = distance;
      walk.bestAt = now;
    } else if (now - walk.bestAt > STUCK_MS && you.onGround) {
      if (walk.tries >= MOST_TRIES) return 'blocked';
      walk = this.walk = this.plan(to, now, walk.tries + 1);
      if (!walk.route.path.length) return walk.route.reached ? 'arrived' : 'blocked';
      point = indexed(walk.route.path, 0);
      distance = flat(you.feet, point);
    }
    const turnLeft = Math.abs(wrap(yawOf(point[0] - you.feet[0], point[2] - you.feet[2]) - you.yaw));
    // Up onto something higher than a step: jump, close to it, as a page's player would.
    const rise = point[1] - you.feet[1];
    const jump = you.onGround && distance < 1.6 && (rise > 0.55 || walk.route.jumps.includes(walk.next));
    return {
      move: { forward: turnLeft < 0.9 ? 1 : 0.25, strafe: 0 },
      face: point,
      aimAt: null,
      fire: false,
      jump,
    };
  }

  plan(to: Vec, now: number, tries: number): Walk {
    const found = route(this.voxels, this.you.feet, to, JUMP_PADS);
    return { to: [...to], route: found, next: 0, best: Infinity, bestAt: now, tries, at: now };
  }

  altFires() {
    const kind = WEAPONS[this.weapon]?.alt?.kind;
    return kind === 'slug' || kind === 'launch' || kind === 'overload' || kind === 'charge';
  }

  // Whether you can see someone: in front of you (or close enough to hear), with nothing in between.
  sees(player: Player) {
    const eye = eyePosition(this.you.feet);
    const chest: Vec = [player.feet[0], player.feet[1] + 1.2, player.feet[2]];
    const offset = mapVector(chest, (v, i) => v - eye[i]);
    const distance = Math.hypot(...offset);
    if (distance < 0.01) return true;
    const bearing = Math.abs(deg(wrap(yawOf(offset[0], offset[2]) - this.you.yaw)));
    if (bearing > SEEN / 2 && distance > HEARD) return false;
    if (player.cloaked && distance > HEARD) return false;
    const wall = this.voxels.raycast(
      eye,
      mapVector(offset, (v) => v / distance),
      distance,
    );
    return !wall || wall.distance >= distance - 0.3;
  }

  ready(name: string, alt: boolean, now: number) {
    const { key, cooldown, cost } = costOf(name, alt);
    const rush =
      this.you.powerup?.kind === 'rush' && this.you.powerup.until > now ? (POWERUPS['rush']?.speed ?? 1) : 1;
    return (
      now - (this.lastFire[key] ?? -Infinity) >= cooldown / rush && (this.ammo[name] ?? Infinity) >= cost
    );
  }

  look(): Vec {
    const { yaw, pitch } = this.you;
    return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  }

  // Who a ray from your eyes hits first, before the wall, as { id, distance, head }; or everyone along it.
  hits(origin: Vec, dir: Vec, reach: number) {
    const found: { id: number; distance: number; head: boolean }[] = [];
    for (const player of this.players.values()) {
      if (player.id === this.you.id || !player.alive) continue;
      const distance = rayBox(origin, dir, playerBox(player.feet));
      if (distance >= reach) continue;
      found.push({
        id: player.id,
        distance,
        head: origin[1] + dir[1] * distance - player.feet[1] >= HEAD_HEIGHT,
      });
    }
    return found.sort((a, b) => a.distance - b.distance);
  }

  fire(alt: boolean, now: number) {
    const name = this.weapon;
    if (name === 'special') {
      if (!alt) this.useSpecial();
      return;
    }
    if (name === 'trick') {
      // Your juggling balls: the trigger throws one.
      if (alt || now - (this.lastFire['trick'] ?? -Infinity) < THROW.cooldownMs) return;
      this.lastFire['trick'] = now;
      this.send({
        type: 'fire',
        weapon: 'trick',
        feet: this.you.feet.map(r2),
        dir: this.look(),
        velocity: this.you.velocity.map(r2),
      });
      return;
    }
    const spec = WEAPONS[name];
    if (!spec) return;
    const alternate = alt ? spec.alt : undefined;
    const second = alternate?.kind ?? null;
    if (alternate?.kind === 'charge') {
      // Charged rail shots: hold for the charge, then it fires.
      if (this.chargeFrom === null) {
        if (this.ready(name, false, now)) this.chargeFrom = now;
        return;
      }
      if (now - this.chargeFrom < alternate.ms) return;
      this.chargeFrom = null;
    }
    const charged = second === 'charge';
    if (!this.ready(name, alt && !charged, now)) return;
    const { key, cost } = costOf(name, alt && !charged);
    this.lastFire[key] = now;
    const ammo = this.ammo[name];
    if (typeof ammo === 'number' && Number.isFinite(ammo) && cost) this.ammo[name] = ammo - cost;
    const you = this.you;
    const origin = eyePosition(you.feet);
    const base = { type: 'fire', weapon: name, feet: you.feet.map(r2) };
    if (second === 'launch' || spec.kind === 'launcher') {
      this.send({
        ...base,
        alt: second === 'launch',
        dir: scatter(this.look(), spec.projectile === 'rocket' ? 0 : you.spread),
        velocity: you.velocity.map(r2),
      });
      return;
    }
    if (spec.range === undefined) throw new Error(`Weapon ${name} has no range`);
    if (spec.kind === 'pellets' && second !== 'slug') {
      if (spec.pellets === undefined || spec.cone === undefined)
        throw new Error(`Pellet weapon ${name} has no pellet contract`);
      const centre = scatter(this.look(), you.spread * 0.5);
      const counts = new Map<number, number>();
      for (let i = 0; i < spec.pellets; i++) {
        const dir = scatter(centre, spec.cone);
        const wall = this.voxels.raycast(origin, dir, spec.range)?.distance ?? spec.range;
        const first = this.hits(origin, dir, wall)[0];
        if (first) counts.set(first.id, (counts.get(first.id) ?? 0) + 1);
      }
      this.send({ ...base, dir: centre, hits: [...counts].map(([id, count]) => ({ id, count })) });
      return;
    }
    const dir = scatter(this.look(), you.spread);
    if (spec.kind === 'rail' && second !== 'slug' && second !== 'overload') {
      const { reach } = railReach(
        this.voxels,
        origin,
        dir,
        charged,
        spec.alt?.kind === 'charge' ? spec.alt.pierce : 0,
      );
      this.send({
        ...base,
        alt: charged,
        dir,
        hits: this.hits(origin, dir, reach).map(({ id, head }) => ({ id, head })),
      });
      return;
    }
    const range = alternate?.kind === 'slug' ? alternate.range : spec.range;
    const wall = this.voxels.raycast(origin, dir, range)?.distance ?? range;
    const first = this.hits(origin, dir, wall)[0];
    this.send({
      ...base,
      alt: Boolean(second),
      dir,
      hits: first ? [{ id: first.id, head: first.head }] : [],
    });
  }

  kick(now: number) {
    if (now - this.lastKick < KICK_COOLDOWN_MS) return;
    this.lastKick = now;
    const first = this.hits(eyePosition(this.you.feet), this.look(), KICK_REACH + 0.4)[0];
    this.send({ type: 'kick', hit: first?.id ?? null });
  }

  useSpecial() {
    const kind = this.special;
    const now = this.net.now();
    if (!kind || now - (this.lastFire['special'] ?? -Infinity) < 600) return;
    this.lastFire['special'] = now;
    const you = this.you;
    const origin = eyePosition(you.feet);
    const dir = this.look();
    if (kind === 'teleport' || kind === 'airstrike') {
      const hit = this.voxels.raycast(origin, dir, MAX_RANGE);
      if (!hit) return;
      const at = mapVector(origin, (v, i) => r2(v + dir[i] * (hit.distance - 0.05)));
      if (kind === 'teleport' && hit.normal[1] !== 1) return; // only onto a floor you look at
      this.send({ type: 'special', at, dir: [dir[0], 0, dir[2]] });
    } else this.send({ type: 'special', feet: you.feet.map(r2), dir, velocity: you.velocity.map(r2) });
  }

  // ---- What an agent sees and does ----

  observe() {
    this.enter();
    const you = this.you;
    const now = this.net.now();
    const self = you.id !== null ? this.players.get(you.id) : undefined;
    const range = DATA.radar.range;
    const near = (at: Vec) => {
      const dx = at[0] - you.feet[0];
      const dz = at[2] - you.feet[2];
      return {
        distance: r1(Math.hypot(dx, dz, at[1] - you.feet[1])),
        bearing: deg(wrap(yawOf(dx, dz) - you.yaw)) * -1,
      };
    };
    const players = [...this.players.values()]
      .filter((p) => p.id !== you.id && (this.sees(p) || !p.alive))
      .map((p) => ({
        id: p.id,
        seat: p.seat ?? null,
        name: this.nameOf(p),
        team: p.team,
        alive: p.alive,
        hp: p.hp,
        armor: p.armor,
        at: mapVector(p.feet, r1),
        ...near(p.feet),
        holding: p.held,
        visible: this.sees(p),
      }))
      .sort((a, b) => a.distance - b.distance);
    const pickups = ITEMS.map((item, i) => ({
      piece: item.piece,
      gives: item.weapon ?? item.kind,
      at: mapVector(item.at, r1),
      ...near(item.at),
      back: this.items[i] ?? 0,
    }))
      .filter((p) => p.distance <= range)
      .sort((a, b) => a.distance - b.distance);
    const crates = [
      ...this.crates.map((c) => ({
        look: c[1],
        at: mapVector([c[2], c[3], c[4]], r1),
        landed: c[5] === 1,
        ...near([c[2], c[3], c[4]]),
      })),
      ...this.drops
        .filter((d) => now - d.t < 8000)
        .map((d) => ({ look: 'coming', at: mapVector(d.at, r1), landed: false, ...near(d.at) })),
    ].filter((c) => c.distance <= range);
    const ranked = [...this.players.values()].sort((a, b) => b.kills - a.kills);
    const leader =
      ranked[0] && ranked[0].kills > 0 && (!ranked[1] || ranked[1].kills < ranked[0].kills)
        ? { id: ranked[0].id, name: this.nameOf(ranked[0]), kills: ranked[0].kills }
        : null;
    const weapons = Object.fromEntries(
      [...this.owned].map((name) => [name, Number.isFinite(this.ammo[name]) ? this.ammo[name] : null]),
    );
    return {
      t: Math.round(now),
      joined: this.joined,
      you: {
        id: you.id,
        seat: this.me.seat ?? (this.net.id || null),
        name: this.me.name || (self ? this.nameOf(self) : this.net.name) || 'Bot',
        alive: you.alive,
        hp: self?.hp ?? 0,
        armor: self?.armor ?? 0,
        at: mapVector(you.feet, r1),
        heading: heading(you.yaw),
        pitch: deg(you.pitch),
        speed: r1(Math.hypot(you.velocity[0], you.velocity[2])),
        onGround: you.onGround,
        weapon: this.weapon,
        weapons,
        special: this.special,
        powerup:
          you.powerup && you.powerup.until > now
            ? { kind: you.powerup.kind, s: Math.ceil((you.powerup.until - now) / 1000) }
            : null,
        team: self?.team ?? null,
        kills: self?.kills ?? 0,
        deaths: self?.deaths ?? 0,
        respawnIn: you.alive ? 0 : r1(Math.max(0, you.respawnAt - now) / 1000),
      },
      doing: this.doing(now),
      players,
      pickups,
      crates,
      pedestal:
        PEDESTAL && this.powerups
          ? {
              at: mapVector(PEDESTAL, r1),
              powerup: this.powerups['pedestal'] ?? null,
              soon: this.powerups['soon']
                ? { kind: this.powerups['soon'].kind, s: Math.ceil(this.powerups['soon'].ms / 1000) }
                : null,
              ...near(PEDESTAL),
            }
          : null,
      around: this.around(),
      match: {
        mode: this.match['mode'],
        map: this.match['map'],
        name: MAPS[this.match['map']]?.name ?? this.match['map'],
        timeLeft: Math.round((this.match['ms'] ?? 0) / 1000),
        sudden: Boolean(this.match['sudden']),
        over: Boolean(this.match['over']),
        killsToWin: DATA.rules.deathmatch.kills,
        leader,
        rank: ranked.findIndex((p) => p.id === you.id) + 1,
        players: this.players.size,
        ...(this.match['mode'] === 'ctf'
          ? { captures: this.match['captures'], flags: this.match['flags'] }
          : {}),
      },
    };
  }

  // The intent you're on: what, after what, how far the way has left to go, and its time left.
  doing(now: number) {
    const intent = this.held.intent;
    if (!intent) return null;
    const walk = this.walk;
    const left = walk
      ? walk.route.path
          .slice(walk.next)
          .reduce((sum, point, i, all) => sum + flat(i ? indexed(all, i - 1) : this.you.feet, point), 0)
      : 0;
    const after =
      intent.kind === 'goto'
        ? { to: intent.to.map(r1) }
        : intent.kind === 'hold'
          ? { at: intent.at.map(r1) }
          : { id: intent.id };
    return {
      intent: intent.kind,
      ...after,
      way: walk ? r1(left) : null,
      s: r1(Math.max(0, this.held.until - now) / 1000),
    };
  }

  // Each way (ahead, right, behind, left): how far you can run straight on, from the floor to the
  // top of your head, walking up steps on the way; and what stops you there.
  around() {
    const yaw = this.you.yaw;
    return {
      ahead: this.probe(yaw),
      right: this.probe(yaw - Math.PI / 2),
      behind: this.probe(yaw + Math.PI),
      left: this.probe(yaw + Math.PI / 2),
    };
  }

  probe(yaw: number) {
    const you = this.you;
    const dir: [number, number] = [-Math.sin(yaw), -Math.cos(yaw)];
    const solid = (x: number, y: number, z: number) =>
      this.voxels.get(cellOf(x, 0), cellOf(y, 1), cellOf(z, 2)) !== 0;
    const R = 0.3; // a little narrower than you are, so a wall alongside doesn't count
    const corners: [number, number][] = [
      [-R, -R],
      [R, -R],
      [-R, R],
      [R, R],
      [0, 0],
    ];
    // The top of the highest thing in your footprint at (x, z) between two heights; -Infinity if nothing.
    const top = (x: number, z: number, from: number, to: number) => {
      let highest = -Infinity;
      for (const [dx, dz] of corners) {
        for (let y = to; y >= Math.max(from, highest); y -= 0.25) {
          if (!solid(x + dx, y, z + dz)) continue;
          highest = Math.max(highest, Math.floor(y / 0.5) * 0.5 + 0.5);
          break;
        }
      }
      return highest;
    };
    let level = you.feet[1];
    for (let d = 0.25; d <= 30; d += 0.25) {
      const [x, z] = [you.feet[0] + dir[0] * d, you.feet[2] + dir[1] * d];
      const high = top(x, z, level + 0.05, level + PLAYER_HEIGHT);
      if (high > -Infinity) {
        const rise = high - level;
        const roomAbove = top(x, z, high + 0.05, high + PLAYER_HEIGHT) === -Infinity;
        if (rise <= 0.55 && roomAbove) {
          level = high; // a step: walk on up
          continue;
        }
        const clear = r1(d - 0.25);
        return rise <= 1.05 && roomAbove ? { clear, then: 'jump', rise: r1(rise) } : { clear, then: 'wall' };
      }
      const ground = top(x, z, level - 30, level - 0.05);
      if (ground === -Infinity) return { clear: r1(d), then: 'void' };
      if (level - ground > 0.75) return { clear: r1(d), then: 'drop', depth: r1(level - ground) };
      level = ground;
    }
    return { clear: 30, then: null };
  }

  act(raw: unknown): { ok: true } | { ok: false; error: string } {
    this.enter();
    if (!isAction(raw)) return { ok: false, error: invalid(raw) ?? 'invalid action' };
    const a = raw;
    const you = this.you;
    const intents = (['goto', 'follow', 'engage', 'hold'] as const).filter((key) => a[key] !== undefined);
    if (intents.length > 1) return { ok: false, error: `one intent at a time: ${intents.join(', ')}` };
    for (const key of ['aim_at', 'follow', 'engage'] as const)
      if (a[key] !== undefined && !this.players.has(a[key]))
        return { ok: false, error: `there is no player ${a[key]}` };
    if (a['engage'] !== undefined && a['engage'] === you.id)
      return { ok: false, error: "you can't engage yourself" };
    if (typeof a['weapon'] === 'string') {
      const name = a['weapon'];
      if (name === 'special' ? !this.special : name !== 'trick' && !this.owned.has(name))
        return { ok: false, error: `you don't carry ${name}` };
      this.weapon = name;
      this.chargeFrom = null;
    }
    if (a['look']) {
      you.yaw = (-a['look'].heading * Math.PI) / 180;
      if (a.look.pitch !== undefined && Number.isFinite(a.look.pitch))
        you.pitch = (a['look'].pitch * Math.PI) / 180;
    }
    if (a['turn']) {
      you.yaw = wrap(you.yaw - ((a['turn'].right ?? 0) * Math.PI) / 180);
      you.pitch = Math.max(-1.48, Math.min(1.48, you.pitch + ((a['turn'].up ?? 0) * Math.PI) / 180));
    }
    const [forward, strafe] =
      typeof a['move'] === 'string'
        ? lookup(DIRECTIONS, a['move'])
        : a['move']
          ? [a['move'].forward, a['move'].strafe]
          : [0, 0];
    const intent: Intent | null =
      a['goto'] !== undefined
        ? { kind: 'goto', to: [a['goto'][0], a['goto'][1], a['goto'][2]] }
        : a['follow'] !== undefined
          ? { kind: 'follow', id: a['follow'] }
          : a['engage'] !== undefined
            ? { kind: 'engage', id: a['engage'] }
            : a['hold'] !== undefined
              ? {
                  kind: 'hold',
                  at: a['hold'] === 'here' ? [...you.feet] : [a['hold'][0], a['hold'][1], a['hold'][2]],
                }
              : null;
    const now = this.net.now();
    this.held = {
      move: { forward, strafe },
      aimAt: a['aim_at'] ?? null,
      intent,
      fire: a['fire'] === true,
      alt: a['alt'] === true,
      jump: a['jump'] === true,
      until: now + (a['for_ms'] ?? (intent ? INTENT_MS : CONTROL_MS)),
    };
    this.walk = null;
    if (!this.held.alt) this.chargeFrom = null;
    if (a['dodge']) this.once['dodge'] = true;
    if (a['kick']) this.once['kick'] = true;
    if (a['use']) this.once['use'] = true;
    if (a['join'] && !this.joined) {
      this.asked = false;
      this.join();
    }
    return { ok: true };
  }

  events() {
    const out = this.log;
    this.log = [];
    return out;
  }

  stop() {
    clearInterval(this.timer);
    this.net.off('message', this.onMessage);
    this.net.off('open', this.onOpen);
    if (isConnection(this.net)) this.net.off('resume', this.onOpen);
    this.net.off('host', this.onHost);
  }
}

// What's wrong with an action, by its schema (shared/schema.js, the validator the engine checks its
// data with), or null.
function invalid(raw: unknown): string | null {
  const { problems } = validate(action, raw);
  const first = problems[0];
  if (!first) return null;
  return first.path === '/'
    ? `the action ${first.message}`
    : `${first.path.slice(1).replace(/\//g, '.')} ${first.message}`;
}
