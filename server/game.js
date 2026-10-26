import { indexed } from '../shared/indexed.js';
import { mapVector } from '../shared/vector.js';
import { finite, isRecord, isSnapshot } from '../shared/snapshot-parts.js';
/** @typedef {import('../shared/runtime-types.ts').Player} Player  @typedef {import('../shared/runtime-types.ts').GameSocket} GameSocket  @typedef {import('../shared/runtime-types.ts').IncomingMessage} IncomingMessage  @typedef {import('../shared/runtime-types.ts').Team} Team  @typedef {import('../shared/contracts.ts').Vector3} Vector3 */
import { GameMetrics, metricDimensions } from '../src/game-metrics.ts';
// One game on the server (lobbies.js has them all): who is playing, where they are, health and armor,
// kills, respawns, the map and the arena they're blowing apart, and the round: deathmatch, or capture
// the flag. Its map and mode are set when it's created. Each browser moves its own player; the server keeps score, checks every hit and decides where the holes go. Weapons
// are in arsenal.js, pickups in items.js, powerups in powerups.js, crates in crates.js, the round's
// clock in director.js, what falls when the arena breaks in physics.js, the roof and its pillars in
// roof.js, the planets round the arena in planets.js, and the water (the canal's) in pool.js. It plays
// by the data in force when it started (shared/data.js), and a new revision of the data offered to it
// (offer) from its next round on: every browser in it is handed the data it plays by.

import {
  ASSIST_MS,
  CTF_CAPTURES,
  DECAY_ABOVE,
  DECAY_PER_SECOND,
  DEFEND_RANGE,
  DM_KILLS,
  FLAG_REACH,
  FLAG_RETURN_MS,
  FRIENDLY_FIRE,
  HOOK_RANGE,
  KICK_COOLDOWN_MS,
  KICK_DAMAGE,
  KICK_PUSH,
  KICK_REACH,
  MODES,
  MULTI_KILL_MS,
  PLAYER_HEIGHT,
  RESPAWN_MS,
  ROUND_BREAK_MS,
  SNAPSHOT_RATE,
  SPAWN_PROTECTION_MS,
  SPREE,
  START_HEALTH,
  VOID_CREDIT_MS,
} from '../shared/constants.js';
import { DATA, HASH, REVISION, useData } from '../shared/data.js';
import {
  CELL,
  DEFAULT_MAP,
  FLAG_BASES,
  MAPS,
  SPAWNS,
  TEAMS,
  VOID_Y,
  teamSpawns,
  useMap,
} from '../shared/map.js';
import { boxHitsWorld, eyePosition, playerBox, rayWorld } from '../shared/physics.js';
import { canHook } from '../shared/reach.js';
import { Voxels, cellCentre } from '../shared/voxels.js';
import { ARMOR_SHARE, SPAWN_WEAPONS, WEAPONS } from '../shared/weapons.js';
import { Arsenal } from './arsenal.js';
import { Crates } from './crates.js';
import { Director } from './director.js';
import { Items } from './items.js';
import { Physics } from './physics.js';
import { Planets } from './planets.js';
import { Pool } from './pool.js';
import { Roof } from './roof.js';
import { Powerups } from './powerups.js';
import { clamp, clampToSpace, firstFree, round, send, sendText, toVector } from './util.js';

// What a browser can say is in someone's hands: a weapon, a special, or their juggling balls.
/** @param {unknown} held @returns {held is string} */
const holdable = (held) =>
  (typeof held === 'string' && Object.hasOwn(WEAPONS, held)) || held === 'special' || held === 'trick';
const SHOWING_OFF = new Set(['kick', 'ball']); // kills that are a Show-off
const NAME_KEPT_MS = 120_000; // how long a name stays free for whoever had it, after they leave
const MOST_HISTORY = 50_000; // entries of an arena's history a game takes over from another

export class Game {
  // restore: what a game was (its map, mode and players: saveState), or what it's to be ({ map, mode }).
  // data: { data, hash, revision } to play by (from readData), if not the data in force.
  /** @param {import('../shared/runtime-types.ts').GameOptions} options */
  constructor({ respawnMs, protectionMs, now = Date.now, restore = null, data = null, reportMetric } = {}) {
    this.metrics = new GameMetrics((name, value) => {
      const labels = metricDimensions(this.mode, this.map);
      if (labels) reportMetric?.(name, value, labels);
    });
    this.data = data?.data ?? DATA;
    this.dataHash = data?.hash ?? HASH;
    this.revision = data?.revision ?? REVISION;
    /** @type {import('../shared/runtime-types.ts').DataRevision | null} */
    this.pending = null; // a newer revision of the data, for the next round
    useData(this.data, { hash: this.dataHash, revision: this.revision });
    this.respawnMs = respawnMs; // the data's, unless given
    this.protectionMs = protectionMs; // how long you can't be hurt after spawning (unless you fire)
    this.now = now;
    // Scores of players who left, or who played on the server before an update, by browser tab.
    /** @type {Map<string | null, import('../shared/runtime-types.ts').ScoreRecord & {leftAt: number}>} */
    this.remembered = new Map();
    for (const record of Array.isArray(restore?.players) ? restore.players : []) {
      if (validScore(record)) this.remembered.set(record.token, { ...record, leftAt: now() });
    }
    /** @type {import('../shared/runtime-types.ts').Mode} */
    this.mode = restore?.mode === 'dm' || restore?.mode === 'ctf' ? restore.mode : 'dm';
    this.map = startingMap(restore);
    useMap(this.map);
    this.round = { number: 1, over: false, nextAt: 0 };
    this.firstBlood = false; // whether anyone has killed anyone yet this round
    this.captures = { red: 0, blue: 0 };
    this.flags = homeFlags();
    /** @type {Set<GameSocket>} */
    this.sockets = new Set(); // every connection in this game
    /** @type {Map<number, Player>} */
    this.players = new Map(); // id → player
    /** @type {Map<GameSocket, Player>} */
    this.bySocket = new Map(); // socket → player
    this.world = new Voxels(this.mode, this.map);
    this.pool = new Pool(this);
    this.roof = new Roof(this);
    this.planets = new Planets(this);
    this.physics = new Physics(this);
    this.arsenal = new Arsenal(this);
    this.items = new Items(this);
    this.powerups = new Powerups(this);
    this.crates = new Crates(this);
    this.director = new Director(this);
    /** @type {Set<ReturnType<typeof setTimeout>>} */
    this.timers = new Set();
    this.nextId = 1;
    /** @type {number | null} */
    this.snapshotAt = null; // when snapshot() was last called…
    this.snapshotClock = 1000 / SNAPSHOT_RATE; // …and the time since, toward the next snapshot
    this.resume(restore);
  }

