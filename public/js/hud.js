// Everything drawn over the 3D view: menu, health, weapons, scores. (The radar is radar.js.)

import { CTF_CAPTURES, DM_KILLS, MODES } from '/shared/constants.js';
import { DATA } from '/shared/data.js';
import { CRATE_ITEMS, POWERUPS } from '/shared/loot.js';
import { MAPS, MAP_ORDER } from '/shared/map.js';
import { ARSENAL, WEAPONS } from '/shared/weapons.js';
import { TEAM_COLORS } from './avatars.js';
import { zirbel } from './transport.js';

import { lookup } from '/shared/indexed.js';
import { weaponSpec } from '/shared/weapons.js';
import { element } from './dom.js';
/** @param {string} id */
const $ = (id) => element(id, HTMLElement);

const hud = $('hud');
const menu = $('menu');
const browse = $('browse');
const paused = $('paused');
const gameList = $('games');
const noGames = $('no-games');
const gamesBlock = $('games-block');
const roomLine = $('room');
const newGame = $('new-game');
const newLabel = $('new-label');
const createButton = element('create', HTMLButtonElement);
const gameAbout = $('game-about');
const gameShare = $('game-share');
const you = $('you');
const youColor = $('you-color');
const youName = $('you-name');
const youTeam = $('you-team');
const status = $('status');
const health = $('health');
const armor = $('armor');
const armorLine = $('armor-line');
const ping = $('ping');
const hitmarker = $('hitmarker');
const damage = $('damage');
const death = $('death');
const deathTitle = $('death-title');
const deathTimer = $('death-timer');
const deathNote = $('death-note');
const scoreboard = $('scoreboard');
const scores = $('scores');
const lan = $('lan');
const lanUrls = $('lan-urls');
const sensitivityValue = $('sensitivity-value');
const crosshair = $('crosshair');
const weaponName = $('weapon-name');
const weaponAmmo = $('weapon-ammo');
const slots = $('slots');
const noticeLine = $('notice');
const promptLine = $('prompt');
const tipBox = $('weapon-tip');
const tipTitle = $('weapon-tip-title');
const tipPrimary = $('weapon-tip-primary');
const tipSecondary = $('weapon-tip-secondary');
const tipExtra = $('weapon-tip-extra');
const matchBar = $('match');
const roundOver = $('round-over');
const roundTitle = $('round-title');
const roundNext = $('round-next');
const scoreboardTitle = $('scoreboard-title');
const modeButtons = [...document.querySelectorAll('button')].filter((button) =>
  button.hasAttribute('data-mode'),
);
const mapRow = $('maps');
const chargeBar = $('charge');
const overlay = $('overlay');
const powerupChip = $('powerup');
const powerupName = $('powerup-name');
const powerupLeft = $('powerup-left');
const guide = $('guide');
const guideText = $('guide-text');
/** @param {import('../../shared/runtime-types.ts').Team} team */
const teamName = (team) => DATA.characters.teams?.[team]?.name ?? team;
const FLAG_STATES = { home: 'at home', carried: 'taken!', dropped: 'dropped' };

/** @param {string} className @param {string | number} text */
const span = (className, text) =>
  Object.assign(document.createElement('span'), { className, textContent: String(text) });

