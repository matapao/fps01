// Gameplay numbers shared by the server and the browser. Distances are in metres, speeds in m/s,
// times in milliseconds. The tunable ones come from the data (data/movement.json, data/rules.json,
// data/characters.json, data/weapons.json): they're live, and change with it at the next round.
// The ones fixed here belong to the engine: the wire's rates, and the body the arena's half-metre
// cells and the box characters are built round.

import { onData } from './data.js';

export const TICK_RATE = 30; // the game moves on this many times a second…
export const SNAPSHOT_RATE = 20; // …and tells everyone how it stands this often
export const SEND_RATE = 20; // a browser says where it is at most this often (and only when that changes)

export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.6;
export const HEAD_HEIGHT = 1.45; // hits above this height (measured from the feet) are headshots

export const MAX_RANGE = 200; // the farthest a shot reaches (each weapon's own range is in data/weapons.json)

// A piece of the arena that comes loose and topples over takes this long to tip over, before it
// falls the rest of the way (server/physics.js; the browsers draw it the same).
export const TOPPLE_MS = 650;

// Movement (see shared/movement.js and data/movement.json).
/** @type {number} */
export let MOVE_SPEED; // running
/** @type {number} */
export let JUMP_SPEED; // 7.5 gets you onto a 1 m crate
/** @type {number} */
export let GRAVITY; // m/s²
/** @type {number} */
export let GROUND_ACCEL; // how quickly you get up to speed on the ground
/** @type {number} */
export let AIR_ACCEL; // how much you can steer in the air: what makes strafe-jumping work
/** @type {number} */
export let FRICTION;
/** @type {number} */
export let STOP_SPEED; // below this, friction stops you as if you were going this fast
/** @type {number} */
export let SPEED_CAP; // horizontal speed above this fades away
/** @type {number} */
export let DODGE_SPEED; // Shift: a quick dash in the direction you're moving
/** @type {number} */
export let DODGE_HOP;
/** @type {number} */
export let DODGE_COOLDOWN_MS;
/** @type {number} */
export let PAD_COOLDOWN_MS; // a jump pad won't throw you twice in a row

// Health, and coming back.
/** @type {number} */
export let MAX_HEALTH; // the most health pickups give you (a Health Orb more)
/** @type {number} */
export let START_HEALTH; // what you spawn with
/** @type {number} */
export let DECAY_ABOVE; // health and armor above this tick back down…
/** @type {number} */
export let DECAY_PER_SECOND; // …this many points a second
/** @type {number} */
export let RESPAWN_MS;
/** @type {number} */
export let SPAWN_PROTECTION_MS; // no damage just after you spawn, until you fire

// Aim: shots scatter inside a cone around where you look. Its half-angle, in radians, is small
// standing still and grows with how you move.
/** @type {number} */
export let SPREAD_STILL; // standing still: almost exact
/** @type {number} */
export let SPREAD_MOVING; // added at full running speed
/** @type {number} */
export let SPREAD_AIR; // added while in the air

// Damage.
/** @type {number} */
export let NADE_SELF_DAMAGE; // share of the damage your own blast does to you
/** @type {boolean} */
export let FRIENDLY_FIRE; // whether teammates can hurt each other
/** @type {number} */
export let VOID_CREDIT_MS; // falling into the void counts as a kill for whoever hurt you this recently

// Grappling hook: elevated roofs/platforms and places cut off on foot (shared/reach.js).
// The pull clears a ledge before settling onto it (shared/grapple.js).
/** @type {number} */
export let HOOK_RANGE;
/** @type {number} */
export let HOOK_PULL; // m/s² towards the catch or its landing
/** @type {number} */
export let HOOK_SPEED; // fastest the rope drags you
/** @type {number} */
export let HOOK_ARRIVE; // this close to the hook, it lets go and pops you up over the edge
/** @type {number} */
export let HOOK_HOP; // m/s upwards when it lets go there
/** @type {number} */
export let HOOK_COOLDOWN_MS;