  // A game that goes on from another (a new host on zirbel takes over from what its page saw): the
  // arena as it was, with every hole since it went up, the water and the planets.
  /** @param {import('../shared/runtime-types.ts').RestoreInput | null} restore */
  resume(restore) {
    const history = Array.isArray(restore?.history) ? restore.history.slice(0, MOST_HISTORY) : [];
    for (const entry of history) if (sane(entry)) this.world.apply(entry);
    if (finite(restore?.water)) this.world.water = restore.water;
    for (const n of Array.isArray(restore?.planets) ? restore.planets : [])
      if (typeof n === 'number' && Number.isInteger(n)) this.planets.gone.add(n);
    if (history.length) this.roof.survey();
  }

  // The server runs several games at once, on different maps, and shared/map.js describes one map at
  // a time: everything that comes in from outside the game (a connection, a message, a tick) first
  // makes this game's map the current one.
  enter() {
    useData(this.data, { hash: this.dataHash, revision: this.revision });
    useMap(this.map);
  }

  // A newer revision of the data ({ data, hash, revision }, checked): the game plays by it from its
  // next round on.
  /** @param {import('../shared/runtime-types.ts').DataRevision} data */
  offer(data) {
    this.pending = data.hash === this.dataHash ? null : data;
  }

  // A browser comes into this game: it's told about the arena, and then joins it (join).
  /** @param {GameSocket} socket */
  add(socket) {
    this.enter();
    this.sockets.add(socket);
    this.share(socket);
    send(socket, this.worldMessage());
  }

  // Everything about the arena a browser needs to draw it as it is now: which map, every hole since,
  // and which data the game plays by (a browser with other data is handed it first: dataMessage).
  worldMessage() {
    return {
      type: 'world',
      mode: this.mode,
      map: this.map,
      history: this.world.history,
      water: round(this.world.water),
      planets: [...this.planets.gone],
      data: this.dataHash,
      revision: this.revision,
    };
  }

  dataMessage() {
    return { type: 'data', hash: this.dataHash, revision: this.revision, blocks: this.data };
  }

  // The data the game plays by, to a browser that hasn't it: before it hears about the arena.
  /** @param {GameSocket} socket */
  share(socket) {
    if (socket.dataHash === this.dataHash) return;
    send(socket, this.dataMessage());
    socket.dataHash = this.dataHash;
  }

  // The arena as it is now, to everyone.
  broadcastWorld() {
    for (const socket of this.sockets) this.share(socket);
    this.broadcast(this.worldMessage());
  }

  // A message from a browser, as it came (a string): see handle.
  /** @param {GameSocket} socket @param {{toString(): string}} data */
  receive(socket, data) {
    /** @type {unknown} */
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (isRecord(message)) this.handle(socket, message);
  }

  // What a player in this game does.
  /** @param {GameSocket} socket @param {IncomingMessage} message */
  handle(socket, message) {
    this.enter();
    const player = this.bySocket.get(socket);
    const type = message.type;
    if (!player) return;
    else if (type === 'state') this.move(player, message);
    else if (type === 'fire') this.arsenal.fire(player, message);
    else if (type === 'kick') this.kick(player, message);
    else if (type === 'special') this.crates.use(player, message);
    else if (type === 'steer') this.crates.steer(player, message);
    else if (type === 'hook') this.hook(player, message);
  }