let lastMatch = '';
// The bar at the top: what the round is played to and how it stands, and the time left (or sudden
// death). leader: the player with the most kills, if one has more than everyone else.
/** @param {import('./browser-context.d.ts').MatchView} match @param {import('./browser-context.d.ts').ScorePlayer | null} leader @param {number | null} selfId */
export function setMatch({ mode, captures, flags, ms = 0, sudden = false }, leader, selfId) {
  const seconds = Math.ceil(ms / 1000);
  const key = JSON.stringify([
    mode,
    captures,
    flags && [flags.red?.state, flags.blue?.state],
    leader?.id,
    leader?.kills,
    selfId,
    seconds,
    sudden,
  ]);
  if (key === lastMatch) return;
  lastMatch = key;
  const parts = [];
  if (mode === 'ctf') {
    /** @param {import('../../shared/runtime-types.ts').Team} team */
    const side = (team) => {
      const element = span(`match-team ${team}`, '');
      element.append(
        span('match-name', teamName(team)),
        span('match-score', captures[team]),
        span(
          `match-flag ${flags?.[team]?.state ?? 'home'}`,
          `⚑ ${FLAG_STATES[flags?.[team]?.state ?? 'home']}`,
        ),
      );
      return element;
    };
    parts.push(side('red'), span('match-goal', `first to ${CTF_CAPTURES}`), side('blue'));
  } else {
    const lead = !leader
      ? 'nobody leads yet'
      : leader.id === selfId
        ? `👑 you lead with ${leader.kills}`
        : `👑 ${leader.name} ${leader.kills}`;
    parts.push(span('match-goal', `Deathmatch · first to ${DM_KILLS} kills`), span('match-lead', lead));
  }
  parts.push(
    span(
      `match-clock${sudden ? ' sudden' : ''}`,
      sudden ? 'Sudden death' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    ),
  );
  matchBar.replaceChildren(...parts);
}

let roundTimer = 0;
// Between rounds: who won, and a countdown to the next one.
/** @param {string} title @param {number} ms */
export function showRoundOver(title, ms) {
  roundTitle.textContent = title;
  roundOver.hidden = false;
  const end = performance.now() + ms;
  clearInterval(roundTimer);
  const tick = () => {
    const left = Math.ceil((end - performance.now()) / 1000);
    roundNext.textContent = left > 0 ? `Next round in ${left}` : 'Starting…';
  };
  tick();
  roundTimer = window.setInterval(tick, 200);
}

export function hideRoundOver() {
  roundOver.hidden = true;
  clearInterval(roundTimer);
}

// ---- The menu ----

const MODE_NAMES = { dm: 'Deathmatch', ctf: 'Capture the flag' };

// The menu shows the games to join or create ('browse') until you're in one; then the game you're
// in, your settings and the controls ('paused').
let lanShown = false;
/** @param {'browse' | 'paused'} mode */
export function setMenu(mode) {
  browse.hidden = mode !== 'browse';
  paused.hidden = mode !== 'paused';
  lan.hidden = !lanShown || mode === 'paused'; // in a game, the share line says where friends join
}

// On zirbel the room you opened is the game: there is no list to pick from or code to type.
if (zirbel) {
  gamesBlock.hidden = true;
  newLabel.hidden = true;
}

/** @type {(code: string) => void} */
let pickGame = () => {};
// What happens when someone clicks a game in the list: handler(code).
/** @param {(code: string) => void} handler */
export function onPickGame(handler) {
  pickGame = handler;
}

/** @param {string[]} players */
const who = (players) =>
  players.length === 0
    ? 'nobody in it yet'
    : `${players.slice(0, 4).join(', ')}${players.length > 4 ? ` and ${players.length - 4} more` : ''}`;

let lastGames = '';
/** @type {import('./browser-context.d.ts').GameListing | null} */
let roomGame = null;
// On zirbel: the game in this room, if it has one yet. Play joins it; without one, Play starts it.
export const currentRoomGame = () => roomGame;

// The games on the server, each a button to join it: its name and code, what's played where, and
// who's in it. picked: the code of one to mark (the one in the address you opened).
/** @param {import('./browser-context.d.ts').GameListing[]} games @param {string | null} [picked] */
export function showGames(games, picked = null) {
  const key = JSON.stringify([games, picked]);
  if (key === lastGames) return;
  lastGames = key;
  if (zirbel) {
    roomGame = games[0] ?? null; // a room lists only its own game
    roomLine.hidden = !roomGame;
    newGame.hidden = !!roomGame;
    createButton.textContent = roomGame ? 'Join' : 'Play';
    if (roomGame) {
      const { mode, map, players } = roomGame;
      const playing =
        players.length === 0
          ? 'Nobody in it yet'
          : `${who(players)} ${players.length === 1 ? 'is' : 'are'} playing`;
      roomLine.replaceChildren(
        Object.assign(document.createElement('b'), {
          textContent: `${MODE_NAMES[mode]} on the ${MAPS[map]?.name ?? map}`,
        }),
        span('', playing),
      );
    }
    return;
  }
  noGames.hidden = games.length > 0;
  gameList.replaceChildren(
    ...games.map(({ code, name, map, mode, players }) => {
      const item = document.createElement('li');
      const button = Object.assign(document.createElement('button'), { type: 'button' });
      button.dataset['code'] = code;
      button.classList.toggle('picked', code === picked);
      button.append(
        span('', name),
        Object.assign(document.createElement('b'), { textContent: code }),
        Object.assign(document.createElement('small'), {
          textContent: `${MODE_NAMES[mode]} · ${MAPS[map]?.name ?? map} · ${who(players)}`,
        }),
      );
      button.addEventListener('click', () => pickGame(code));
      item.append(button);
      return item;
    }),
  );
}

