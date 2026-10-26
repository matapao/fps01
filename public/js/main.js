// fps01 in the browser: your player, input, networking and the render loop.

import * as THREE from 'three';
import { spreadFor } from '/shared/aim.js';
import {
  EYE_HEIGHT,
  MOVE_SPEED,
  HOOK_COOLDOWN_MS,
  HOOK_RANGE,
  MAX_HEALTH,
  PLAYER_HEIGHT,
  RESPAWN_MS,
  SEND_RATE,
  SPEED_CAP,
  SPREAD_STILL,
} from '/shared/constants.js';
import { checkData } from '/shared/check.js';
import { DATA, HASH, onData, useData } from '/shared/data.js';
import { CRATE_ITEMS, POWERUPS } from '/shared/loot.js';
import {
  AIR,
  CELL,
  GRID_MIN,
  ITEMS,
  JUMP_PADS,
  MAP,
  MAPS,
  MAP_ORDER,
  MATERIALS,
  POOL,
  inWater,
  useMap,
} from '/shared/map.js';
import { stepMovement } from '/shared/movement.js';
import { dispatchServerMessage } from '/shared/server-messages.js';
import { element } from './dom.js';
import { indexed, lookup } from '/shared/indexed.js';
import { mapVector, AXES } from '/shared/vector.js';
/** @typedef {import('../../shared/contracts.ts').Vector3} Vec3 */
/** @typedef {import('../../shared/runtime-types.ts').Team} Team */
/** @typedef {import('../../shared/server-messages.js').ServerMessages} ServerMessages */
import { eyePosition, rayWorld } from '/shared/physics.js';
import { startGrapple, stepGrapple, stepMantle } from '/shared/grapple.js';
import { canHook, hookSpot } from '/shared/reach.js';
import { fullLevel } from '/shared/water.js';
import { Voxels, cellCentre } from '/shared/voxels.js';
import { TRICK_SPEED } from '/shared/tricks.js';
import { ARSENAL, WEAPONS, zoomOf } from '/shared/weapons.js';
import { stateChanged } from '/shared/wire.js';
import { Arsenal } from './arsenal.js';
import { WeaponTips } from './weapon-tips.js';
import { createMouse } from './mouse.js';
import * as sound from './audio.js';
import { Avatars, TEAM_COLORS } from './avatars.js';
import { BOX } from './body.js';
import { Effects, Flags, PadGlows, Projectiles, Ropes } from './effects.js';
import { BUTTON, createGamepad, padOf } from './gamepad.js';
import { createGun } from './guns.js';
import * as hud from './hud.js';
import { Crates, Powerups, Woollies } from './loot.js';
import { Pickups } from './pickups.js';
import { Radar } from './radar.js';
import { StrikeMap } from './strikemap.js';
import { Chunks, Dust, Falling, Pour } from './debris.js';
import { createWorld } from './world.js';
import { openSocket, zirbel } from './transport.js';
import { createTouch, touchDevice } from './touch.js';
import { PLANETS } from '/shared/planets.js';

// What hits count as: those that come from a blast, not straight from whoever fired; and how hard
// the boxes knocked off someone fly, by what hit them (data/weapons.json and data/projectiles.json).
/** @type {Set<string>} */
let BLASTS;
/** @type {Record<string, number>} */
let FLING;
onData(({ weapons, projectiles }) => {
  BLASTS = new Set([
    'woolly',
    ...projectiles.projectiles.filter((p) => p.blast).map((p) => p.credit ?? p.id),
  ]);
  FLING = {
    crush: 5,
    ...Object.fromEntries(weapons.weapons.map((w) => [w.id, w.fling ?? 4])),
    kick: weapons.kick?.fling ?? 8,
    ball: weapons.juggling?.fling ?? 4,
  };
});
/** @type {{at: Vec3 | null; time: number}} */
const lastBlast = { at: null, time: -Infinity };
const METEOR_FLASH = 2; // how big a planet's piece looks as it strikes, as a blast's radius (m)

const canvas = element('game', HTMLCanvasElement);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.autoClear = false; // the sky, the arena and the gun are drawn in passes, see the render loop

// The arena, kept in step with the server's: the same map, the same holes, carved in the same order.
const voxels = new Voxels();
const { scene, sky, water, building, lighting } = createWorld(voxels);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
camera.rotation.order = 'YXZ'; // turn left/right first, then look up/down
scene.add(camera);
const avatars = new Avatars(scene);
const effects = new Effects(scene, voxels);
const projectiles = new Projectiles(scene, effects, (at) => sound.clink(at));
const ropes = new Ropes(scene);
const chunks = new Chunks(scene, voxels); // what blasts throw about
const falling = new Falling(scene); // pieces of the arena that came loose, on their way down
const dust = new Dust(scene); // gravel and hay sifting down after a heap of it falls
const pour = new Pour(scene, voxels); // the pool running out
const pool = { level: fullLevel(), droppedAt: -Infinity, pourAt: 0 };
const flags = new Flags(scene);
const padGlows = new PadGlows(scene);
const pickups = new Pickups(scene);
const powerups = new Powerups(scene);
const crates = new Crates(scene);
const flock = new Woollies(scene);
const strikeMap = new StrikeMap();
const radar = new Radar(element('radar', HTMLCanvasElement));
const gun = createGun();
gun.setLight(1);

// Where a teleport would put you, while you hold one: a ring on the floor and a ghost of you.
const teleportMarker = new THREE.Group();
const teleportGhost = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.4, 1, 4, 10),
  new THREE.MeshBasicMaterial({ color: 0xc77dff, transparent: true, opacity: 0.18, depthWrite: false }),
);
teleportGhost.position.y = 0.9;
teleportMarker.add(
  new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xc77dff, transparent: true, opacity: 0.8, depthWrite: false }),
  ),
  teleportGhost,
);
teleportMarker.visible = false;
scene.add(teleportMarker);

// You. Positions are feet, as [x, y, z].
/** @type {import('./browser-context.d.ts').ClientPlayer} */
const me = {
  id: null, // set by the server's welcome message
  alive: false,
  feet: [0, 0, 0],
  velocity: [0, 0, 0],
  dodgeAt: -Infinity, // when you last dodged, and whether you've used your dodge in the air
  airDodged: false,
  padAt: -Infinity, // when a jump pad last threw you
  yaw: 0,
  pitch: 0,
  onGround: false,
  powerup: null, // { kind, until }: a powerup from the pedestal
  team: null, // in capture the flag: 'red' or 'blue'
  carrying: null, // the team whose flag you have
  spread: SPREAD_STILL, // how far shots can stray from the crosshair right now, in radians
  respawnAt: 0,
};
// Your grappling hook: where it caught (null when it hasn't), the cell it's caught in, and where it
// leaves you: on top of what it caught on (the ledge).
/** @type {{anchor: Vec3 | null; cell: Vec3 | null; ledge: Vec3 | null; goal: Vec3 | null; queued: boolean; lastFire: number; missEnd: Vec3 | null; missUntil: number; mantle: boolean}} */
const hook = {
  anchor: null,
  cell: null,
  ledge: null,
  goal: null,
  queued: false,
  lastFire: -Infinity,
  missEnd: null,
  missUntil: 0,
  mantle: false,
};
/** @type {import('../../shared/runtime-types.ts').Mantle | null} */
let climb = null; // just let go below a ledge: { y, toward, until }, to carry you up and over it
let eyeLag = 0; // how far your view is still catching up after a step up, in metres
/** @type {Map<number, import('../../shared/runtime-types.ts').PlayerSnapshot>} */
let players = new Map(); // id → latest snapshot entry: names, colours, scores
// The round: its mode and map, whether it's over, and in capture the flag the captures and the flags.
/** @type {import('./browser-context.d.ts').MatchView} */
const match = { mode: 'dm', map: MAP.id, over: false, captures: { red: 0, blue: 0 }, flags: null };
/** @param {Team} team */
const teamName = (team) => DATA.characters.teams?.[team]?.name ?? team;
let shake = 0; // camera shake from nearby explosions, 0 to 1
let zoom = 0; // how far the rifle's zoom is in, 0 to 1
let zooming = { fov: 35, slow: 0.4, steady: 0.65 }; // the zoom in your hands, or the last one (data/weapons.json)
let stepClock = 0; // metres since your last footstep
// Something of yours you're steering: a pilot missile (you see from it, the mouse turns it) or a woolly
// on the run. Either way, a click sets it off.
/** @type {{kind: string | null; id: number | null; yaw: number; pitch: number; sentAt: number; baaAt: number}} */
const guide = { kind: null, id: null, yaw: 0, pitch: 0, sentAt: 0, baaAt: 0 };
/** @type {{killer: number} | null} */
let killcam = null; // while you're dead: who killed you, so the camera can look at them
/** @type {{target: number | null} | null} */
let victory = null; // between rounds: { target } whose win the camera circles

// Your own settings, kept in this browser; until you change them, the game's (data/hud.json).
const settings = {
  sensitivity: Number(load('sensitivity')) || 1,
  invertMouse: load('invert-mouse') === 'on',
  crosshair: load('crosshair') || DATA.hud.crosshair.shape, // its shape
  crosshairColor: load('crosshair-color') || DATA.hud.crosshair.color,
  crosshairSpread: (load('crosshair-spread') ?? (DATA.hud.crosshair.spread ? 'on' : 'off')) !== 'off', // whether it opens up to show your spread
};