  // You're named Player One, Player Two … in the order you came in (or the name you're given: on
  // zirbel, your seat's), and in capture the flag you go onto the smaller team. token identifies the
  // browser tab (on zirbel, the seat), so a reload or an update brings back your name, score and colour.
  /** @param {GameSocket} socket @param {unknown} token @param {string | null} name @param {number | null} seat */
  join(socket, token, name = null, seat = null) {
    this.enter();
    // On zirbel a player's id is their seat's number, the same in the room as in the game; else the next.
    const id =
      seat !== null && Number.isInteger(seat) && seat > 0 && !this.players.has(seat) ? seat : this.nextId++;
    this.nextId = Math.max(this.nextId, id + 1);
    let safeToken = cleanToken(token);
    if (safeToken && [...this.players.values()].some((other) => other.token === safeToken)) safeToken = null; // a duplicated tab
    const known = safeToken ? this.remembered.get(safeToken) : undefined;
    this.remembered.delete(safeToken);
    /** @type {Player} */
    const player = {
      id,
      socket,
      token: safeToken,
      name: this.pickName(name ?? known?.name),
      color: this.pickColor(known?.color),
      feet: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      hp: START_HEALTH,
      armor: 0,
      alive: false,
      kills: known?.kills ?? 0,
      deaths: known?.deaths ?? 0,
      weapons: new Set(SPAWN_WEAPONS), // what you carry, and ammo for the ones that run out
      ammo: {},
      lastFire: {}, // weapon → when it last fired
      team: this.mode === 'ctf' ? this.smallerTeam() : null,
      carrying: null, // the team whose flag they have, in capture the flag
      spree: 0, // kills since they last died
      multi: 0, // kills in quick succession
      lastKillAt: 0,
      lastKick: 0,
      powerup: null, // { kind, until }: a powerup from the pedestal
      special: null, // what a crate gave you, for one use
      guiding: null, // the id of the pilot missile you're steering
      hook: null, // where their grappling hook is caught, if it is
      held: indexed(SPAWN_WEAPONS, 0), // what's in their hands: a weapon, a special, or their juggling balls ('trick')
      lastHitBy: null, // who hurt them last, and when: falling into the void counts as their kill
      lastHitAt: 0,
      damagedBy: new Map(), // who hurt them, and when: for assists
      protectedUntil: 0,
      decayAt: 0, // health and armor above 100 tick down a point a second
    };
    this.metrics.begin(this.now());
    this.players.set(id, player);
    this.bySocket.set(socket, player);
    send(socket, { type: 'welcome', id, name: player.name, color: player.color });
    this.spawn(player);
  }

  // Your old name if it's free, or else the first nobody here (or just gone) has.
  /** @param {string | null | undefined} preferred */
  pickName(preferred) {
    const taken = new Set([...this.players.values()].map((player) => player.name));
    if (preferred && !taken.has(preferred)) return preferred;
    const now = this.now();
    for (const record of this.remembered.values())
      if (now - record.leftAt < NAME_KEPT_MS) taken.add(record.name);
    return firstFree('Player', taken);
  }

  // Your old colour if it's free, or else one that nobody here (or expected back) is using.
  /** @param {string | null | undefined} preferred */
  pickColor(preferred) {
    const taken = new Set([...this.players.values()].map((player) => player.color));
    if (preferred && !taken.has(preferred)) return preferred;
    const reserved = new Set([...this.remembered.values()].map((record) => record.color));
    const colors = this.data.characters.colors;
    return (
      colors.find((color) => !taken.has(color) && !reserved.has(color)) ??
      colors.find((color) => !taken.has(color)) ??
      indexed(colors, this.players.size % colors.length)
    );
  }

  /** @param {Player} player */
  spawn(player) {
    let feet = this.pickSpawn(player);
    if (!feet) {
      this.rebuild(player);
      feet = this.pickSpawn(player);
    }
    if (!feet) throw new Error('Rebuilt arena has no usable spawn');
    const yaw = Math.atan2(feet[0], feet[2]); // facing the middle
    Object.assign(player, {
      feet,
      yaw,
      pitch: 0,
      hp: START_HEALTH,
      armor: 0,
      alive: true,
      hook: null,
      held: indexed(SPAWN_WEAPONS, 0),
    });
    player.weapons = new Set(SPAWN_WEAPONS);
    player.ammo = {};
    player.protectedUntil = this.now() + (this.protectionMs ?? SPAWN_PROTECTION_MS);
    player.damagedBy.clear();
    this.broadcast({ type: 'spawn', id: player.id, feet: player.feet, yaw: player.yaw });
  }

  // Players spawn at a usable spawn point (on their own half, in capture the flag, while there's one
  // left there): the one farthest from everyone alive, with some randomness so it varies. Null when
  // there's no floor left under any of them.
  /** @param {Player} player */
  pickSpawn(player) {
    /** @param {Vector3[]} points */
    const usable = (points) => points.filter((feet) => this.usable(feet));
    const own = player.team ? usable(teamSpawns(player.team)) : [];
    const choices = own.length ? own : usable(SPAWNS);
    if (choices.length === 0) return null;
    const others = [...this.players.values()].filter((other) => other !== player && other.alive);
    let best = null;
    let bestScore = -Infinity;
    for (const feet of choices) {
      const nearest = others.length
        ? Math.min(...others.map((other) => Math.hypot(...other.feet.map((v, i) => v - indexed(feet, i)))))
        : 0;
      const score = nearest + Math.random() * 6;
      if (score > bestScore) {
        best = feet;
        bestScore = score;
      }
    }
    return best;
  }

  // Floor under the whole of you, and nothing in the way.
  /** @param {Vector3} feet */
  usable(feet) {
    const { min, max } = playerBox(feet);
    if (boxHitsWorld(this.world, min, max)) return false;
    const below = feet[1] - CELL / 2;
    return /** @type {[number, number][]} */ ([
      [0, 0],
      [-0.3, -0.3],
      [0.3, -0.3],
      [-0.3, 0.3],
      [0.3, 0.3],
    ]).every(([dx, dz]) => this.world.solidAt(feet[0] + dx, below, feet[2] + dz));
  }