// Game modes. Deathmatch ('dm'): everyone for themselves, the first to DM_KILLS kills wins the
// round. Capture the flag ('ctf'): Red against Blue, the first team to CTF_CAPTURES captures wins.
/** @type {import('./runtime-types.ts').Mode[]} */
export let MODES;
/** @type {number} */
export let DM_KILLS;
/** @type {number} */
export let CTF_CAPTURES;
/** @type {number} */
export let ROUND_BREAK_MS; // the scores stay up this long before the next round starts
/** @type {boolean} */
export let SUDDEN_DEATH; // a tie when time runs out: the next kill wins (or, without it, a draw)
/** @type {number} */
export let FLAG_REACH; // how close you have to get to a flag to take it (or send yours home)
/** @type {number} */
export let FLAG_RETURN_MS; // a dropped flag goes home by itself after this long
/** @type {boolean} */
export let WEAPONS_STAY; // in capture the flag, weapons stay on their pads
/** @type {number} */
export let DEFEND_RANGE; // a kill this close to your flag is a Defender

// Medals and sprees.
/** @type {number} */
export let MULTI_KILL_MS; // kills this close together add up to a multi kill
/** @type {number} */
export let ASSIST_MS; // hurting someone this soon before another player kills them is an assist
/** @type {number} */
export let SPREE; // kills without dying that make a killing spree

// The kick (V): a kill with it is a Show-off.
/** @type {number} */
export let KICK_DAMAGE;
/** @type {number} */
export let KICK_REACH;
/** @type {number} */
export let KICK_PUSH; // m/s, away from you
/** @type {number} */
export let KICK_COOLDOWN_MS;

onData(({ movement: m, rules: r, characters: c, weapons: w }) => {
  MOVE_SPEED = m.run;
  JUMP_SPEED = m.jump;
  GRAVITY = m.gravity;
  GROUND_ACCEL = m.groundAccel;
  AIR_ACCEL = m.airAccel;
  FRICTION = m.friction;
  STOP_SPEED = m.stopSpeed;
  SPEED_CAP = m.speedCap;
  DODGE_SPEED = m.dodge.speed;
  DODGE_HOP = m.dodge.hop;
  DODGE_COOLDOWN_MS = m.dodge.cooldownMs;
  PAD_COOLDOWN_MS = m.padCooldownMs;
  HOOK_RANGE = m.hook?.range ?? 0;
  HOOK_PULL = m.hook?.pull ?? 0;
  HOOK_SPEED = m.hook?.speed ?? 0;
  HOOK_ARRIVE = m.hook?.arrive ?? 0;
  HOOK_HOP = m.hook?.hop ?? 0;
  HOOK_COOLDOWN_MS = m.hook?.cooldownMs ?? 0;
  MAX_HEALTH = c.health.max;
  START_HEALTH = c.health.start;
  DECAY_ABOVE = c.decay.above;
  DECAY_PER_SECOND = c.decay.perSecond;
  RESPAWN_MS = r.respawn.delayMs;
  SPAWN_PROTECTION_MS = r.respawn.protectionMs;
  SPREAD_STILL = w.spread.still;
  SPREAD_MOVING = w.spread.moving;
  SPREAD_AIR = w.spread.air;
  NADE_SELF_DAMAGE = r.damage.selfBlast;
  FRIENDLY_FIRE = r.damage.friendlyFire;
  VOID_CREDIT_MS = r.damage.voidCreditMs;
  MODES = r.modes;
  DM_KILLS = r.deathmatch.kills;
  CTF_CAPTURES = r.ctf?.captures ?? 0;
  ROUND_BREAK_MS = r.round.breakMs;
  SUDDEN_DEATH = r.round.suddenDeath;
  FLAG_REACH = r.ctf?.flagReach ?? 0;
  FLAG_RETURN_MS = r.ctf?.flagReturnMs ?? 0;
  WEAPONS_STAY = r.ctf?.weaponsStay ?? false;
  DEFEND_RANGE = r.ctf?.defendRange ?? 0;
  MULTI_KILL_MS = r.medals.multiKillMs;
  ASSIST_MS = r.medals.assistMs;
  SPREE = r.medals.spree;
  KICK_DAMAGE = w.kick?.damage ?? 0;
  KICK_REACH = w.kick?.reach ?? 0;
  KICK_PUSH = w.kick?.push ?? 0;
  KICK_COOLDOWN_MS = w.kick?.cooldownMs ?? 0;
});