const lookDirection = new THREE.Vector3();
const look = () => camera.getWorldDirection(lookDirection).toArray();

// Your weapons (arsenal.js), with what they need from the rest of the game.
export const shared = {
  me,
  camera,
  scene,
  voxels,
  avatars,
  effects,
  gun,
  sound,
  hud,
  send: /** @param {unknown} message */ (message) => send(message),
  look,
  rush: () => {
    if (me.powerup?.kind !== 'rush' || me.powerup.until <= performance.now()) return 1;
    const speed = lookup(POWERUPS, 'rush').speed;
    if (speed === undefined) throw new Error('Rush powerup has no speed');
    return speed;
  },
  openStrikeMap: () => openStrikeMap(),
  colorOf: /** @param {number | null} id */ (id) => {
    const player = id === null ? undefined : players.get(id);
    return player?.team ? lookup(TEAM_COLORS, player.team) : (player?.color ?? '#ffffff');
  },
  chipsOff: /** @param {Vec3} at @param {{cell: Vec3; normal: Vec3}} block */ (at, block) =>
    chipsOff(at, block),
  flourish: () => flourish(),
};
const arsenal = new Arsenal(shared);
const weaponTips = new WeaponTips({
  read: () => load('weapon-tips-v1'),
  write: (ids) => save('weapon-tips-v1', JSON.stringify(ids)),
  show: hud.weaponTip,
});

// ---- Networking ----

const socketUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const socket = openSocket(socketUrl); // a WebSocket, or on a zirbel host the hub (transport.js)
// Identifies this browser tab, so after a reload or an update you keep your name and score.
const token = load('token', true) || randomToken();
save('token', token, true);
// Set when this tab reloaded itself to rejoin: the version of the code it ran before.
const resumeFrom = load('resume', true);
/** @type {string | null} */
let version = null; // of the code this page runs, from the server's hello
let updateReady = false; // newer code is waiting for someone to press Update
let updating = false; // the server is switching to it
/** @type {string[]} */
let lanAddresses = []; // where friends open the game, from the server's hello
// A game's code on the end of the address; on a zirbel host, the room the lobby opened.
let wantCode = zirbel
  ? zirbel.room || null
  : /^#[A-Za-z]{4}$/.test(location.hash)
    ? location.hash.slice(1).toUpperCase()
    : null;
let joinSent = false; // asked to create or join a game
/** @type {Omit<ServerMessages['joined'], 'type'> | null} */
let inGame = null; // the game you're in: { code, name, map, mode }