  // Nowhere left to stand: put the arena back up and start everyone again.
  /** @param {Player | null} except */
  rebuild(except = null) {
    this.world.reset();
    this.physics.clear();
    this.pool.reset();
    this.roof.reset();
    this.planets.reset();
    this.arsenal.clear();
    this.broadcastWorld();
    for (const player of this.players.values()) if (player !== except && player.alive) this.spawn(player);
  }

  // Where the player's browser says they are, kept within reach of the arena.
  /** @param {Player} player @param {unknown} feet */
  relocate(player, feet) {
    const at = toVector(feet);
    if (at) player.feet = clampToSpace(at);
  }

  /** @param {Player} player @param {IncomingMessage} message */
  move(player, message) {
    if (!player.alive) return;
    this.relocate(player, message.feet);
    if (finite(message.yaw)) player.yaw = message.yaw % (Math.PI * 2);
    if (finite(message.pitch)) player.pitch = clamp(message.pitch, -Math.PI / 2, Math.PI / 2);
    if (holdable(message.held)) player.held = message.held;
    if (player.feet[1] < VOID_Y) this.fall(player);
  }

  // Fell into the void. Whoever hurt you just before gets the kill.
  /** @param {Player} player */
  fall(player) {
    const recent = player.lastHitBy !== null && this.now() - player.lastHitAt < VOID_CREDIT_MS;
    this.damage(recent ? (this.players.get(player.lastHitBy ?? -1) ?? null) : null, player, player.hp, {
      weapon: 'void',
    });
  }

  // Where a player's grappling hook has caught, so everyone sees the rope; null once they let go.
  // It catches overhead or where you couldn't walk to (shared/reach.js), unless you carry a flag.
  /** @param {Player} player @param {IncomingMessage} message */
  hook(player, message) {
    if (!player.alive || player.carrying) return;
    if (message.at === null) {
      player.hook = null;
      return;
    }
    const at = toVector(message.at);
    if (!at) return;
    const eye = eyePosition(player.feet);
    const offset = mapVector(at, (v, i) => v - eye[i]);
    const distance = Math.hypot(...offset);
    if (distance > HOOK_RANGE + 2 || distance < 0.1) return;
    const hit = this.world.raycast(
      eye,
      mapVector(offset, (v) => v / distance),
      distance + 0.5,
    );
    if (!hit || Math.abs(hit.distance - distance) > 0.75 || !canHook(this.world, player.feet, at, hit.normal))
      return;
    player.hook = mapVector(at, round);
  }

  // Tears a hole in the arena, and lets whatever no longer holds fall (physics.js). The caller
  // tells everyone about the blast; owner is whose it was, for anyone crushed by what falls. With
  // harmless, what falls lands on nobody (a planet's pieces chipping the arena: server/planets.js).
  /** @param {Vector3} at @param {number} radius @param {number | null} owner @param {{harmless?: boolean}} options */
  carve(at, radius, owner = null, { harmless = false } = {}) {
    /** @type {number[]} */
    const materials = [];
    const removed = this.world.carve(at, radius, materials);
    this.physics.broke(removed, materials, { at, owner, harmless });
    return removed;
  }

  // A bullet chips the block it hit. Everyone sees the wear; when the block breaks, everyone removes it.
  /** @param {Vector3} cell @param {number | null} owner */
  chip(cell, owner = null) {
    const material = this.world.get(...cell);
    const wear = this.world.chip(...cell);
    if (wear !== 0) this.broadcast({ type: 'chip', cell, wear: Math.max(0, wear), broke: wear === -1 });
    if (wear === -1) this.physics.broke(cell, [material], { at: cellCentre(...cell), owner });
  }

  // A charged railgun shot breaks a cell outright, if bullets can break it.
  /** @param {Vector3} cell @param {number | null} owner */
  smash(cell, owner = null) {
    const material = this.world.get(...cell);
    if (!this.world.smash(...cell)) return;
    this.broadcast({ type: 'chip', cell, wear: 0, broke: true });
    this.physics.broke(cell, [material], { at: cellCentre(...cell), owner });
  }

  // The kick (V): whoever you claim to have kicked, if they're really right in front of you, takes
  // a hit and goes flying.
  /** @param {Player} player @param {IncomingMessage} message */
  kick(player, message) {
    const now = this.now();
    if (!player.alive || this.round.over || now - player.lastKick < KICK_COOLDOWN_MS * 0.8) return;
    player.lastKick = now;
    player.protectedUntil = 0;
    this.broadcast({ type: 'kick', id: player.id }, player.socket);
    const target = typeof message.hit === 'number' ? this.players.get(message.hit) : undefined;
    if (!target || target === player || !target.alive || (player.team && player.team === target.team)) return;
    const offset = mapVector(target.feet, (v, i) => v - player.feet[i]);
    const flat = Math.hypot(offset[0], offset[2]);
    if (flat > KICK_REACH + 0.9 || Math.abs(offset[1]) > 1.5) return;
    /** @type {[number, number]} */
    const away =
      flat > 0.01 ? [offset[0] / flat, offset[2] / flat] : [-Math.sin(player.yaw), -Math.cos(player.yaw)];
    this.push(target, [away[0] * KICK_PUSH, 5, away[1] * KICK_PUSH]);
    this.damage(player, target, KICK_DAMAGE, { weapon: 'kick' });
  }