// Creating a game: a button for each map, next to the two for the modes. onPick({ mode } or { map }).
// Again when the data changes: the maps are the layouts in it, the modes those its rules offer.
/** @type {(pick: {mode?: import('../../shared/runtime-types.ts').Mode, map?: string}) => void} */
let picked = () => {};
for (const button of modeButtons)
  button.addEventListener(
    'click',
    () =>
      (button.dataset['mode'] === 'dm' || button.dataset['mode'] === 'ctf') &&
      picked({ mode: button.dataset['mode'] }),
  );
/** @param {(pick: {mode?: import('../../shared/runtime-types.ts').Mode, map?: string}) => void} onPick */
export function setupCreate(onPick) {
  picked = onPick;
  for (const button of modeButtons)
    button.hidden =
      !(button.dataset['mode'] === 'dm' || button.dataset['mode'] === 'ctf') ||
      !MODES.includes(button.dataset['mode']);
  mapRow.replaceChildren(
    ...MAP_ORDER.map((id) => {
      const button = Object.assign(document.createElement('button'), {
        type: 'button',
        textContent: lookup(MAPS, id).name,
        title: lookup(MAPS, id).about,
      });
      button.dataset['map'] = id;
      button.addEventListener('click', () => onPick({ map: id }));
      return button;
    }),
  );
}

// Which mode and map are picked for a new game.
/** @param {string} mode @param {string} map */
export function setCreate(mode, map) {
  for (const button of modeButtons) button.classList.toggle('current', button.dataset['mode'] === mode);
  for (const button of mapRow.querySelectorAll('button'))
    button.classList.toggle('current', button.dataset['map'] === map);
}

/** @param {boolean} enabled */
export function enableCreate(enabled) {
  createButton.disabled = !enabled;
}

/** @type {(Pick<import('./browser-context.d.ts').GameListing, 'name' | 'code' | 'mode' | 'map'> & {url: string}) | null} */
let game = null;
// The game you're in, for the pause menu, and where friends join it: at a LAN party its code and
// address; on zirbel the host's lobby does the inviting.
/** @param {(Pick<import('./browser-context.d.ts').GameListing, 'name' | 'code' | 'mode' | 'map'> & {url: string}) | null} next */
export function setGame(next) {
  game = next;
  gameShare.hidden = !!zirbel;
  if (!zirbel && game)
    gameShare.replaceChildren('Friends join with ', span('code', game.code), ' at ', span('url', game.url));
  lastYou = '';
}

let lastYou = '';
// At the top of the pause menu: who you are, in your colour (your team's, in capture the flag),
// and under it what's played where. team: your team's name.
/** @param {string | undefined} name @param {string | null} team @param {string | null} color */
export function setYou(name, team, color) {
  if (!game) return;
  const key = `${name}:${team}:${color}`;
  if (key === lastYou) return;
  lastYou = key;
  you.hidden = !name;
  youName.textContent = name ?? '';
  youColor.style.background = color ?? 'var(--ink)';
  youTeam.textContent = team ? `${team} team` : '';
  const where = `${MODE_NAMES[game.mode]} on the ${MAPS[game.map]?.name ?? game.map}`;
  gameAbout.textContent = zirbel ? where : `${game.name} · ${where}`;
}

let lastPrompt = '';
// What you can do right where you look, under the crosshair: "E · Hook". Empty hides it.
/** @param {string} text */
export function prompt(text) {
  if (text === lastPrompt) return;
  lastPrompt = text;
  promptLine.textContent = text;
  promptLine.hidden = !text;
}