/** @param {unknown} message */
function send(message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** @type {import('../../shared/server-messages.js').ServerHandlers} */
const handlers = {
  hello: onHello,
  world: onWorld,
  update: ({ ready }) => showUpdate(ready),
  updating: ({ by }) => {
    updating = true;
    hud.setUpdate('busy', by ? `${by} is updating the game…` : 'Updating the game…');
  },
  welcome: ({ id }) => {
    me.id = id;
  },
  games: ({ games }) => {
    hud.showGames(games, wantCode);
    previewMap(hud.currentRoomGame()?.map ?? create.map);
  },
  joined: onJoined,
  nogame: onNoGame,
  full: ({ scope }) => {
    joinSent = false;
    releasePointer();
    hud.setStatus(
      scope === 'players'
        ? 'This game is full · choose another game'
        : 'There are as many games as there can be · join one',
      true,
    );
  },
  snapshot: onSnapshot,
  self: onSelf,
  round: onRound,
  flag: onFlag,
  spawn: onSpawn,
  shot: onShot,
  chip: onChip,
  launch: onLaunch,
  pressure: ({ id, from, at }) => {
    effects.pressure(id === me.id ? gun.muzzle(camera) : from, at);
    if (id !== me.id) sound.rocket(from);
    else shake = Math.max(shake, 0.15);
  },
  boom: onBoom,
  arc: ({ id, points }) => {
    effects.arc(points);
    if (id !== me.id) sound.overload(points[0]);
  },
  rubble: onRubble,
  fall: onFall,
  landed: onLanded,
  crack: onCrack,
  planet: onPlanet,
  build: ({ entry }) => {
    building.touch(voxels.apply(entry));
  },
  // The server shoves you: a kick.
  push: ({ velocity }) => {
    if (!me.alive) return;
    for (const i of AXES) me.velocity[i] += velocity[i];
    me.onGround = false;
  },
  kick: ({ id }) => sound.kick(players.get(id)?.feet ?? null),
  item: onItem,
  medal: onMedal,
  powerup: onPowerup,
  crate: onCrate,
  special: onSpecial,
  teleport: onTeleport,
  guiding: onGuiding,
  // The server put you somewhere else: a teleport.
  moved: ({ feet }) => {
    me.feet = [...feet];
    me.velocity = [0, 0, 0];
    dropHook();
  },
  // You died: who did it, and what they had left.
  killcam: ({ killer, hp, armor }) => {
    killcam = { killer };
    hud.setDeathNote(`${players.get(killer)?.name ?? 'They'} had ${hp} health and ${armor} armor left`);
  },
  hit: onHit,
  kill: onKill,
  data: onDataMessage,
  pong: ({ t }) => hud.setPing(performance.now() - t),
};

socket.addEventListener('message', (event) => {
  // JSON, or on zirbel a snapshot already read from its bytes (transport.js).
  if (event instanceof MessageEvent) dispatchServerMessage(handlers, event.data);
});

/** @type {ReturnType<typeof setInterval> | undefined} */
let pingTimer;
socket.addEventListener('open', () => {
  hud.setStatus('Connected');
  hud.enableCreate(true);
  clearInterval(pingTimer);
  pingTimer = setInterval(() => send({ type: 'ping', t: performance.now() }), 2000);
});

socket.addEventListener('close', () => {
  clearInterval(pingTimer);
  me.alive = false;
  releasePointer();
  hud.enableCreate(false);
  hud.setStatus(
    updating ? 'Updating the game…' : 'Lost the connection to the server. Reconnecting…',
    !updating,
  );
  if (!updating) hud.setUpdate('busy', 'Reconnecting…');
  reconnect();
});

// Once the server is back (with new code, or restarted), reload so this page runs the same
// version as the server, and rejoin the game you were in (its code is on the end of the address).
function reconnect() {
  if (zirbel) {
    // zirbel-net reconnects by itself and keeps the seat; this is a seat that ran out, or a host
    // that stopped. Come back into the game the way a reload does.
    if (inGame) save('resume', version ?? '', true);
    setTimeout(() => location.reload(), 2000);
    return;
  }
  const probe = new WebSocket(socketUrl);
  probe.addEventListener('open', () => {
    if (inGame) save('resume', version ?? '', true);
    location.reload();
  });
  probe.addEventListener('error', () => setTimeout(reconnect, 1000));
}

// The server says hello: the games on it to join (the one in the address marked), and where friends
// find it. Back after a reload or an update (this tab's note says so, or on zirbel the room does: its
// seat was in the game), you go straight back into your game. On zirbel, a hello while you're in a
// game (or on your way in) is a new authority taking over the room: back into its game, as you were.
let resumed = resumeFrom === null;
/** @param {ServerMessages['hello']} hello */
function onHello(hello) {
  const { addresses, version: current, update, games = [] } = hello;
  lanAddresses = addresses;
  hud.setLanUrls(addresses);
  version = current ?? null;
  showUpdate(update === true);
  hud.showGames(games, wantCode);
  previewMap(hud.currentRoomGame()?.map ?? create.map);
  if (wantCode) codeInput.value = wantCode;
  if (hello.data && hello.data !== HASH) send({ type: 'data' }); // the room plays by other data: ask for it
  if (zirbel && (inGame || joinSent)) {
    send({
      type: 'create',
      map: inGame?.map ?? create.map,
      mode: inGame?.mode ?? create.mode,
      token,
      data: HASH,
    });
    return;
  }
  if (resumed && !hello.back) return;
  resumed = true;
  save('resume', null, true);
  if (wantCode) enterGame({ type: 'join', code: wantCode }, false);
  if (!updateReady)
    hud.setUpdate(
      'done',
      resumeFrom === null || resumeFrom === version
        ? 'Back in the game · click Resume'
        : 'Updated to the new version · click Resume',
    );
}

// Leaving the page while in a game (a reload, say): the next page comes straight back into it.
let leaving = false;
addEventListener('pagehide', () => {
  if (inGame && !leaving) save('resume', version ?? '', true);
});

// On zirbel: what this page has seen of the game, for an authority that takes over the room here
// to go on from (transport.js): the map and mode, the arena's holes, and everyone's score by seat.
const planetsGone = new Set();
if (zirbel) {
  zirbel.view = () =>
    inGame && {
      map: match.map,
      mode: match.mode,
      history: voxels.history,
      water: voxels.water,
      planets: [...planetsGone],
      players: [...players.values()].map(({ seat, name, color, kills, deaths }) => ({
        seat,
        name,
        color,
        kills,
        deaths,
      })),
    };
}

/** @param {boolean} ready */
function showUpdate(ready) {
  updateReady = ready;
  if (ready) hud.setUpdate('ready', 'New version ready');
  else if (!updating) hud.setUpdate(null);
}

function requestUpdate() {
  if (updateReady && !updating) send({ type: 'update' });
}

element('update-button', HTMLElement).addEventListener('click', requestUpdate);

// The data the room plays by, when it isn't this page's (a revision of the game's data, from its
// next round on): checked, and then played by here too. What's drawn from it is drawn again.
let dataChanged = false;
/** @param {ServerMessages['data']} message */
function onDataMessage({ hash, blocks }) {
  if (hash === HASH) return;
  const problems = checkData(blocks);
  if (problems.length) {
    console.warn('the room sent data that does not check:', problems.slice(0, 5));
    return;
  }
  useData(blocks, { hash });
  dataChanged = true;
  hud.setupCreate(pickCreate);
  if (!Object.hasOwn(MAPS, create.map)) create.map = indexed(MAP_ORDER, 0);
  if (!DATA.rules.modes.includes(create.mode)) create.mode = indexed(DATA.rules.modes, 0);
  hud.setCreate(create.mode, create.map);
  sky.setPlanets();
  if (!inGame) {
    previewing = null;
    previewMap(hud.currentRoomGame()?.map ?? create.map);
  }
}

// The arena as the server has it: the map, as new, then every hole since, in order.
/** @param {ServerMessages['world']} message */
function onWorld({ mode = 'dm', map = 'depot', history, water: level = null, planets: gone = [] }) {
  match.mode = mode;
  sky.setGone(gone);
  planetsGone.clear();
  for (const n of gone) planetsGone.add(n);
  if (map !== MAP.id || dataChanged) showMap(map);
  dataChanged = false;
  radar.clear();
  voxels.reset(mode, MAP.id);
  for (const entry of history) voxels.apply(entry);
  if (level === null) level = fullLevel();
  setWater(level);
  falling.clear();
  pour.clear();
  building.markAll();
  building.update(Infinity); // all of it now, rather than bit by bit
  dropHook();
}

// The map being played, everywhere it shows: its jump pads, pickups, pedestal, flag stands, pool and
// light.
/** @param {string} id */
function showMap(id) {
  useMap(id);
  match.map = MAP.id;
  water.setPool(POOL);
  padGlows.place(JUMP_PADS);
  pickups.place();
  powerups.place();
  flags.place();
  lighting.setLook(MAP.look);
}
showMap(MAP.id);

/** @param {ServerMessages['snapshot']} message */
function onSnapshot({
  players: list,
  projectiles: flying = [],
  items = [],
  round,
  water: level = voxels.water,
  powerups: pedestal,
  crates: drifting,
  woollies,
}) {
  players = new Map(list.map((player) => [player.id, player]));
  avatars.sync(list, victory?.target === me.id ? null : me.id); // you can see yourself win
  projectiles.sync(flying, performance.now());
  pickups.sync(items);
  powerups.sync(pedestal);
  crates.sync(drifting);
  radar.sync({ items, crates: drifting, powerups: pedestal });
  setWater(level);
  flock.sync(woollies);
  if (round) Object.assign(match, round, { flags: round.flags ?? null });
  flags.sync(match.mode === 'ctf' ? match.flags : null);
  const leader = leaderOf(list);
  avatars.setLeader(leader && leader.id !== me.id ? leader.id : null);
  hud.updateScores(list, me.id, { mode: match.mode, captures: match.captures, leaderId: leader?.id ?? null });
  hud.setMatch(match, leader, me.id);
  hud.setPlayerCount(list.length);
  const self = me.id === null ? undefined : players.get(me.id);
  hud.setYou(
    self?.name,
    self?.team ? teamName(self.team) : null,
    self?.team ? lookup(TEAM_COLORS, self.team) : (self?.color ?? null),
  );
  if (!self) return;
  if (me.team && self.team && self.team !== me.team && !match.over)
    hud.notice(`You're on ${teamName(self.team)} now, to even the teams`, 3000);
  me.team = self.team ?? null;
  if (self.carrying && hook.anchor) letGoOfHook(); // no hook while you carry a flag
  me.carrying = self.carrying ?? null;
  hud.setHealth(self.hp, self.armor ?? 0);
}

// What only you are told: your weapons and ammo, your special and your powerup.
/** @param {ServerMessages['self']} self */
function onSelf(self) {
  arsenal.sync(self);
  me.powerup = self.powerup ? { kind: self.powerup.kind, until: performance.now() + self.powerup.ms } : null;
}

/** @param {ServerMessages['spawn']} message */
function onSpawn({ id, feet, yaw }) {
  if (id !== me.id) {
    avatars.teleport(id, feet, yaw);
    return;
  }
  Object.assign(me, { alive: true, feet: [...feet], velocity: [0, 0, 0], yaw, pitch: 0 });
  dropHook();
  arsenal.reset();
  killcam = null;
  hud.setHealth(MAX_HEALTH, 0);
  hud.hideDeath();
}

/** @param {Vec3} point */
const distanceTo = (point) => Math.hypot(...point.map((value, i) => value - camera.position.getComponent(i)));

/** @param {ServerMessages['shot']} message */
function onShot(message) {
  arsenal.show(message);
  const { weapon, from, to } = message;
  if (WEAPONS[weapon]?.kind === 'beam' || WEAPONS[weapon]?.kind === 'rail') return;
  // If it hit a block, bits fly off it.
  const offset = mapVector(to, (value, i) => value - from[i]);
  const length = Math.hypot(...offset);
  const block =
    length > 0.01 &&
    voxels.raycast(
      from,
      mapVector(offset, (value) => value / length),
      length + 0.05,
    );
  if (block && block.distance > length - 0.1) chipsOff(to, block);
}

/** @param {Vec3} at @param {{cell: Vec3; normal: Vec3}} block */
function chipsOff(at, { cell, normal }) {
  const material = MATERIALS[voxels.get(...cell)];
  if (material) effects.chips(at, material.color, normal);
}

// The server says a bullet wore a block down, or broke it off.
/** @param {ServerMessages['chip']} message */
function onChip({ cell, wear, broke }) {
  if (broke) {
    const material = MATERIALS[voxels.get(...cell)];
    building.touch(voxels.breakOff(...cell));
    if (material) effects.chips(cellCentre(...cell), material.color, [0, 1, 0], 9, 0.09);
  } else {
    voxels.wear.set(voxels.index(...cell), wear);
    building.touch(cell);
  }
}

/** @param {ServerMessages['launch']} message */
function onLaunch({ id, shot, kind, from, velocity }) {
  if (shot !== undefined)
    projectiles.launch(shot, kind, id === me.id && kind === 'rocket' ? gun.muzzle(camera) : from, velocity);
  if (kind === 'choir') setTimeout(() => sound.choir(from), 1900);
  if (id === me.id || ['bomblet', 'splitterBit', 'missile'].includes(kind)) return;
  if (kind === 'rocket') sound.rocket(from);
  else if (kind === 'ball') {
    sound.toss(from);
    avatars.tossed(id); // a ball out of their juggling, for a moment
  } else sound.launch(from);
}

/** @param {ServerMessages['boom']} message */
function onBoom({ kind = 'frag', at, hole, radius = 4.5, push = 0, on = null }) {
  const distance = distanceTo(at);
  if (kind === 'ball') {
    // A thrown juggling ball coming down, on someone or on something.
    effects.impact(at);
    sound.thrown(at, on !== null);
    return;
  }
  if (kind === 'chew') {
    // Sudden death taking the floor away.
    effects.breach(at);
    sound.chew(at);
  } else if (kind === 'breach') {
    effects.breach(at);
    sound.boom(at);
    shake = Math.max(shake, 0.5 - distance / 20);
  } else if (kind === 'meteor') {
    // A piece of a blown-up planet striking: all show, it hurts nobody and pushes nobody.
    effects.explosion(at, METEOR_FLASH);
    sound.boom(at);
    shake = Math.max(shake, 0.35 - distance / 60);
  } else {
    // Something that blasts: a grenade, a rocket, a mortar and its bomblets.
    Object.assign(lastBlast, { at, time: performance.now() });
    effects.explosion(at, radius);
    sound.boom(at);
    shake = Math.max(shake, (1 - distance / 14) * Math.min(1, radius / 3.5));
    if (me.alive && push) knockBack(at, radius, push);
  }
  // Then the hole, exactly as the server tears it, throwing what it broke about.
  if (hole) {
    /** @type {number[]} */
    const materials = [];
    const removed = voxels.carve(at, hole, materials);
    building.touch(removed);
    chunks.blast(
      at,
      removed,
      materials,
      kind === 'chew' ? 0.3 : kind === 'breach' ? 0.6 : Math.max(0.6, push / 12),
    );
  }
}

// ---- The arena reacting ----

// The pool's level, as the server says: everyone wades and swims by it.
/** @param {number} level */
function setWater(level) {
  if (level < pool.level - 1e-4) pool.droppedAt = performance.now();
  pool.level = level;
  voxels.water = level;
  water.setLevel(level);
}

// While the pool runs out: water pouring from its holes into puddles below, and the sound of it.
/** @param {number} dt @param {number} now */
function updatePour(dt, now) {
  const running = now - pool.droppedAt < 600;
  pour.update(dt, now, pool.level, running);
  if (!running || now < pool.pourAt) return;
  pool.pourAt = now + 1000;
  const at = pour.nearest(camera.position.toArray());
  if (at) sound.pour(at);
}

// Gravel or hay falling through a hole: chunks of it tumbling down, and dust of it sifting after
// them. It lands as heaps a moment later, when the server says (a 'build').
/** @param {ServerMessages['rubble']} message */
function onRubble({ pieces }) {
  const now = performance.now();
  for (const [x, y, z, material] of pieces) {
    chunks.fling(
      [x, y, z],
      [(Math.random() - 0.5) * 2, -Math.random() * 2, (Math.random() - 0.5) * 2],
      new THREE.Color(MATERIALS[material]?.color ?? '#ffffff'),
      0.15 + Math.random() * 0.25,
    );
  }
  if (pieces.length) dust.sift(pieces, now);
}

// A piece of the arena has come loose: it leaves the arena, cracking, and starts to fall.
/** @param {ServerMessages['fall']} message */
function onFall(message) {
  building.touch(voxels.apply(message.entry));
  falling.start(message, performance.now());
  const at = message.cells.length
    ? mapVector(GRID_MIN, (base, a) => base + (indexed(message.cells, a) + 0.5) * CELL)
    : null;
  if (at) {
    sound.creak(at);
    effects.breach(at);
  }
}

// It has landed: part of the arena again where it came to rest (unless it shattered, or fell out
// of the arena), with a crash, dust and bits flying.
/** @param {ServerMessages['landed']} message */
function onLanded({ id, entry, at, size }) {
  const materials = falling.land(id);
  if (entry.length > 1) {
    building.touch(voxels.apply(entry));
  }
  if (!at) return;
  chunks.crash(at, materials.length ? materials : [1], size);
  effects.breach(at);
  if (inWater(at, voxels.water)) sound.splash(at);
  sound.crash(at, size);
  shake = Math.max(shake, Math.min(1, size / 80) * (1 - distanceTo(at) / 30));
}

// A planet blown up: it bursts in the sky with a huge bang, and its pieces streak in at the side of
// the arena facing it (each strikes with a 'boom', chipping a bit off, harmlessly).
/** @param {ServerMessages['planet']} message */
function onPlanet({ planet: n, by, strikes }) {
  sky.explode(n, performance.now());
  planetsGone.add(n);
  sound.planet();
  shake = Math.max(shake, 0.6);
  if (by === me.id) hud.notice(`You blew up ${indexed(PLANETS, n).name}`, 2000);
  const { dir } = indexed(PLANETS, n);
  for (const [x, y, z, ms] of strikes)
    effects.meteor([x + dir[0] * 90, y + dir[1] * 90, z + dir[2] * 90], [x, y, z], ms);
}

// A pillar has been blown right through: the roof over it groans and cracks, and dust sifts down
// from it (and bits of it fall: 'fall').
/** @param {ServerMessages['crack']} message */
function onCrack({ at }) {
  sound.creak(at);
  const pieces = Array.from(
    { length: 16 },
    /** @returns {[number, number, number, number, number]} */ () => [
      at[0] + (Math.random() - 0.5) * 5,
      at[1],
      at[2] + (Math.random() - 0.5) * 5,
      MAP.roof.m,
      0,
    ],
  );
  dust.sift(pieces, performance.now());
  shake = Math.max(shake, 0.35 * Math.max(0, 1 - distanceTo(at) / 30));
}

// The blast pushes you away from it, unless a wall is in between: hard enough, under your own
// feet, for a rocket jump.
/** @param {Vec3} at @param {number} radius @param {number} strength */
function knockBack(at, radius, strength) {
  /** @type {Vec3} */
  const centre = [me.feet[0], me.feet[1] + PLAYER_HEIGHT / 2, me.feet[2]];
  const offset = mapVector(centre, (value, i) => value - at[i]);
  const length = Math.hypot(...offset);
  const reach = radius + 1;
  if (length >= reach) return;
  /** @type {Vec3} */
  const dir = length > 0.01 ? mapVector(offset, (value) => value / length) : [0, 1, 0];
  if (rayWorld(voxels, at, dir, length) < length - 0.05) return;
  const push = strength * (1 - length / reach);
  me.velocity[0] += dir[0] * push;
  me.velocity[2] += dir[2] * push;
  me.velocity[1] = Math.max(me.velocity[1], 0) + push * 0.55;
  me.onGround = false; // in the air, so you keep the push: a rocket jump
}

/** @param {ServerMessages['hit']} message */
function onHit({ from, to, hp, armor = 0, head, weapon }) {
  if (to === me.id) {
    hud.setHealth(hp, armor);
    hud.damageFlash();
    sound.hurt();
  } else {
    knockBoxes(to, hp, { from, weapon });
  }
  if (from === me.id && to !== me.id) {
    hud.hitMarker(head === true);
    sound.hit(head === true);
  }
}

// Someone else was hurt: for every point of health they lost, from their feet up, a box of flesh
// flies off them, or a chip of colour off a bone, away from what hit them (a blast, or whoever
// fired); a kill sends every box they had left, skeleton and all, a rocket harder still.
/** @param {number} id @param {number} hp @param {Pick<ServerMessages['hit'], 'from' | 'weapon'>} hit */
function knockBoxes(id, hp, { from, weapon }) {
  const now = performance.now();
  const blast = BLASTS.has(weapon) && lastBlast.at !== null && now - lastBlast.time < 400;
  let source = blast ? lastBlast.at : null;
  if (!source && from !== null)
    source = from === me.id ? camera.position.toArray() : (avatars.pose(from, 0)?.head ?? null);
  if (weapon === 'crush') {
    const feet = players.get(id)?.feet;
    source = feet ? [feet[0], feet[1] + 6, feet[2]] : null; // it came down on them
  }
  const boxes = avatars.hurt(id, hp);
  const power = (blast ? 10 : (FLING[weapon] ?? 4)) * (hp <= 0 ? 1.4 : 1);
  const flungFrom = source;
  for (const { at, color, chip } of boxes) {
    /** @type {Vec3} */
    const away = flungFrom
      ? mapVector(at, (v, i) => v - flungFrom[i])
      : [Math.random() - 0.5, 0.4, Math.random() - 0.5];
    const length = Math.hypot(...away) || 1;
    const speed = power * (0.6 + Math.random() * 0.8) * (chip ? 0.6 : 1);
    const velocity = mapVector(
      away,
      (v, i) => (v / length) * speed + (Math.random() - 0.5) * 2 + (i === 1 ? 1.5 + Math.random() * 2.5 : 0),
    );
    chunks.fling(at, velocity, color, BOX * (chip ? 0.4 : 0.9 + Math.random() * 0.2)); // off a bone, just a chip of its colour
  }
}

// The player with the most kills, if nobody is level with them.
/** @param {import('../../shared/runtime-types.ts').PlayerSnapshot[]} list */
function leaderOf(list) {
  const most = Math.max(0, ...list.map((player) => player.kills));
  const leaders = list.filter((player) => player.kills === most);
  return most > 0 && leaders.length === 1 ? indexed(leaders, 0) : null;
}

/** @param {ServerMessages['kill']} message */
function onKill({ killer, victim, weapon }) {
  const k = killer === null ? undefined : players.get(killer);
  const self = killer === victim;
  const fell = weapon === 'void';
  if (victim === me.id) {
    me.alive = false;
    me.respawnAt = performance.now() + RESPAWN_MS;
    dropHook();
    guide.kind = null; // a pilot missile you were steering flies on by itself
    strikeMap.hide();
    let title = `Taken out by ${k?.name ?? 'someone'}`;
    if (fell) title = k ? `Knocked into the void by ${k.name}` : 'You fell into the void';
    else if (weapon === 'crush') title = k && !self ? `${k.name} brought it all down on you` : 'Crushed';
    else if (self) title = 'Caught in your own blast';
    else if (weapon === 'kick') title = `Kicked to death by ${k?.name ?? 'someone'}`;
    else if (weapon === 'ball') title = `Bonked by ${k?.name ?? 'someone'}'s juggling ball`;
    else if (weapon === 'woolly') title = `Blown up by ${k?.name ?? 'someone'}'s woolly`;
    else if (weapon === 'pilot') title = `Blown up by ${k?.name ?? 'someone'}'s pilot missile`;
    else if (WEAPONS[weapon]?.kind === 'rail') title = `Railed by ${k?.name ?? 'someone'}`;
    hud.showDeath(title);
  }
}

// ---- Menu ----

const sensitivityInput = element('sensitivity', HTMLInputElement);
const invertMouseInput = element('invert-mouse', HTMLInputElement);
const codeInput = element('code', HTMLInputElement);
sensitivityInput.value = String(settings.sensitivity);
hud.setSensitivity(settings.sensitivity);
invertMouseInput.checked = settings.invertMouse;
invertMouseInput.addEventListener('change', () => {
  settings.invertMouse = invertMouseInput.checked;
  save('invert-mouse', settings.invertMouse ? 'on' : 'off');
});

// The crosshair: its shape and colour, and whether it opens up to show your spread or stays put.
const crosshairInput = element('crosshair-style', HTMLSelectElement);
const crosshairColorInput = element('crosshair-color', HTMLSelectElement);
const crosshairSpreadInput = element('crosshair-spread', HTMLInputElement);
crosshairInput.value = settings.crosshair;
crosshairColorInput.value = settings.crosshairColor;
crosshairSpreadInput.checked = settings.crosshairSpread;
hud.setCrosshairLook(settings.crosshair, settings.crosshairColor);
crosshairInput.addEventListener('change', () => {
  settings.crosshair = crosshairInput.value;
  save('crosshair', settings.crosshair);
  hud.setCrosshairLook(settings.crosshair, settings.crosshairColor);
});
crosshairColorInput.addEventListener('change', () => {
  settings.crosshairColor = crosshairColorInput.value;
  save('crosshair-color', settings.crosshairColor);
  hud.setCrosshairLook(settings.crosshair, settings.crosshairColor);
});
crosshairSpreadInput.addEventListener('change', () => {
  settings.crosshairSpread = crosshairSpreadInput.checked;
  save('crosshair-spread', settings.crosshairSpread ? 'on' : 'off');
});

sensitivityInput.addEventListener('input', () => {
  settings.sensitivity = Number(sensitivityInput.value);
  hud.setSensitivity(settings.sensitivity);
  save('sensitivity', settings.sensitivity);
});

// Creating a game: the first mode the rules offer, on the map last picked.
const savedCreateMap = load('create-map');
/** @type {{mode: import('../../shared/runtime-types.ts').Mode; map: string}} */
const create = {
  mode: indexed(DATA.rules.modes, 0),
  map:
    savedCreateMap !== null && Object.hasOwn(MAPS, savedCreateMap) ? savedCreateMap : indexed(MAP_ORDER, 0),
};
/** @param {Partial<{mode: import('../../shared/runtime-types.ts').Mode; map: string}>} pick */
function pickCreate(pick) {
  Object.assign(create, pick);
  save('create-map', create.map);
  hud.setCreate(create.mode, create.map);
  previewMap(create.map);
}
hud.setupCreate(pickCreate);
hud.setCreate(create.mode, create.map);

// Behind the menu, before you're in a game: the map you'd play, as new (or the one the room's game
// is on). The camera circles it.
/** @param {string} id */
function previewMap(id) {
  if (inGame || !Object.hasOwn(MAPS, id) || (id === MAP.id && previewing === id)) return;
  previewing = id;
  match.mode = 'dm';
  showMap(id);
  voxels.reset('dm', MAP.id);
  setWater(fullLevel());
  falling.clear();
  pour.clear();
  building.markAll();
  building.update(Infinity);
}
/** @type {string | null} */
let previewing = null;
previewMap(create.map);
// What Play does: on zirbel, join the room's game once someone has started it; else a new game.
function play(capture = true) {
  const running = hud.currentRoomGame();
  enterGame(
    running ? { type: 'join', code: running.code } : { type: 'create', map: create.map, mode: create.mode },
    capture,
  );
}
element('create', HTMLElement).addEventListener('click', () => play());
hud.onPickGame((code) => enterGame({ type: 'join', code }));
element('code-form', HTMLElement).addEventListener('submit', (event) => {
  event.preventDefault();
  const code = codeInput.value.trim().toUpperCase();
  if (code) enterGame({ type: 'join', code });
});
element('resume', HTMLElement).addEventListener('click', () => {
  sound.unlock();
  capturePointer();
});
element('leave', HTMLElement).addEventListener('click', leaveGame);

// Into a game: a new one, or one already going (message: create or join). From a click, so the
// mouse is captured straight away (capture).
/** @param {{type: 'join'; code: string} | {type: 'create'; mode: import('../../shared/runtime-types.ts').Mode; map: string}} message */
function enterGame(message, capture = true) {
  if (joinSent || socket.readyState !== WebSocket.OPEN) return;
  joinSent = true;
  sound.unlock();
  send({ ...message, token, data: HASH });
  if (capture) capturePointer();
}

// In: the game's code goes on the end of the address, so a reload (or an update) comes back to it
// and the address is one to share.
/** @param {ServerMessages['joined']} message */
function onJoined({ code, name, map, mode }) {
  inGame = { code, name, map, mode };
  if (!zirbel) history.replaceState(null, '', `#${code}`); // on zirbel the room is in the address already
  hud.setGame({
    name,
    code,
    mode,
    map,
    url: zirbel ? zirbel.shareUrl(code) : `${lanAddresses[0] ?? location.origin}/#${code}`,
  });
  hud.setMenu('paused');
  hud.showHud(true);
}

// No game with that code (it may have closed): back to the list.
/** @param {ServerMessages['nogame']} message */
function onNoGame({ code }) {
  joinSent = false;
  releasePointer();
  if (zirbel) {
    // A new room: nobody has picked its map and mode yet. That's for whoever comes first.
    hud.setStatus('Nobody is playing here yet: pick a mode and a map');
    return;
  }
  history.replaceState(null, '', location.pathname);
  wantCode = null;
  hud.setStatus(`No game with the code ${code ?? ''} · it may have closed`, true);
}

// Out of the game you're in, and back to the list (on a zirbel host: its lobby).
function leaveGame() {
  leaving = true;
  if (zirbel) {
    location.href = zirbel.lobby;
    return;
  }
  history.replaceState(null, '', location.pathname);
  location.reload();
}

async function capturePointer() {
  if (touch) {
    startTouch();
    return;
  }
  try {
    // Raw mouse input (no OS acceleration) aims better, where the browser supports it.
    await canvas.requestPointerLock({ unadjustedMovement: true });
  } catch {
    try {
      await canvas.requestPointerLock();
    } catch {
      hud.setStatus('The browser did not capture the mouse. Click the button again.', true);
    }
  }
}

// ---- Input ----

const keys = new Set();
let dodgeQueued = false; // Shift: dodge on the next step
let lastSwitch = 0;
let touchPlaying = false; // in the game with the touch controls (there's no mouse to capture)
let padPlaying = false; // in the game with a gamepad
const isLocked = () => document.pointerLockElement === canvas || touchPlaying || padPlaying;
/** @param {...string} codes */
const held = (...codes) => (codes.some((code) => keys.has(code)) ? 1 : 0);

function releaseInput() {
  keys.clear();
  strikeMap.hide();
  arsenal.cancelInput();
  holdHook(false);
  hud.showScores(false);
}

document.addEventListener('pointerlockchange', () => {
  const locked = isLocked();
  if (document.pointerLockElement === canvas) document.documentElement.dataset['input'] = 'mouse';
  hud.showMenu(!locked);
  if (locked) {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    hud.clearUpdateNote();
  } else {
    releaseInput();
  }
});

document.addEventListener('pointerlockerror', () => {
  hud.setStatus('The browser did not capture the mouse. Click the button again.', true);
});

document.addEventListener('keydown', (event) => {
  if (!isLocked()) return;
  if (event.code === 'Tab' || event.code === 'Space') event.preventDefault();
  if (event.code === 'Tab') hud.showScores(true);
  const now = performance.now();
  const slot = /^Digit([1-7])$/.exec(event.code);
  // The number keys pick your weapon (and 7 your special).
  if (slot) {
    const selected =
      slot[1] === '7' ? 'special' : ARSENAL.find((name) => lookup(WEAPONS, name).slot === Number(slot[1]));
    if (selected !== undefined) arsenal.select(selected);
  } else if (event.code === 'KeyV' && !event.repeat) arsenal.kick(now);
  else if (event.code === 'KeyF' && !event.repeat) arsenal.trickKey();
  else if (event.code === 'KeyU') requestUpdate();
  else if (event.code === 'KeyE' && !event.repeat) holdHook(true);
  else if ((event.code === 'ShiftLeft' || event.code === 'ShiftRight') && !event.repeat) dodgeQueued = true;
  keys.add(event.code);
});

document.addEventListener('keyup', (event) => {
  keys.delete(event.code);
  if (event.code === 'Tab') hud.showScores(false);
  if (event.code === 'KeyE') holdHook(false);
});

/** @param {number} dx @param {number} dy @param {number} radiansPerPixel */
function aim(dx, dy, radiansPerPixel) {
  if (strikeMap.open) {
    strikeMap.move(dx, dy);
    return;
  }
  const radians = radiansPerPixel * settings.sensitivity * (camera.fov / DATA.hud.fov); // slower when zoomed in
  const view = guide.kind === 'pilot' ? guide : me;
  view.yaw -= dx * radians;
  view.pitch = Math.max(-1.55, Math.min(1.55, view.pitch - dy * radians));
}

// Left fires, right is the weapon's second use, middle goes back to the weapon you had before.
// With the air strike's map open, left calls it in and right calls it off; while you steer a
// pilot missile or have a woolly on the run, left sets it off.
createMouse(canvas, {
  getInvertY: () => settings.invertMouse && !strikeMap.open,
  look: (dx, dy) => aim(dx, dy, DATA.hud.look.mouse),
  press(event) {
    if (strikeMap.open) {
      if (event.button === 0) callStrike();
      else if (event.button === 2) strikeMap.hide();
      return;
    }
    if (guide.kind && event.button === 0) {
      send({ type: 'special', detonate: true });
      return;
    }
    if (event.button === 0) arsenal.setPrimary(true);
    else if (event.button === 2) arsenal.setSecondary(true, performance.now());
    else if (event.button === 1) {
      event.preventDefault();
      arsenal.swap();
    }
  },
  release(event) {
    if (event.button === 0) arsenal.setPrimary(false);
    if (event.button === 2) arsenal.setSecondary(false, performance.now());
  },
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

// ---- Touch: thumbs instead of the mouse and keys ----

const touch = touchDevice
  ? createTouch(element('touch', HTMLElement), {
      look: (dx, dy) => aim(dx, dy, DATA.hud.look.touch),
      fire: (down) => (down ? firePressed() : arsenal.setPrimary(false)),
      jump: (down) => (down ? keys.add('Space') : keys.delete('Space')),
      hook: holdHook,
      next: () => arsenal.cycle(1),
      pause: () => stopTouch(),
    })
  : null;
radar.setTouch(Boolean(touch));
if (touch) {
  document.documentElement.classList.add('touch-device');
  element('keys-help', HTMLElement).hidden = true;
  element('touch-help', HTMLElement).hidden = false;
  element('strike-help', HTMLElement).textContent =
    'Drag to aim · Fire calls it in · the menu button calls it off';
}

// What the left button does, for the fire button.
function firePressed() {
  if (strikeMap.open) callStrike();
  else if (guide.kind) send({ type: 'special', detonate: true });
  else arsenal.setPrimary(true);
}

// Playing by touch: the menu goes, the controls come; full screen and sideways where the browser lets
// a page ask (Android; an iPhone plays in a tab, or full screen from the home screen).
function startTouch() {
  if (!touch) return;
  document.documentElement.dataset['input'] = 'touch';
  touchPlaying = true;
  touch.show(true);
  hud.showMenu(false);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  hud.clearUpdateNote();
  const page = document.documentElement;
  if (!document.fullscreenElement && page.requestFullscreen) {
    page
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
}

function stopTouch() {
  if (!touch || !touchPlaying) return;
  touchPlaying = false;
  touch.show(false);
  releaseInput();
  hud.showMenu(true);
}

// Out of play, back to the menu: the mouse let go of, or the touch controls or the pad put away.
function releasePointer() {
  if (touchPlaying) stopTouch();
  else if (padPlaying) stopPad();
  else document.exitPointerLock();
}

// ---- A gamepad: the sticks instead of the mouse and keys ----

const gamepad = createGamepad();
let padJump = false; // A held
addEventListener('gamepadconnected', () => (element('pad-help', HTMLElement).hidden = false));

// What the pad does, every frame. From the menu, Start or A plays (or goes back into the game).
// Playing, the left stick moves and the right one looks (or aims the air strike, or steers the
// pilot missile); the right trigger fires and the left is the weapon's second use; A jumps, B
// dodges, X is the hook, the bumpers switch weapons (Y back to the last one); the d-pad's up is
// your special and down your juggling balls; the right stick's click kicks; Back holds the scores
// up; Start is the menu.
/** @param {number} dt @param {number} now */
function readPad(dt, now) {
  const active = !document.hidden && document.hasFocus();
  const pad = gamepad.poll(active);
  if (!active) return;
  const { pressed, released, down } = pad;
  if (!padPlaying) {
    if (!pad.connected || isLocked() || !(pressed.has(BUTTON.start) || pressed.has(BUTTON.a))) return;
    if (!inGame) play(false);
    if (inGame || joinSent) startPad();
    return;
  }
  if (!pad.connected || pressed.has(BUTTON.start)) {
    stopPad();
    return;
  }
  if (strikeMap.open) strikeMap.move(pad.look[0] * 700 * dt, pad.look[1] * 700 * dt);
  else if (pad.look[0] || pad.look[1])
    aim(pad.look[0] * padOf().look * dt, pad.look[1] * padOf().look * dt, 1);
  if (pressed.has(BUTTON.rt)) firePressed();
  if (released.has(BUTTON.rt)) arsenal.setPrimary(false);
  if (pressed.has(BUTTON.lt)) {
    if (strikeMap.open) strikeMap.hide();
    else arsenal.setSecondary(true, now);
  }
  if (released.has(BUTTON.lt)) arsenal.setSecondary(false, now);
  padJump = down.has(BUTTON.a);
  if (pressed.has(BUTTON.b) || pressed.has(BUTTON.ls)) dodgeQueued = true;
  if (pressed.has(BUTTON.x)) holdHook(true);
  if (released.has(BUTTON.x)) holdHook(false);
  if (pressed.has(BUTTON.rb) || pressed.has(BUTTON.right)) arsenal.cycle(1);
  if (pressed.has(BUTTON.lb) || pressed.has(BUTTON.left)) arsenal.cycle(-1);
  if (pressed.has(BUTTON.y)) arsenal.swap();
  if (pressed.has(BUTTON.up)) arsenal.select('special');
  if (pressed.has(BUTTON.down)) arsenal.trickKey();
  if (pressed.has(BUTTON.rs)) arsenal.kick(now);
  if (pressed.has(BUTTON.back)) hud.showScores(true);
  if (released.has(BUTTON.back)) hud.showScores(false);
}

function startPad() {
  document.documentElement.dataset['input'] = 'pad';
  padPlaying = true;
  sound.unlock();
  hud.showMenu(false);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  hud.clearUpdateNote();
}

function stopPad() {
  if (!padPlaying) return;
  padPlaying = false;
  padJump = false;
  releaseInput();
  hud.showMenu(true);
}

// The hook fires once when you press, and drags you for as long as you hold.
/** @param {boolean} held */
function holdHook(held) {
  if (held) hook.queued = true;
  else {
    hook.queued = false;
    letGoOfHook();
  }
}

document.addEventListener(
  'wheel',
  (event) => {
    // Trackpads send bursts of wheel events; one step per burst.
    if (!isLocked() || performance.now() - lastSwitch < 300 || event.deltaY === 0) return;
    lastSwitch = performance.now();
    arsenal.cycle(event.deltaY > 0 ? 1 : -1);
  },
  { passive: true },
);

function pauseInput() {
  releaseInput();
  if (touchPlaying) stopTouch();
  if (padPlaying) stopPad();
}
window.addEventListener('blur', pauseInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseInput();
});

// ---- Game loop ----

let previous = performance.now();
let sendClock = 0;
/** @type {import('../../shared/runtime-types.ts').StateMessage | null} */
let stateSent = null; // the last state sent, and when
let stateSentAt = 0;

renderer.setAnimationLoop((now) => {
  const dt = Math.min(Math.max(now - previous, 0) / 1000, 0.05);
  previous = now;

  readPad(dt, now);
  if (me.id === null) orbit(now);
  else updatePlayer(dt, now);
  sound.listen(camera.position.toArray(), camera.getWorldDirection(lookDirection).toArray());
  avatars.update(dt, (at) => sound.step(at));
  projectiles.update(now);
  pickups.update(now);
  powerups.update(now);
  crates.update(now, dt);
  flock.update(now, dt);
  updateTeleportMarker();
  strikeMap.draw([...players.values()], me.id, shared.colorOf);
  if (me.id !== null) radar.update(now, me);
  effects.update(dt, camera.position.toArray());
  gun.update(dt, me.alive && guide.kind !== 'pilot' && !victory);
  chunks.update(dt);
  falling.update(now);
  dust.update(dt, now);
  updatePour(dt, now);
  flags.update(now);
  padGlows.update(now);
  drawRopes(now);
  building.update();

  // Where you are, as often as SEND_RATE allows, but only when it changed (or once a second).
  sendClock = Math.min(sendClock + dt, 2 / SEND_RATE);
  if (me.alive && sendClock >= 1 / SEND_RATE) {
    sendClock -= 1 / SEND_RATE;
    /** @type {import('../../shared/runtime-types.ts').StateMessage} */
    const state = { type: 'state', feet: [...me.feet], yaw: me.yaw, pitch: me.pitch, held: arsenal.weapon };
    if (stateChanged(state, stateSent, now - stateSentAt)) {
      stateSent = state;
      stateSentAt = now;
      if ('state' in socket) socket.state(state);
      else send(state);
    }
  }
  if (me.id !== null && !me.alive) hud.updateDeath(me.respawnAt - now);
  if (me.id !== null) updateHud(now);
  weaponTips.update(
    arsenal.weapon,
    me.alive && hud.isPlaying() && !hud.hasNotice() && !document.hidden,
    dt,
    padPlaying ? 'pad' : touchPlaying ? 'touch' : 'mouse',
  );

  renderer.clear();
  sky.update(performance.now());
  sky.render(renderer, camera);
  renderer.clearDepth();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(gun.scene, gun.camera);
});

// Before you join, the camera circles the arena out among the stars, so the menu has a live backdrop.
/** @param {number} now */
function orbit(now) {
  const angle = now / 24000;
  camera.position.set(Math.sin(angle) * 62, 30, Math.cos(angle) * 62);
  camera.lookAt(0, 0, 0);
}

// Your health and weapons, the railgun's charge, your powerup, and the tint over everything.
/** @param {number} now */
function updateHud(now) {
  hud.setLoadout(arsenal);
  hud.setPowerup(
    me.powerup && me.alive && me.powerup.until > now
      ? { kind: me.powerup.kind, ms: me.powerup.until - now }
      : null,
  );
  hud.setGuide(
    guide.kind,
    guide.kind === 'pilot'
      ? 'Pilot missile · steer with the mouse · click to set it off'
      : guide.kind === 'woolly'
        ? 'Click to set off the woolly'
        : '',
  );
  hud.setCharge(me.alive ? arsenal.charge(now) : 0);
  gun.setCloak(me.alive && me.powerup?.kind === 'shimmer' && me.powerup.until > now);
  hud.setOverlay(inWater(camera.position.toArray(), voxels.water) ? 'water' : '');
}

/** @param {number} dt @param {number} now */
function updatePlayer(dt, now) {
  // Holding the right button with a rifle zooms in: a tighter aim, and you move slower.
  const lens = zoomOf(arsenal.weapon);
  if (lens) zooming = lens;
  zoom += ((arsenal.secondary && me.alive && lens ? 1 : 0) - zoom) * Math.min(1, dt * 12);
  const fov = DATA.hud.fov - (DATA.hud.fov - zooming.fov) * zoom;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  // Catch the surface shown in the last view before this frame moves the player's eye.
  if (hook.queued && me.alive) {
    hook.queued = false;
    fireHook(now);
  }
  if (me.alive) move(dt, now);
  steer(now);
  if (!me.alive && killcam) faceKiller(dt);
  const [x, y, z] = me.feet;
  eyeLag *= Math.exp(-dt * 14);
  camera.position.set(x, y + (me.alive ? EYE_HEIGHT + eyeLag : 0.5), z);
  camera.rotation.set(me.pitch, me.yaw, me.alive ? 0 : 0.5); // lie on the floor while dead
  if (victory) circleWinner(now);
  else if (guide.kind === 'pilot') ridePilot(now);
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.3;
    camera.position.y += (Math.random() - 0.5) * shake * 0.3;
    shake *= Math.exp(-dt * 7);
  }

  // Moving spoils your aim: the spread opens quickly and settles a moment after you stop.
  const target = me.alive ? spreadFor(me.velocity, me.onGround) * (1 - zooming.steady * zoom) : SPREAD_STILL;
  me.spread += (target - me.spread) * Math.min(1, dt * (target > me.spread ? 20 : 9));
  hud.setCrosshair(settings.crosshairSpread ? crosshairSize(me.spread) : 22);

  let actionHint = '';
  if (me.alive) {
    if (arsenal.pressureReady())
      actionHint = `${padPlaying ? 'RT' : touchPlaying ? 'Fire' : 'Left click'} · Rocket jump`;
    else if (!hook.anchor && hookable(now))
      actionHint = padPlaying ? 'X · Hook' : touchPlaying ? 'Hook' : 'E · Hook';
  }
  hud.prompt(actionHint);
  if (hook.anchor && hook.cell && voxels.get(...hook.cell) === AIR) letGoOfHook(); // blown away under it
  arsenal.update(now);
  // The faster you run, the livelier your juggling.
  gun.setMotion(
    me.alive ? (me.onGround ? Math.min(1, Math.hypot(me.velocity[0], me.velocity[2]) / MOVE_SPEED) : 0.6) : 0,
  );
}

// ---- Your juggling balls (F) ----

// F again, or the right button, with it out: on to the next trick, with a flourish.
function flourish() {
  hud.notice(gun.nextTrick(), 900);
  sound.flourish();
}

// The crosshair's gap in pixels matches the cone your shots can land in.
/** @param {number} spread */
function crosshairSize(spread) {
  const gap =
    (Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (window.innerHeight / 2);
  return Math.min(180, 14 + Math.max(8, gap * 2));
}

// Moving (shared/movement.js), or on the hook's rope.
/** @param {number} dt @param {number} now */
function move(dt, now) {
  if (hook.anchor && hook.goal) {
    const result = stepGrapple(
      me,
      { anchor: hook.anchor, goal: hook.goal, ledge: hook.ledge, mantle: hook.mantle },
      dt,
      now,
      voxels,
    );
    if (result.released) {
      letGoOfHook();
      climb = result.climb;
    }
    return;
  }
  // Over the ledge the hook caught on: once you're up above it, on over it.
  climb = stepMantle(me, climb, now);
  const steering = guide.kind === 'pilot'; // your body stands still while you fly the missile
  const flying = me.powerup?.kind === 'lift' && me.powerup.until > now;
  const pad = padPlaying ? gamepad.state.move : { forward: 0, strafe: 0 };
  const jumping = keys.has('Space') || padJump;
  const input = {
    forward: steering
      ? 0
      : held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown') + (touch?.stick.forward ?? 0) + pad.forward,
    strafe: steering
      ? 0
      : held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft') + (touch?.stick.strafe ?? 0) + pad.strafe,
    yaw: me.yaw,
    jump: !steering && !flying && jumping,
    dodge: dodgeQueued && !steering,
  };
  dodgeQueued = false;
  // The pad's stick runs you as fast as it's pushed; keys and the touch stick, flat out.
  const push = Math.min(1, Math.hypot(input.forward, input.strafe));
  // Lift: hold Space to rise, let go to drift down, and steer in the air as if on the ground.
  const lift = DATA.movement.lift;
  const flight = flying && lift ? { gravity: jumping ? -lift.rise : lift.fall, airAccel: lift.airAccel } : {};
  const tricking = arsenal.weapon === 'trick' ? TRICK_SPEED : 1; // a little faster with your juggling balls out, as with a knife
  const [before, grounded] = [me.feet[1], me.onGround];
  const happened = stepMovement(me, input, dt, voxels, now, {
    speed: MOVE_SPEED * push * (1 - zooming.slow * zoom) * shared.rush() * tricking,
    cap: SPEED_CAP * tricking,
    ...flight,
  });
  const rose = me.feet[1] - before;
  if (grounded && me.onGround && rose > 0.2 && rose < 0.7) eyeLag = Math.max(-0.6, eyeLag - rose); // up a step: the view follows smoothly
  if (flying) me.velocity[1] = Math.max(-7, Math.min(6, me.velocity[1]));
  if (happened.dodged) sound.dodge();
  if (happened.pad) sound.pad();
  // Your own footsteps, in time with how fast you run: one every 2.6 m.
  const speed = Math.hypot(me.velocity[0], me.velocity[2]);
  stepClock = me.onGround && speed > 2 ? stepClock + speed * dt : 0;
  if (stepClock > 2.6) {
    stepClock = 0;
    sound.step();
  }
}

// ---- Loot: powerups, crates and specials ----

// The pedestal's powerup: coming soon, there, taken, dropped by a dead carrier, or worn off.
/** @param {ServerMessages['powerup']} message */
function onPowerup({ event, kind, by }) {
  const name = POWERUPS[kind]?.name ?? kind;
  if (event === 'soon' || event === 'appeared') {
    sound.powerup(false);
  } else if (event === 'taken' && by === me.id) {
    hud.notice(name, 2000);
    sound.powerup(true);
  } else if (event === 'ended' && by === me.id) {
    hud.notice(`${name} has worn off`, 2000);
  }
}

// A crate coming down, or someone opening one.
/** @param {ServerMessages['crate']} message */
function onCrate({ event, item, by, at }) {
  if (event === 'dropping') {
    // Where it will land pings on the radar, before it gets there.
    sound.crate();
    if (at) radar.drop(at, performance.now());
    return;
  }
  if (event !== 'taken' || by !== me.id || item === undefined) return;
  const name = CRATE_ITEMS[item]?.name ?? item;
  sound.play(item === 'health' ? 'sounds/pickup-orb' : 'sounds/pickup-weapon');
  hud.notice(
    item === 'health'
      ? `${name}: ${lookup(CRATE_ITEMS, 'health')?.about ?? ''}`
      : `${name} · 7: ${CRATE_ITEMS[item]?.about ?? ''}`,
    2500,
  );
}

// Someone used a special.
/** @param {ServerMessages['special']} message */
function onSpecial({ kind, id }) {
  if (kind === 'woolly') sound.baa(players.get(id)?.feet ?? null);
}

/** @param {ServerMessages['teleport']} message */
function onTeleport({ id, from, to }) {
  effects.pulse([from[0], from[1] + 0.9, from[2]], 0xc77dff, 1.5, 0.5);
  effects.pulse([to[0], to[1] + 0.9, to[2]], 0xc77dff, 1.5, 0.5);
  sound.teleport(id === me.id ? null : from);
  sound.teleport(id === me.id ? null : to, true);
}

// The server says what you're steering (a pilot missile, a woolly), or that it's gone.
/** @param {ServerMessages['guiding']} message */
function onGuiding({ kind, id }) {
  if (kind === 'pilot') Object.assign(guide, { kind, id, yaw: me.yaw, pitch: me.pitch });
  else Object.assign(guide, { kind: kind ?? null, id: id ?? null });
}

// While you steer a pilot missile, it turns where you look, 20 times a second. A woolly baas as it runs.
/** @param {number} now */
function steer(now) {
  if (guide.kind === 'pilot' && now - guide.sentAt > 50) {
    guide.sentAt = now;
    const cos = Math.cos(guide.pitch);
    send({
      type: 'steer',
      dir: [-Math.sin(guide.yaw) * cos, Math.sin(guide.pitch), -Math.cos(guide.yaw) * cos],
    });
  }
  if (now >= guide.baaAt) {
    guide.baaAt = now + 1400 + Math.random() * 600;
    for (const id of flock.byId.keys()) sound.baa(flock.at(id));
  }
}

// The pilot missile's camera: from the missile, looking where you steer it.
/** @param {number} now */
function ridePilot(now) {
  const shot = guide.id === null ? undefined : projectiles.byId.get(guide.id);
  if (!shot) return;
  shot.mesh.visible = false;
  camera.position.fromArray(projectiles.position(shot, now));
  camera.rotation.set(guide.pitch, guide.yaw, 0);
}

// Dead, you turn to look at whoever killed you.
/** @param {number} dt */
function faceKiller(dt) {
  if (!killcam) return;
  const killer = avatars.pose(killcam.killer, 0)?.head;
  if (!killer) return;
  const offset = mapVector(killer, (v, i) => v - indexed([me.feet[0], me.feet[1] + 0.5, me.feet[2]], i));
  const yaw = Math.atan2(-offset[0], -offset[2]);
  const pitch = Math.atan2(offset[1], Math.hypot(offset[0], offset[2]));
  const k = Math.min(1, dt * 3);
  me.yaw += Math.atan2(Math.sin(yaw - me.yaw), Math.cos(yaw - me.yaw)) * k;
  me.pitch += (pitch - me.pitch) * k;
}

// Between rounds, the camera circles the winner, and keeps out of walls.
/** @param {number} now */
function circleWinner(now) {
  if (!victory || victory.target === null) return;
  const target =
    victory.target === me.id ? me.feet : avatars.byId.get(victory.target)?.group.position.toArray();
  if (!target) return;
  /** @type {Vec3} */
  const centre = [target[0], target[1] + 1.2, target[2]];
  const angle = now / 2600;
  const raw = /** @type {Vec3} */ ([Math.sin(angle), 0.35, Math.cos(angle)]);
  const dir = mapVector(raw, (v) => v / Math.hypot(...raw));
  const distance = Math.max(1.2, Math.min(4.5, rayWorld(voxels, centre, dir, 4.5) - 0.4));
  camera.position.set(...mapVector(centre, (v, i) => v + dir[i] * distance));
  camera.lookAt(...centre);
}

function openStrikeMap() {
  if (!me.alive) return;
  arsenal.setPrimary(false);
  strikeMap.show(voxels, me.feet, look());
}

function callStrike() {
  const [x, , z] = strikeMap.target();
  send({ type: 'special', at: strikeMap.target(), dir: [strikeMap.across[0], 0, strikeMap.across[1]] });
  strikeMap.hide();
  sound.strike();
  hud.notice(`Air strike called in at ${x.toFixed(0)}, ${z.toFixed(0)}`, 1500);
}

// While you hold a teleport, a marker shows where it would put you.
function updateTeleportMarker() {
  const at =
    me.alive && arsenal.weapon === 'special' && arsenal.special === 'teleport'
      ? arsenal.teleportTarget()
      : null;
  teleportMarker.visible = Boolean(at);
  if (at) teleportMarker.position.fromArray(at);
}

// ---- Pickups and medals ----

// A pickup taken, or a Health Orb about to come back.
/** @param {ServerMessages['item']} message */
function onItem({ spot, event, by }) {
  const item = ITEMS[spot];
  if (!item) return;
  if (event !== 'taken' || by !== me.id) return;
  if (item.sound) sound.play(item.sound);
  hud.notice(item.name, 1200);
}

// A medal: yours gets a fanfare.
/** @param {ServerMessages['medal']} message */
function onMedal({ id }) {
  if (id === me.id) sound.medal();
}

// A round starting, or won.
/** @param {ServerMessages['round']} message */
function onRound({ state, mode, winner, ms }) {
  match.mode = mode;
  match.over = state === 'over';
  if (state === 'sudden') return; // the match line says so
  if (state === 'over') {
    // The camera circles the winner: in capture the flag, the winning team's best player.
    const best = winner?.team
      ? [...players.values()].filter((p) => p.team === winner.team).sort((a, b) => b.kills - a.kills)[0]
      : null;
    const target = winner?.id ?? best?.id ?? null;
    victory = target === null ? null : { target };
    guide.kind = null;
    strikeMap.hide();
    const title = !winner
      ? 'A draw: nobody wins the round'
      : winner.team
        ? `${teamName(winner.team)} team wins!`
        : winner.id === me.id
          ? 'You win the round!'
          : `${winner.name ?? 'Someone'} wins the round!`;
    hud.hideDeath();
    if (ms === undefined) throw new Error('Round-over event has no next-round duration');
    hud.showRoundOver(title, ms);
    hud.showScores(true, true);
    return;
  }
  victory = null;
  hud.hideRoundOver();
  hud.showScores(false);
}

// Capture the flag: a flag taken, dropped, sent home, or captured. The match line shows where both
// are; you hear about your own doing.
/** @param {ServerMessages['flag']} message */
function onFlag({ team, event, by, captures }) {
  if (captures) match.captures = captures;
  if (by !== me.id) return;
  if (event === 'taken') hud.notice(`You have the ${teamName(team)} flag: bring it home`, 2500);
  else if (event === 'captured') hud.notice(`You captured the ${teamName(team)} flag`, 2500);
}

// ---- Grappling hook ----

// Where the hook would catch if you fired it now: the first surface in range where you look, as
// { at, cell, normal }, or null.
function hookTarget() {
  const origin = eyePosition(me.feet);
  const dir = look();
  const hit = voxels.raycast(origin, dir, HOOK_RANGE);
  return (
    hit && {
      at: mapVector(origin, (value, i) => value + dir[i] * hit.distance),
      cell: hit.cell,
      normal: hit.normal,
    }
  );
}

// Whether the hook would catch where you look: overhead or somewhere you couldn't walk to (shared/reach.js).
// Worked out a few times a second, for the "E · Hook" under the crosshair.
const hookCheck = { at: 0, can: false };
/** @param {number} now */
function hookable(now) {
  if (now - hookCheck.at < 150) return hookCheck.can;
  hookCheck.at = now;
  const target = !me.carrying && hookTarget();
  hookCheck.can = !!target && canHook(voxels, me.feet, target.at, target.normal);
  return hookCheck.can;
}

// Fires the hook where you look. It catches on the first surface in range, if that's above you
// or somewhere you couldn't walk to; otherwise it comes back empty.
/** @param {number} now */
function fireHook(now) {
  if (now - hook.lastFire < HOOK_COOLDOWN_MS) return;
  if (me.carrying) {
    hud.notice("You can't use the hook while you carry the flag", 1800);
    return;
  }
  hook.lastFire = now;
  const target = hookTarget();
  if (target && !canHook(voxels, me.feet, target.at, target.normal)) {
    sound.empty();
    hud.notice("Aim at a roof or platform above you, or somewhere you can't walk to", 2200);
    return;
  }
  sound.hook(Boolean(target));
  if (!target) {
    const origin = eyePosition(me.feet);
    hook.missEnd = mapVector(origin, (value, i) => value + look()[i] * HOOK_RANGE);
    hook.missUntil = now + 120;
    return;
  }
  Object.assign(hook, startGrapple(target.at, hookSpot(voxels, target.at, target.normal)));
  hook.cell = target.cell;
  send({ type: 'hook', at: hook.anchor });
}

// Lets go, keeping the speed the rope gave you.
function letGoOfHook() {
  if (!hook.anchor) return;
  dropHook();
  send({ type: 'hook', at: null });
}

// Forgets the hook without telling anyone: the server already knows (you died, or respawned).
function dropHook() {
  hook.anchor = null;
  hook.goal = null;
  hook.ledge = null;
  hook.cell = null;
  hook.queued = false;
  climb = null;
}

const handOffset = new THREE.Vector3();

// Everyone's ropes: yours from your left hand, the others' from theirs.
/** @param {number} now */
function drawRopes(now) {
  if (me.alive && (hook.anchor || now < hook.missUntil)) {
    camera.updateMatrixWorld();
    const hand = camera.localToWorld(handOffset.set(-0.28, -0.3, -0.45)).toArray();
    const end = hook.anchor ?? hook.missEnd;
    if (me.id !== null && end) ropes.draw(me.id, hand, end);
  }
  for (const player of players.values()) {
    if (player.id === me.id || !player.hook || !player.alive) continue;
    const hand = avatars.hand(player.id);
    if (hand) ropes.draw(player.id, hand, player.hook);
  }
  ropes.sweep();
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  for (const view of [camera, gun.camera]) {
    view.aspect = window.innerWidth / window.innerHeight;
    view.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);
resize();

// Settings live in localStorage. The tab's token and resume note live in sessionStorage, which
// survives a reload but not closing the tab.
/** @param {string} key */
function load(key, session = false) {
  try {
    return (session ? sessionStorage : localStorage).getItem(`langame:${key}`);
  } catch {
    return null;
  }
}

/** @param {string} key @param {string | number | null} value */
function save(key, value, session = false) {
  try {
    const storage = session ? sessionStorage : localStorage;
    if (value === null) storage.removeItem(`langame:${key}`);
    else storage.setItem(`langame:${key}`, String(value));
  } catch {
    // Storage can be blocked; the setting just won't be remembered.
  }
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
