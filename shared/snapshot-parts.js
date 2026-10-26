/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** @param {unknown} value @returns {value is import('./contracts.ts').Vector3} */
function isVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(finite);
}
/** @param {unknown} value @returns {value is number} */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
/** @param {unknown} value @returns {value is import('./runtime-types.ts').Team} */
function isTeam(value) {
  return value === 'red' || value === 'blue';
}
/** @param {unknown} value @returns {value is string | null} */
function nullableString(value) {
  return value === null || typeof value === 'string';
}
/** @param {unknown} value @returns {value is import('./runtime-types.ts').RoundSnapshot} */
function isRound(value) {
  if (
    !isRecord(value) ||
    (value['mode'] !== 'dm' && value['mode'] !== 'ctf') ||
    typeof value['map'] !== 'string' ||
    typeof value['over'] !== 'boolean' ||
    !finite(value['ms']) ||
    typeof value['sudden'] !== 'boolean'
  )
    return false;
  const captures = value['captures'];
  if (!isRecord(captures) || !finite(captures['red']) || !finite(captures['blue'])) return false;
  const flags = value['flags'];
  return (
    flags === void 0 ||
    (isRecord(flags) &&
      Object.entries(flags).every(
        ([team, flag]) =>
          isTeam(team) &&
          isRecord(flag) &&
          (flag['state'] === 'home' || flag['state'] === 'carried' || flag['state'] === 'dropped') &&
          (flag['at'] === null || isVector(flag['at'])),
      ))
  );
}
/** @param {unknown} value @returns {value is NonNullable<import('./runtime-types.ts').Snapshot['powerups']>} */
function isPowerups(value) {
  if (!isRecord(value) || !nullableString(value['pedestal'])) return false;
  const soon = value['soon'];
  if (soon !== null && (!isRecord(soon) || !nullableString(soon['kind']) || !finite(soon['ms'])))
    return false;
  return (
    Array.isArray(value['loose']) &&
    value['loose'].every(
      (item) =>
        Array.isArray(item) &&
        item.length === 5 &&
        finite(item[0]) &&
        nullableString(item[1]) &&
        item.slice(2).every(finite),
    )
  );
}
/** @param {unknown} value @returns {value is NonNullable<import('./runtime-types.ts').Snapshot['crates']>} */
function isCrates(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        Array.isArray(item) &&
        item.length === 6 &&
        finite(item[0]) &&
        (item[1] === 'health' || item[1] === 'special') &&
        item.slice(2).every(finite),
    )
  );
}
/** @param {unknown} value @returns {value is NonNullable<import('./runtime-types.ts').Snapshot['woollies']>} */
function isWoollies(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => Array.isArray(item) && item.length === 6 && item.every(finite))
  );
}
/** @param {import('./runtime-types.ts').Snapshot} snapshot @param {string} key @param {unknown} value */
function applySnapshotPart(snapshot, key, value) {
  switch (key) {
    case 'round':
      if (isRound(value)) {
        snapshot.round = value;
        return;
      }
      break;
    case 'items':
      if (Array.isArray(value) && value.every(finite)) {
        snapshot.items = value;
        return;
      }
      break;
    case 'water':
      if (finite(value)) {
        snapshot.water = value;
        return;
      }
      break;
    case 'powerups':
      if (isPowerups(value)) {
        snapshot.powerups = value;
        return;
      }
      break;
    case 'crates':
      if (isCrates(value)) {
        snapshot.crates = value;
        return;
      }
      break;
    case 'woollies':
      if (isWoollies(value)) {
        snapshot.woollies = value;
        return;
      }
      break;
    default:
      throw new TypeError(`Unknown snapshot part ${key}`);
  }
  throw new TypeError(`Invalid snapshot part ${key}`);
}
export { applySnapshotPart, finite, isRecord, isRound, isTeam, isVector };

/** @param {unknown} value @returns {value is import('./runtime-types.ts').PlayerSnapshot} */
export function isPlayerSnapshot(value) {
  if (
    !isRecord(value) ||
    !finite(value['id']) ||
    (value['seat'] !== undefined && !finite(value['seat'])) ||
    typeof value['name'] !== 'string' ||
    typeof value['color'] !== 'string' ||
    !isVector(value['feet'])
  )
    return false;
  for (const key of ['yaw', 'pitch', 'hp', 'armor', 'kills', 'deaths']) if (!finite(value[key])) return false;
  for (const key of ['alive', 'shielded', 'cloaked']) if (typeof value[key] !== 'boolean') return false;
  if (
    !nullableString(value['held']) ||
    !nullableString(value['powerup']) ||
    (value['hook'] !== null && !isVector(value['hook']))
  )
    return false;
  return (
    (value['team'] === null || isTeam(value['team'])) &&
    (value['carrying'] === null || isTeam(value['carrying']))
  );
}

/** @param {unknown} value @returns {value is import('./runtime-types.ts').Snapshot} */
export function isSnapshot(value) {
  if (
    !isRecord(value) ||
    value['type'] !== 'snapshot' ||
    !Array.isArray(value['players']) ||
    !value['players'].every(isPlayerSnapshot) ||
    !Array.isArray(value['projectiles'])
  )
    return false;
  if (
    !value['projectiles'].every(
      (shot) =>
        Array.isArray(shot) &&
        shot.length === 5 &&
        finite(shot[0]) &&
        nullableString(shot[1]) &&
        shot.slice(2).every(finite),
    )
  )
    return false;
  for (const key of ['round', 'items', 'water', 'powerups', 'crates', 'woollies']) {
    const part = value[key];
    if (part === undefined) continue;
    if (key === 'round' && !isRound(part)) return false;
    if (key === 'items' && (!Array.isArray(part) || !part.every(finite))) return false;
    if (key === 'water' && !finite(part)) return false;
    if (key === 'powerups' && !isPowerups(part)) return false;
    if (key === 'crates' && !isCrates(part)) return false;
    if (key === 'woollies' && !isWoollies(part)) return false;
  }
  return true;
}