let noticeTimer = 0;
// A line under the top of the screen, for news that matters right now. An empty text clears it.
/** @param {string} text @param {number} [ms] */
export function notice(text, ms = 4000) {
  clearTimeout(noticeTimer);
  noticeLine.textContent = text;
  noticeLine.hidden = !text;
  if (text) noticeTimer = window.setTimeout(() => (noticeLine.hidden = true), ms);
}

/** Whether a current status notice needs priority over a first-use lesson. */
export function hasNotice() {
  return !noticeLine.hidden;
}

const update = $('update');
const updateText = $('update-text');
const updateButton = $('update-button');

let updateTimer = 0;
// The banner at the top: a new version is 'ready' (with its button), the game is 'busy' updating
// or reconnecting, or it's 'done'. null hides it.
/** @param {'ready' | 'busy' | 'done' | null} mode @param {string} [text] */
export function setUpdate(mode, text = '') {
  clearTimeout(updateTimer);
  update.hidden = mode === null;
  update.dataset['mode'] = mode ?? '';
  updateText.textContent = text;
  updateButton.hidden = mode !== 'ready';
  if (mode === 'done') updateTimer = window.setTimeout(() => setUpdate(null), 8000);
}

// Back in the game: the "updated" note has done its job.
export function clearUpdateNote() {
  if (update.dataset['mode'] === 'done') setUpdate(null);
}

const crosshairPreview = $('crosshair-preview');

// The crosshair's shape (cross, dot, circle, cross-dot or t) and colour, in the game and the menu.
/** @param {string} shape @param {string} color */
export function setCrosshairLook(shape, color) {
  for (const element of [crosshair, crosshairPreview]) {
    element.className = `crosshair ${shape}`;
    element.style.color = color;
  }
}

let lastCrosshair = 0;
// The crosshair opens up as your shots spread: its gap shows the cone they land in.
/** @param {number} size */
export function setCrosshair(size) {
  const rounded = Math.round(size);
  if (rounded === lastCrosshair) return;
  lastCrosshair = rounded;
  crosshair.style.width = crosshair.style.height = `${rounded}px`;
}

let lastLoadout = '';
// The weapon in your hands (name and ammo, bottom right) and the bar of all six, in the order of the
// number keys: the ones you carry lit, with their ammo. A special from a crate goes on 7, and your
// juggling balls on F.
/** @param {Pick<import('./arsenal.js').Arsenal, 'weapon' | 'owned' | 'ammo' | 'special'>} loadout */
export function setLoadout({ weapon, owned, ammo, special }) {
  const key = JSON.stringify([weapon, [...owned], ammo, special]);
  if (key === lastLoadout) return;
  lastLoadout = key;
  /** @param {string} name */
  const count = (name) => (Number.isFinite(WEAPONS[name]?.ammo) ? (ammo[name] ?? 0) : Infinity);
  const left = weapon === 'special' ? 1 : count(weapon);
  weaponName.textContent =
    weapon === 'special'
      ? ((special ? CRATE_ITEMS[special]?.name : undefined) ?? 'Special')
      : weapon === 'trick'
        ? 'Juggling'
        : weaponSpec(weapon).name;
  weaponAmmo.textContent = weapon === 'trick' ? 'click: throw' : left === Infinity ? '∞' : String(left);
  weaponAmmo.classList.toggle('empty', left <= 0);
  const extra = [];
  if (special) {
    const slot = document.createElement('li');
    slot.className = 'slot special';
    slot.classList.toggle('current', weapon === 'special');
    slot.append(
      Object.assign(document.createElement('kbd'), { textContent: 7 }),
      Object.assign(document.createElement('span'), {
        textContent: (special ? CRATE_ITEMS[special]?.name : undefined) ?? special,
      }),
    );
    extra.push(slot);
  }
  const trickSlot = document.createElement('li');
  trickSlot.className = 'slot trick';
  trickSlot.classList.toggle('current', weapon === 'trick');
  trickSlot.append(
    Object.assign(document.createElement('kbd'), { textContent: 'F' }),
    Object.assign(document.createElement('span'), { textContent: 'Juggling' }),
  );
  extra.push(trickSlot);
  slots.replaceChildren(
    ...ARSENAL.map((name) => {
      const has = owned.has(name);
      const shots = count(name);
      const slot = document.createElement('li');
      slot.className = 'slot';
      slot.classList.toggle('current', name === weapon);
      slot.classList.toggle('missing', !has);
      slot.classList.toggle('empty', has && shots <= 0);
      slot.append(
        Object.assign(document.createElement('kbd'), { textContent: weaponSpec(name).slot }),
        Object.assign(document.createElement('span'), { textContent: weaponSpec(name).short }),
      );
      if (has)
        slot.append(
          Object.assign(document.createElement('b'), { textContent: shots === Infinity ? '∞' : shots }),
        );
      return slot;
    }),
    ...extra,
  );
}

