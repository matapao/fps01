/** Decode host messages before typed presentation handlers see them. */
import { parseMessage } from './messages.js';
import { isGameData } from './check.js';
import { finite, isRecord, isTeam, isVector, isSnapshot, isPlayerSnapshot } from './snapshot-parts.js';

/** @typedef {(value: unknown) => boolean} Check */
/** @type {Check} */
const text = (value) => typeof value === 'string';
/** @type {Check} */
const bool = (value) => typeof value === 'boolean';
/** @param {Check} check @returns {Check} */
const nullable = (check) => (value) => value === null || check(value);
/** @param {Check} check @returns {Check} */
const list = (check) => (value) => Array.isArray(value) && value.length <= 500_000 && value.every(check);
/** @param {number} size @returns {Check} */
const numbers = (size) => (value) => Array.isArray(value) && value.length === size && value.every(finite);
/** @type {Check} */
const mode = (value) => value === 'dm' || value === 'ctf';
/** @type {Check} */
const captures = (value) => isRecord(value) && finite(value['red']) && finite(value['blue']);
/** @param {unknown} value @returns {value is import('./voxels.js').HistoryEntry} */
function history(value) {
  if (!Array.isArray(value)) return false;
  if (value.length === 4 && value.every(finite)) return true;
  const [kind, ...cells] = value;
  return (
    ((kind === 'b' && cells.length === 7) ||
      (kind === 'x' && cells.length % 3 === 0) ||
      (kind === 'd' && cells.length % 4 === 0)) &&
    cells.every(finite)
  );
}
/** @type {Check} */
const game = (value) =>
  isRecord(value) &&
  text(value['code']) &&
  text(value['name']) &&
  text(value['map']) &&
  mode(value['mode']) &&
  list(text)(value['players']);
/** @type {Check} */
const winner = (value) =>
  value === null ||
  (isRecord(value) &&
    (value['id'] === undefined || finite(value['id'])) &&
    (value['name'] === undefined || text(value['name'])) &&
    (value['team'] === undefined || isTeam(value['team'])));
/** @type {Check} */
const topple = (value) =>
  value === null ||
  (isRecord(value) &&
    (value['axis'] === 'x' || value['axis'] === 'z') &&
    finite(value['sign']) &&
    isVector(value['pivot']));
/** @type {Check} */
const projectile = (value) =>
  Array.isArray(value) &&
  value.length === 5 &&
  finite(value[0]) &&
  nullable(text)(value[1]) &&
  value.slice(2).every(finite);
/** @type {Check} */
const ammo = (value) =>
  isRecord(value) && Object.values(value).every((count) => count === null || finite(count));
/** @type {Check} */
const powerup = (value) => value === null || (isRecord(value) && text(value['kind']) && finite(value['ms']));

/** @type {Record<string, Record<string, Check>>} */
const required = {
  hello: { addresses: list(text) },
  world: { history: list(history) },
  update: { ready: bool },
  updating: {},
  welcome: { id: finite },
  games: { games: list(game) },
  joined: { code: text, name: text, map: text, mode },
  nogame: { code: nullable(text) },
  full: {},
  snapshot: { players: list(isPlayerSnapshot), projectiles: list(projectile) },
  self: { weapons: list(text), ammo, special: nullable(text), powerup },
  round: { state: text, mode },
  flag: { team: isTeam, event: text },
  spawn: { id: finite, feet: isVector, yaw: finite },
  shot: { id: finite, weapon: text, from: isVector, to: isVector },
  chip: { cell: isVector, wear: finite, broke: bool },
  launch: { id: finite, kind: text, from: isVector, velocity: isVector },
  pressure: { id: finite, from: isVector, at: isVector },
  boom: { at: isVector },
  arc: { id: finite, points: list(isVector) },
  rubble: { pieces: list(numbers(5)) },
  fall: { id: finite, entry: history, cells: list(finite), drop: finite, topple, ms: finite },
  landed: { id: finite, entry: history, at: nullable(isVector), size: finite },
  crack: { at: isVector },
  planet: { planet: finite, by: finite, strikes: list(numbers(4)) },
  build: { entry: history },
  push: { velocity: isVector },
  kick: { id: finite },
  item: { spot: finite, event: text },
  medal: { id: finite },
  powerup: { event: text, kind: text },
  crate: { event: text },
  special: { kind: text, id: finite },
  teleport: { id: finite, from: isVector, to: isVector },
  guiding: { kind: nullable(text) },
  moved: { feet: isVector },
  killcam: { killer: finite, hp: finite, armor: finite },
  hit: { from: nullable(finite), to: finite, hp: finite, weapon: text },
  kill: { killer: nullable(finite), victim: finite, weapon: text },
  data: { hash: text, blocks: isGameData },
  pong: { t: finite },
};
/** @type {Record<string, Record<string, Check>>} */
const optional = {
  hello: { version: nullable(text), update: bool, games: list(game), data: text, back: bool, wire: finite },
  world: { mode, map: text, water: nullable(finite), planets: list(finite) },
  updating: { by: nullable(text) },
  full: { scope: text },
  round: { winner, ms: finite },
  flag: { by: nullable(finite), captures },
  launch: { shot: finite },
  boom: { kind: text, hole: finite, radius: finite, push: finite, on: nullable(finite) },
  rubble: { ms: finite },
  fall: { topple },
  item: { by: finite },
  powerup: { by: finite },
  crate: { item: text, by: finite, at: isVector },
  medal: { medal: text },
  guiding: { id: finite },
  hit: { armor: finite, head: bool },
};

/** @param {unknown} data @returns {import('./server-messages.d.ts').ServerMessage | null} */
export function readServerMessage(data) {
  const value = parseMessage(data);
  if (!value || !Object.hasOwn(required, value.type)) return null;
  const fields = required[value.type];
  if (!fields || !Object.entries(fields).every(([key, check]) => check(value[key]))) return null;
  if (
    !Object.entries(optional[value.type] ?? {}).every(
      ([key, check]) => value[key] === undefined || check(value[key]),
    )
  )
    return null;
  if (
    value.type === 'round' &&
    ((value['state'] !== 'start' && value['state'] !== 'sudden' && value['state'] !== 'over') ||
      (value['state'] === 'over' && (!finite(value['ms']) || !winner(value['winner']))))
  )
    return null;
  if (
    value.type === 'crate' &&
    ((value['event'] !== 'dropping' && value['event'] !== 'taken') ||
      (value['event'] === 'dropping' && !isVector(value['at'])) ||
      (value['event'] === 'taken' && (!text(value['item']) || !finite(value['by']))))
  )
    return null;
  if (value.type === 'snapshot' && !isSnapshot(value)) return null;
  // Each discriminant and all consumed fields were checked above; additional fields remain ignored.
  return /** @type {import('./server-messages.d.ts').ServerMessage} */ (value);
}

/** @template {keyof import('./server-messages.d.ts').ServerMessages} K
 * @param {import('./server-messages.d.ts').ServerHandlers} handlers
 * @param {K} type @param {import('./server-messages.d.ts').ServerMessages[K]} message */
function invoke(handlers, type, message) {
  handlers[type](message);
}
/** @param {import('./server-messages.d.ts').ServerHandlers} handlers @param {unknown} data */
export function dispatchServerMessage(handlers, data) {
  const message = readServerMessage(data);
  if (message) invoke(handlers, message.type, message);
}