  // How much faster someone fires (and runs): a Rush powerup.
  /** @param {Player} player */
  rushOf(player) {
    return this.powerups.rushOf(player);
  }

  // Shoves a player: their browser moves them, so it's told to add this velocity.
  /** @param {Player} target @param {Vector3} velocity */
  push(target, velocity) {
    send(target.socket, { type: 'push', velocity: velocity.map(round) });
  }

  // Whether a wall stands between a point and a player's middle.
  /** @param {Vector3} from @param {Player} player */
  shielded(from, player) {
    /** @type {Vector3} */
    const centre = [player.feet[0], player.feet[1] + PLAYER_HEIGHT / 2, player.feet[2]];
    const offset = mapVector(centre, (v, i) => v - from[i]);
    const length = Math.hypot(...offset);
    if (length < 0.01) return false;
    return (
      rayWorld(
        this.world,
        from,
        mapVector(offset, (v) => v / length),
        length,
      ) <
      length - 0.05
    );
  }

  // ---------- Health and score ----------

  // Armor takes two thirds of the damage (not falling into the void). Splash is a blast or fire.
  /** @param {Player | null} attacker @param {Player} target @param {number} amount @param {{head?: boolean, weapon?: string, splash?: boolean}} options */
  damage(attacker, target, amount, { head = false, weapon = 'rifle', splash = false } = {}) {
    if (this.round.over || !target.alive) return;
    if (attacker && attacker !== target && attacker.team && attacker.team === target.team && !FRIENDLY_FIRE)
      return; // no friendly fire
    const now = this.now();
    if (weapon !== 'void' && now < target.protectedUntil) return; // just spawned
    amount = Math.round(this.powerups.modify(attacker, target, amount, { weapon, splash }));
    if (amount <= 0) return;
    const absorbed = weapon === 'void' ? 0 : Math.min(target.armor, Math.round(amount * ARMOR_SHARE));
    target.armor -= absorbed;
    target.hp = Math.max(0, target.hp - (amount - absorbed));
    if (attacker && attacker !== target) {
      target.lastHitBy = attacker.id;
      target.lastHitAt = now;
      target.damagedBy.set(attacker.id, now);
    }
    this.broadcast({
      type: 'hit',
      from: attacker?.id ?? null,
      to: target.id,
      hp: target.hp,
      armor: target.armor,
      head,
      weapon,
    });
    if (target.hp > 0) return;

    const carried = target.carrying;
    target.alive = false;
    target.hook = null;
    target.deaths++;
    this.dropFlag(target, weapon === 'void');
    this.powerups.drop(target);
    // What the announcer needs: a spree this kill ended, and the killer's spree and multi kill.
    /** @type {{type: string, killer: number | null, victim: number, head: boolean, weapon: string, ended?: number, first?: boolean, spree?: number, multi?: number}} */
    const kill = { type: 'kill', killer: attacker?.id ?? null, victim: target.id, head, weapon };
    if (target.spree >= SPREE && attacker !== target) kill.ended = target.spree;
    target.spree = 0;
    target.multi = 0;
    if (attacker && attacker !== target) {
      attacker.kills++;
      attacker.spree++;
      attacker.multi = now - attacker.lastKillAt <= MULTI_KILL_MS ? attacker.multi + 1 : 1;
      attacker.lastKillAt = now;
      Object.assign(kill, { spree: attacker.spree, multi: attacker.multi });
      if (!this.firstBlood) kill.first = true;
      this.firstBlood = true;
    }
    this.broadcast(kill);
    // The victim's death cam looks at whoever killed them, and says what they had left.
    if (attacker && attacker !== target)
      send(target.socket, { type: 'killcam', killer: attacker.id, hp: attacker.hp, armor: attacker.armor });
    this.medals(attacker, target, weapon, carried, now);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.enter();
      if (this.players.has(target.id) && !this.round.over) this.spawn(target);
    }, this.respawnMs ?? RESPAWN_MS);
    this.timers.add(timer);
    const scorer =
      this.mode === 'dm' && attacker && attacker !== target ? { id: attacker.id, name: attacker.name } : null;
    if (scorer && attacker && attacker.kills >= DM_KILLS) this.endRound(scorer);
    this.director.killed(scorer); // in sudden death, the next kill wins
  }

  // Medals for a kill: Show-off (a kick, or a juggling ball thrown), Void (knocked out of the
  // arena), Demolition (brought the arena down on them), Defender (in capture the flag: killing
  // their carrier, or anyone near your flag), and Assist for whoever else hurt the victim just before.
  /** @param {Player | null} attacker @param {Player} target @param {string} weapon @param {Team | null} carried @param {number} now */
  medals(attacker, target, weapon, carried, now) {
    if (attacker && attacker !== target) {
      if (SHOWING_OFF.has(weapon)) this.medal(attacker, 'showoff');
      if (weapon === 'void') this.medal(attacker, 'void');
      if (weapon === 'crush') this.medal(attacker, 'demolition');
      const base = attacker.team && FLAG_BASES[attacker.team];
      if (carried || (base && Math.hypot(...target.feet.map((v, i) => v - indexed(base, i))) < DEFEND_RANGE))
        this.medal(attacker, 'defender');
    }
    for (const [id, at] of target.damagedBy) {
      if (id === attacker?.id || id === target.id || now - at > ASSIST_MS) continue;
      const helper = this.players.get(id);
      if (helper) this.medal(helper, 'assist');
    }
    target.damagedBy.clear();
  }

  /** @param {Player} player @param {string} medal */
  medal(player, medal) {
    this.broadcast({ type: 'medal', id: player.id, medal });
  }

  // ---------- Every tick ----------

  // Moves everything the server simulates: what's flying, pickups, powerups, crates, the
  // flags, and the round.
  /** @param {number} dt */
  tick(dt) {
    this.enter();
    const now = this.now();
    for (const player of this.players.values()) {
      // Health and armor above 100 tick down a point a second.
      if (player.alive && now >= player.decayAt) {
        player.decayAt = now + 1000;
        if (player.hp > DECAY_ABOVE) player.hp = Math.max(DECAY_ABOVE, player.hp - DECAY_PER_SECOND);
        if (player.armor > DECAY_ABOVE) player.armor = Math.max(DECAY_ABOVE, player.armor - DECAY_PER_SECOND);
      }
    }
    this.arsenal.tick(dt, now);
    this.physics.tick(now);
    this.planets.tick(now);
    this.pool.tick(dt);
    this.items.tick(now);
    this.powerups.tick(dt, now);
    this.crates.tick(dt, now);
    this.director.tick(dt, now);
    this.updateFlags(now);
    if (this.round.over && now >= this.round.nextAt) this.startRound();
  }

  // ---------- Rounds and modes ----------

  // Someone, or some team, has won: the scores stay up for a moment, then a new round starts.
  /** @param {import('../shared/runtime-types.ts').Winner} winner */
  endRound(winner) {
    if (this.round.over) return;
    Object.assign(this.round, { over: true, nextAt: this.now() + ROUND_BREAK_MS });
    this.metrics.complete(this.now(), {
      kills: [...this.players.values(), ...this.remembered.values()].map((p) => p.kills),
      captures: Object.values(this.captures),
    });
    this.broadcast({
      type: 'round',
      state: 'over',
      mode: this.mode,
      winner,
      captures: this.captures,
      ms: ROUND_BREAK_MS,
    });
  }

  // A new round: scores back to nothing, the arena as new, everyone respawned. A newer revision of
  // the data, if one was offered, comes in now: maybe another map and modes.
  startRound() {
    if (this.pending) {
      Object.assign(this, {
        data: this.pending.data,
        dataHash: this.pending.hash,
        revision: this.pending.revision,
        pending: null,
      });
      useData(this.data, { hash: this.dataHash, revision: this.revision });
      if (!MODES.includes(this.mode)) this.mode = indexed(MODES, 0);
      if (!Object.hasOwn(MAPS, this.map)) this.map = DEFAULT_MAP;
      this.enter();
    }
    this.metrics.reset();
    if (this.players.size) this.metrics.begin(this.now());
    this.round = { number: this.round.number + 1, over: false, nextAt: 0 };
    this.firstBlood = false;
    this.captures = { red: 0, blue: 0 };
    this.flags = homeFlags();
    this.world.reset(this.mode, this.map);
    this.physics.clear();
    this.pool.reset();
    this.roof.reset();
    this.planets.reset();
    this.arsenal.clear();
    this.items.reset();
    this.powerups.reset();
    this.crates.reset();
    this.director.reset();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const record of this.remembered.values()) Object.assign(record, { kills: 0, deaths: 0 });
    const players = [...this.players.values()];
    if (this.mode === 'ctf') this.balanceTeams();
    for (const player of players) {
      if (this.mode !== 'ctf') player.team = null;
      Object.assign(player, { kills: 0, deaths: 0, spree: 0, multi: 0, carrying: null });
    }
    this.broadcastWorld();
    this.broadcast({
      type: 'round',
      state: 'start',
      mode: this.mode,
      map: this.map,
      number: this.round.number,
      revision: this.revision,
    });
    for (const player of players) this.spawn(player);
  }

  // ---------- Capture the flag ----------

  smallerTeam() {
    const counts = { red: 0, blue: 0 };
    for (const player of this.players.values()) if (player.team) counts[player.team]++;
    if (counts.red === counts.blue) return indexed(TEAMS, Math.floor(Math.random() * 2));
    return counts.red < counts.blue ? 'red' : 'blue';
  }

  // Everyone onto a team, the teams at most one apart.
  balanceTeams() {
    const players = [...this.players.values()];
    for (const player of players)
      if (player.team !== null && !TEAMS.includes(player.team)) player.team = null;
    for (const player of players) if (!player.team) player.team = this.smallerTeam();
    for (;;) {
      const red = players.filter((player) => player.team === 'red');
      const blue = players.filter((player) => player.team === 'blue');
      if (Math.abs(red.length - blue.length) <= 1) return;
      /** @type {[Player[], Team]} */
      const [bigger, team] = red.length > blue.length ? [red, 'blue'] : [blue, 'red'];
      indexed(bigger, bigger.length - 1).team = team;
    }
  }

  // Someone left: if the teams are two or more apart now, the last to join the bigger one (and not
  // carrying a flag, if anyone isn't) swaps sides and starts again on their new team's half.
  evenTeams() {
    const players = [...this.players.values()];
    const red = players.filter((player) => player.team === 'red');
    const blue = players.filter((player) => player.team === 'blue');
    if (Math.abs(red.length - blue.length) < 2) return;
    /** @type {[Player[], Team]} */
    const [bigger, team] = red.length > blue.length ? [red, 'blue'] : [blue, 'red'];
    const mover = bigger.filter((player) => !player.carrying).at(-1) ?? indexed(bigger, bigger.length - 1);
    this.dropFlag(mover);
    mover.team = team;
    if (mover.alive) this.spawn(mover);
  }

  // Touching the other team's flag takes it; touching your own, dropped, sends it home; carrying
  // theirs to your own flag while yours is at home scores. Dropped flags go home after a while.
  /** @param {number} now */
  updateFlags(now) {
    if (this.mode !== 'ctf' || this.round.over) return;
    for (const team of TEAMS) {
      const flag = this.flags[team];
      if (flag.state === 'carried') {
        const carrier = flag.carrier === null ? undefined : this.players.get(flag.carrier);
        if (!carrier) throw new Error('Carried flag has no carrier');
        flag.at = [...carrier.feet];
        continue;
      }
      if (flag.state === 'dropped') {
        if (now >= flag.returnAt) {
          this.returnFlag(team, null);
          continue;
        }
        this.settleFlag(team); // the floor under it may have been blown away
        if (flag.state !== 'dropped') continue;
      }
      for (const player of this.players.values()) {
        if (!player.alive || !touches(player.feet, flag.at)) continue;
        if (player.team && player.team !== team && !player.carrying) {
          Object.assign(flag, { state: 'carried', carrier: player.id });
          player.carrying = team;
          player.hook = null;
          this.broadcast({ type: 'flag', team, event: 'taken', by: player.id });
          break;
        }
        if (player.team === team && flag.state === 'dropped') {
          this.returnFlag(team, player);
          break;
        }
      }
    }
    for (const player of this.players.values()) {
      if (!player.carrying || !player.team) continue;
      const own = this.flags[player.team];
      if (!own || !player.alive || own.state !== 'home' || !touches(player.feet, own.at, FLAG_REACH + 0.4))
        continue;
      const taken = player.carrying;
      player.carrying = null;
      this.flags[taken] = homeFlag(taken);
      this.captures[player.team]++;
      this.broadcast({
        type: 'flag',
        team: taken,
        event: 'captured',
        by: player.id,
        captures: this.captures,
      });
      if (this.captures[player.team] >= CTF_CAPTURES) this.endRound({ team: player.team });
      this.director.captured(player.team);
    }
  }

  // A carrier who dies drops the flag where they fell; one who falls out of the arena loses it home.
  /** @param {Player} player @param {boolean} lost */
  dropFlag(player, lost = false) {
    const team = player.carrying;
    if (!team) return;
    player.carrying = null;
    Object.assign(this.flags[team], {
      state: 'dropped',
      carrier: null,
      at: [...player.feet],
      returnAt: this.now() + FLAG_RETURN_MS,
    });
    if (lost) this.returnFlag(team, null);
    else {
      this.settleFlag(team);
      if (this.flags[team].state === 'dropped')
        this.broadcast({ type: 'flag', team, event: 'dropped', by: player.id });
    }
  }

  // A dropped flag lies on the floor under where it was dropped; with no floor under it, it goes home.
  /** @param {Team} team */
  settleFlag(team) {
    const flag = this.flags[team];
    const ground = this.world.raycast([flag.at[0], flag.at[1] + 0.5, flag.at[2]], [0, -1, 0], 40);
    if (!ground) this.returnFlag(team, null);
    else flag.at = [flag.at[0], round(flag.at[1] + 0.5 - ground.distance), flag.at[2]];
  }

  /** @param {Team} team @param {Player | null} by */
  returnFlag(team, by) {
    this.flags[team] = homeFlag(team);
    this.broadcast({ type: 'flag', team, event: 'returned', by: by?.id ?? null });
  }

  // ---------- What everyone sees ----------

  // Everyone gets everyone's position and the state of the match 20 times a second (the game moves
  // on 30 times a second: call this every tick); each player also gets what only they need: their
  // ammo and special. A socket with its own way of sending these (a zirbel seat, shared/wire.js)
  // sends only what changed, as bytes.
  snapshot() {
    if (this.sockets.size === 0) return;
    const now = this.now();
    // One each twentieth of a second of the game's clock, on the tick it falls in: two ticks in three.
    this.snapshotClock = Math.min(this.snapshotClock + now - (this.snapshotAt ?? now), 2000 / SNAPSHOT_RATE);
    this.snapshotAt = now;
    if (this.snapshotClock < 1000 / SNAPSHOT_RATE - 1) return;
    this.snapshotClock -= 1000 / SNAPSHOT_RATE;
    this.enter();
    /** @type {import('../shared/runtime-types.ts').PlayerSnapshot[]} */
    const players = [...this.players.values()].map((player) => ({
      id: player.id,
      seat: player.socket.seat, // on zirbel: the seat they play from
      name: player.name,
      color: player.color,
      feet: mapVector(player.feet, round),
      yaw: round(player.yaw),
      pitch: round(player.pitch),
      hp: player.hp,
      armor: player.armor,
      alive: player.alive,
      kills: player.kills,
      deaths: player.deaths,
      hook: player.hook,
      held: player.held,
      team: player.team,
      carrying: player.carrying,
      shielded: now < player.protectedUntil,
      cloaked: this.powerups.of(player) === 'shimmer',
      powerup: this.powerups.of(player),
    }));
    /** @type {import('../shared/runtime-types.ts').RoundSnapshot} */
    const match = {
      mode: this.mode,
      map: this.map,
      over: this.round.over,
      captures: this.captures,
      ...this.director.snapshot(),
    };
    if (this.mode === 'ctf')
      match.flags = Object.fromEntries(
        TEAMS.map((team) => [team, { state: this.flags[team].state, at: this.flags[team].at.map(round) }]),
      );
    this.broadcast({
      type: 'snapshot',
      players,
      projectiles: this.arsenal.snapshot(),
      items: this.items.snapshot(),
      round: match,
      water: round(this.world.water),
      ...this.powerups.snapshot(),
      ...this.crates.snapshot(),
    });
    for (const player of this.players.values()) {
      /** @type {import('../shared/runtime-types.ts').SelfMessage} */
      const self = {
        type: 'self',
        weapons: [...player.weapons],
        ammo: player.ammo,
        special: player.special,
        powerup:
          player.powerup && this.powerups.of(player)
            ? { kind: player.powerup.kind, ms: player.powerup.until - now }
            : null,
      };
      if (player.socket.self) player.socket.self(self);
      else send(player.socket, self);
    }
  }

  /** @param {GameSocket} socket */
  disconnect(socket) {
    this.enter();
    this.sockets.delete(socket);
    const player = this.bySocket.get(socket);
    if (!player) return;
    this.dropFlag(player);
    this.powerups.drop(player);
    this.bySocket.delete(socket);
    this.players.delete(player.id);
    if (player.token) this.remembered.set(player.token, { ...record(player), leftAt: this.now() });
    if (this.mode === 'ctf') this.evenTeams();
  }

  // Someone who won't be back: their score goes, so whoever comes in under their token starts afresh.
  /** @param {string | null} token */
  forget(token) {
    this.remembered.delete(token);
  }

  // Everyone's score, by browser tab, for the next server to pick up.
  saveState() {
    /** @type {Map<string | null, import('../shared/runtime-types.ts').ScoreRecord>} */
    const records = new Map(this.remembered);
    for (const player of this.players.values()) if (player.token) records.set(player.token, record(player));
    return { players: [...records.values()], mode: this.mode, map: this.map };
  }

  /** @template {{type: string, event?: string}} T @param {T} message @param {GameSocket} [except] */
  broadcast(message, except) {
    if (message.type === 'kill') this.metrics.elimination();
    if (message.type === 'flag' && message.event === 'captured') this.metrics.capture();
    let data = null;
    const text = () => (data ??= JSON.stringify(message));
    const snapshot = message.type === 'snapshot' && isSnapshot(message) ? message : null;
    for (const socket of this.sockets) {
      if (socket === except || socket.readyState !== socket.OPEN) continue;
      // A snapshot goes as it is to a socket with its own way of sending them (a zirbel seat).
      if (snapshot && socket.snapshot) socket.snapshot(snapshot, text);
      else sendText(socket, text());
    }
  }

  stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.arsenal.clear();
  }
}