let lastPowerup = '';
// The powerup you're carrying and its seconds left, above your health. Null hides it.
/** @param {import('../../shared/runtime-types.ts').SelfMessage['powerup']} powerup */
export function setPowerup(powerup) {
  const key = powerup ? `${powerup.kind}:${Math.ceil(powerup.ms / 1000)}` : '';
  if (key === lastPowerup) return;
  lastPowerup = key;
  powerupChip.hidden = !powerup;
  if (!powerup) return;
  powerupChip.style.setProperty('--powerup', lookup(POWERUPS, powerup.kind).color);
  powerupName.textContent = lookup(POWERUPS, powerup.kind).name;
  powerupLeft.textContent = String(Math.ceil(powerup.ms / 1000));
}

let lastGuide = '';
// Steering a pilot missile, or a woolly on the run: a frame (for the pilot missile) and what
// clicking does.
/** @param {string | null} kind @param {string} [text] */
export function setGuide(kind, text = '') {
  const key = `${kind}:${text}`;
  if (key === lastGuide) return;
  lastGuide = key;
  guide.hidden = !kind;
  guide.className = `guide ${kind ?? ''}`;
  guideText.textContent = text;
}

// The railgun's charge, under the crosshair: 0 hides it.
/** @param {number} amount */
export function setCharge(amount) {
  chargeBar.hidden = amount <= 0;
  if (amount > 0) {
    chargeBar.style.setProperty('--charge', String(amount));
    chargeBar.classList.toggle('full', amount >= 1);
  }
}

let lastOverlay = '';
// A tint over everything: blue and murky under water. Empty clears it.
/** @param {string} kind */
export function setOverlay(kind) {
  if (kind === lastOverlay) return;
  lastOverlay = kind;
  overlay.className = `overlay ${kind}`;
}

/** @param {boolean} visible */
export function showMenu(visible) {
  menu.hidden = !visible;
}

export const isPlaying = () => !hud.hidden && menu.hidden;

let lastTip = '';
/** @param {import('./browser-context.d.ts').WeaponTip | null} tip */
export function weaponTip(tip) {
  if (!tip) {
    tipBox.hidden = true;
    return;
  }
  const key = JSON.stringify([tip.name, tip.primary, tip.secondary, tip.extra]);
  if (key !== lastTip) {
    lastTip = key;
    tipTitle.textContent = tip.name;
    tipPrimary.textContent = tip.primary;
    tipSecondary.textContent = tip.secondary;
    tipSecondary.hidden = !tip.secondary;
    tipExtra.textContent = tip.extra;
    tipExtra.hidden = !tip.extra;
  }
  tipBox.style.opacity = String(tip.opacity);
  tipBox.hidden = false;
}

/** @param {boolean} visible */
export function showHud(visible) {
  hud.hidden = !visible;
}

let lastStatus = '';
/** @param {string} text @param {boolean} [isError] */
export function setStatus(text, isError = false) {
  if (text === lastStatus) return;
  lastStatus = text;
  status.textContent = text;
  status.classList.toggle('error', isError);
}

let lastCount = -1;
/** @param {number} count */
export function setPlayerCount(count) {
  if (count === lastCount) return;
  lastCount = count;
  setStatus(`Connected · ${count} ${count === 1 ? 'player' : 'players'} in the game`);
}