/** @param {unknown} token */
function cleanToken(token) {
  return typeof token === 'string' && /^[0-9a-f]{8,64}$/.test(token) ? token : null;
}

// Whether an entry of an arena's history is one Voxels can replay: a hole, or cells built, taken
// away or put down, as numbers (see shared/voxels.js).
/** @param {unknown} entry  @returns {entry is import('../shared/voxels.js').HistoryEntry} */
function sane(entry) {
  if (!Array.isArray(entry) || entry.length > 40000) return false;
  /** @param {number} from */
  const numbers = (from) => entry.slice(from).every(Number.isFinite);
  if (entry[0] === 'b') return entry.length === 8 && numbers(1);
  if (entry[0] === 'x' || entry[0] === 'd') return numbers(1);
  return entry.length === 4 && numbers(0) && entry[3] >= 0 && entry[3] <= 12;
}

/** @param {Pick<Player, 'token' | 'name' | 'color' | 'kills' | 'deaths'>} player */
function record({ token, name, color, kills, deaths }) {
  return { token, name, color, kills, deaths };
}

// The map a game is played on: the one it was saved with, or else the default.
/** @param {import('../shared/runtime-types.ts').RestoreInput | null} restore */
function startingMap(restore) {
  const map = restore?.map;
  return typeof map === 'string' && Object.hasOwn(MAPS, map) ? map : DEFAULT_MAP;
}

/** @param {Team} team @returns {import('../shared/runtime-types.ts').Flag} */
function homeFlag(team) {
  return { state: 'home', at: [...flagBase(team)], carrier: null, returnAt: 0 };
}

function homeFlags() {
  return { red: homeFlag('red'), blue: homeFlag('blue') };
}

// Whether someone standing at feet is touching a flag lying at a point.
/** @param {Vector3} feet @param {Vector3} at @param {number} reach */
function touches(feet, at, reach = FLAG_REACH) {
  return Math.hypot(feet[0] - at[0], feet[2] - at[2]) <= reach && Math.abs(feet[1] - at[1]) < 1.5;
}

/** @param {unknown} value @returns {value is import('../shared/runtime-types.ts').ScoreRecord} */
function validScore(value) {
  return (
    isRecord(value) &&
    cleanToken(value['token']) !== null &&
    typeof value['name'] === 'string' &&
    typeof value['color'] === 'string' &&
    finite(value['kills']) &&
    finite(value['deaths'])
  );
}
/** @param {Team} team @returns {Vector3} */
function flagBase(team) {
  const base = FLAG_BASES[team];
  if (!base) throw new Error(`Map has no ${team} flag base`);
  return base;
}