/** @param {string[]} urls */
export function setLanUrls(urls) {
  lanShown = urls.length > 0;
  lan.hidden = !lanShown || !paused.hidden;
  lanUrls.replaceChildren(
    ...urls.map((url) => Object.assign(document.createElement('span'), { textContent: url })),
  );
}

/** @param {number} value */
export function setSensitivity(value) {
  sensitivityValue.textContent = value.toFixed(1);
}

let lastHealth = '';
// Health and armor, bottom left. Both go above 100 (a Health Orb, plenty of armor) and tick back down.
/** @param {number} hp @param {number} [armorLeft] */
export function setHealth(hp, armorLeft = 0) {
  const key = `${hp}:${armorLeft}`;
  if (key === lastHealth) return;
  lastHealth = key;
  health.textContent = String(hp);
  health.parentElement?.classList.toggle('low', hp <= 25);
  health.parentElement?.classList.toggle('over', hp > 100);
  armor.textContent = String(armorLeft);
  armorLine.classList.toggle('none', armorLeft <= 0);
}

// The round trip to the host, in the corner, if the game shows it (data/hud.json: ping).
/** @param {number} ms */
export function setPing(ms) {
  ping.hidden = !DATA.hud.ping;
  ping.textContent = `${Math.round(ms)} ms`;
}

/** @param {boolean} head */
export function hitMarker(head) {
  hitmarker.classList.toggle('head', head);
  replay(hitmarker);
}

export function damageFlash() {
  replay(damage);
}

/** @param {HTMLElement} element */
function replay(element) {
  element.classList.remove('show');
  void element.offsetWidth; // restarts the CSS animation
  element.classList.add('show');
}

/** @param {string} title */
export function showDeath(title) {
  deathTitle.textContent = title;
  deathNote.textContent = '';
  death.hidden = false;
}

// Under the death title: what your killer had left.
/** @param {string} text */
export function setDeathNote(text) {
  deathNote.textContent = text;
}

let lastTimer = '';
/** @param {number} msLeft */
export function updateDeath(msLeft) {
  const text = msLeft > 0 ? `Respawning in ${(msLeft / 1000).toFixed(1)} s` : 'Respawning…';
  if (text === lastTimer) return;
  lastTimer = text;
  deathTimer.textContent = text;
}

export function hideDeath() {
  death.hidden = true;
}

// low: down at the bottom of the screen, between rounds, so the winner stays in view.
/** @param {boolean} visible @param {boolean} [low] */
export function showScores(visible, low = false) {
  scoreboard.hidden = !visible;
  scoreboard.classList.toggle('low', visible && low);
}

let lastScores = '';
// The scoreboard: teams together in capture the flag, the leader crowned.
/** @param {import('./browser-context.d.ts').ScorePlayer[]} players @param {number | null} selfId @param {{mode: string, captures: Record<import('../../shared/runtime-types.ts').Team, number>, leaderId: number | null}} match */
export function updateScores(players, selfId, { mode, captures, leaderId }) {
  /** @param {import('./browser-context.d.ts').ScorePlayer} player */
  const team = (player) => ['red', 'blue'].indexOf(player.team ?? '');
  const sorted = [...players].sort(
    (a, b) => team(a) - team(b) || b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name),
  );
  const key = JSON.stringify([
    selfId,
    mode,
    captures,
    leaderId,
    ...sorted.map((p) => [p.id, p.name, p.color, p.team, p.kills, p.deaths]),
  ]);
  if (key === lastScores) return;
  lastScores = key;
  scoreboardTitle.textContent =
    mode === 'ctf'
      ? `${teamName('red')} ${captures.red} · ${captures.blue} ${teamName('blue')}`
      : `Deathmatch · first to ${DM_KILLS}`;
  scores.replaceChildren(
    ...sorted.map((player) => {
      const row = document.createElement('tr');
      row.classList.toggle('me', player.id === selfId);
      const name = document.createElement('td');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = player.team ? lookup(TEAM_COLORS, player.team) : player.color;
      name.append(swatch, player.name, player.id === leaderId ? ' 👑' : '');
      row.append(name, cell(player.kills), cell(player.deaths));
      return row;
    }),
  );
}

/** @param {number} value */
function cell(value) {
  return Object.assign(document.createElement('td'), { textContent: value });
}
