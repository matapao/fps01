/**
 * What a revision's data must be for the game to play by it, beyond what a schema can say: every rule
 * a data change can break, so the Compose lane refuses a change at once, with the reason.
 *
 * - What the engine checks whenever it loads data (shared/check.js): the schemas, ids that are there
 *   once and named only where they exist, what the engine needs (its materials, pickups that say
 *   what they give, weapons that say how they fire), layouts that lay.
 * - Every layout, built as the engine builds it (shared/layout.js, shared/arena.js) and looked over:
 *   every box on the half-metre grid, inside the arena and between the floor slab and the top of the
 *   arena; nothing floating, unconnected to the floor; spawns, pickups, flags and the pedestal in the
 *   open with floor under them and inside the arena; no spawn on a jump pad; every jump pad throws
 *   you clear through the air onto somewhere you can land; in capture the flag, each team's flag on
 *   its own half, with spawns well into it. Without a grappling hook in the movement, every pickup
 *   must be reachable on foot (walking, stepping up, jumping onto a metre, dropping down, and the
 *   jump pads) from the spawns.
 *
 * counts are for the manifest's budgets.
 *
 *   check(data) → { problems: [{ block, path, message }], counts }   // data: block id → its JSON
 *
 * Pure (no DOM, no fetch, no timers), and quick: about 30 ms a layout.
 */
import { ARENA_HALF, CELL, GRID_MIN, GRID_SIZE, TOP, buildArena, cellAt } from '../../shared/arena.js';
import { checkData, isGameData } from '../../shared/check.js';
import { expand } from '../../shared/layout.js';

type Vec = [number, number, number];
export interface Problem {
  block: string;
  path: string;
  message: string;
}
type Box = import('../../shared/layout-types.ts').LayoutBox;
type Expanded = import('../../shared/layout-types.ts').ExpandedLayout;
type Layout = import('../../shared/contracts.ts').Layouts['layouts'][number];
type Blocks = import('../../shared/contracts.ts').GameData;
type Spot =
  NonNullable<Layout['pads']>[number] | NonNullable<Layout['pickups']>[number] | Layout['spawns'][number];

const RADIUS = 0.4; // a player's half-width, and…
const HEIGHT = 1.8; // …height, as the engine has them
const CLEARANCE = 4; // cells of air someone needs to stand in (2 m)
const STEP = 2; // cells you can jump up onto (1 m)
const TEAM_HALF = 14; // in capture the flag, a team spawns this far (or farther) into its own half…
const TEAM_SPAWNS = 5; // …at one of at least this many spawns
const SIDES: Record<string, [number, string]> = { red: [-1, 'west'], blue: [1, 'east'] }; // the sign of x on each team's half
const [NX, NY, NZ] = GRID_SIZE;
const LAYER = NX * NZ;
const round = (v: Vec | number[]) => `[${v.map((n) => Math.round(n * 100) / 100).join(', ')}]`;
const onGrid = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-6;

export default function check(data: Record<string, unknown>): {
  problems: Problem[];
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = { boxes: 0, pieces: 0, cells: 0, triangles: 0 };
  // What the engine refuses when it loads data: until that's right, nothing else can be looked at.
  const problems = checkData(data);
  if (problems.length || !isGameData(data)) return { problems, counts };
  const blocks = data;
  // A layout's look-over depends on it and on what it's built of: unchanged, it isn't done again.
  const built = JSON.stringify([blocks.materials, blocks.pieces, blocks.prefabs, blocks.movement]);
  let context: Context | null = null;
  blocks.layouts.layouts.forEach((layout, i) => {
    const key = `${JSON.stringify(layout)}\n${built}`;
    let seen = LOOKED.get(key);
    if (!seen) {
      context ??= contextOf(blocks);
      seen = lookOver(layout, context);
      LOOKED.set(key, seen);
      if (LOOKED.size > MOST_LOOKED) LOOKED.delete(LOOKED.keys().next().value!);
    }
    for (const { path, message } of seen.problems)
      problems.push({ block: 'layouts', path: `/layouts/${i}${path}`, message });
    for (const name of Object.keys(counts)) counts[name] = Math.max(counts[name]!, seen.counts[name]!);
  });
  return { problems, counts };
}

// What each layout's look-over found (its problems' paths from the layout), by the layout and the
// blocks it's built of, for the next check: a proposal that leaves a layout alone isn't held up by it.
interface Seen {
  problems: { path: string; message: string }[];
  counts: Record<string, number>;
}
const LOOKED = new Map<string, Seen>();
const MOST_LOOKED = 24;

// What looking over a layout needs: where each material is in the list, the pieces and prefabs to
// lay, and the rules of movement.
interface Context {
  place: Map<string, number>;
  pieces: Map<string, Blocks['pieces']['pieces'][number]>;
  lib: import('../../shared/layout-types.ts').LayoutLibrary;
  hook: boolean;
  gravity: number;
}
function contextOf(blocks: Blocks): Context {
  const pieces = new Map(blocks.pieces.pieces.map((p) => [p.id, p]));
  return {
    place: new Map(blocks.materials.materials.map((m, i) => [m.id, i + 1])),
    pieces,
    lib: { pieces, prefabs: new Map(blocks.prefabs.prefabs.map((p) => [p.id, p])) },
    hook: Boolean(blocks.movement.hook),
    gravity: blocks.movement.gravity,
  };
}

// One layout, built as the engine builds it, and looked over.
function lookOver(layout: Layout, { place, pieces, lib, hook, gravity }: Context): Seen {
  const problems: Seen['problems'] = [];
  const fail = (path: string, message: string) =>
    problems.push({ path, message: `${layout.id}: ${message}` });
  let map: Expanded;
  try {
    map = expand(layout, lib, () => [0, 0, 0]);
  } catch (error) {
    fail('/parts', error instanceof Error ? error.message : String(error));
    return { problems, counts: { boxes: 0, pieces: 0, cells: 0, triangles: 0 } };
  }
  // Every box each part comes to, on the grid and inside the arena: a part at a time, so a problem
  // names the part it comes from.
  (layout.parts ?? []).forEach((part, k) => {
    let boxes: Box[];
    try {
      boxes = expand({ ...layout, parts: [part], spawns: [], pickups: [], pads: [], zones: {} }, lib, () => [
        0, 0, 0,
      ]).boxes;
    } catch {
      return; // the whole layout's expansion said why
    }
    const wrong = boxes.map((box) => [box, misplaced(box)] as const).filter(([, why]) => why);
    if (!wrong.length) return;
    const [box, why] = wrong[0]!;
    fail(
      `/parts/${k}`,
      `${why}: ${round(box.min)} … ${round(box.max)}${wrong.length > 1 ? ` (and ${wrong.length - 1} more of its boxes)` : ''}`,
    );
  });
  const cells = buildArena(
    {
      ...map,
      floor: place.get(map.floor) ?? 0,
      roof: { ...map.roof, m: place.get(map.roof.m) ?? 0 },
      boxes: map.boxes.map((b) => ({ ...b, m: b.m === 'air' ? 0 : (place.get(b.m) ?? 0) })),
    },
    map.flags && Object.keys(map.flags).length ? 'ctf' : 'dm',
    (id: string) => place.get(id) ?? 0,
  );
  const get = (ix: number, iy: number, iz: number) =>
    ix < 0 || iy < 0 || iz < 0 || ix >= NX || iy >= NY || iz >= NZ ? 0 : cells[ix + NX * (iz + NZ * iy)]!;
  const solid = (x: number, y: number, z: number) => get(cellAt(x, 0), cellAt(y, 1), cellAt(z, 2)) !== 0;
  // Room for someone standing at feet (radius: how wide they are, round their middle).
  const blocked = (feet: Vec, radius = RADIUS) => {
    for (let iy = cellAt(feet[1] + 0.01, 1); iy <= cellAt(feet[1] + HEIGHT - 0.01, 1); iy++) {
      for (let iz = cellAt(feet[2] - radius, 2); iz <= cellAt(feet[2] + radius - 0.001, 2); iz++) {
        for (let ix = cellAt(feet[0] - radius, 0); ix <= cellAt(feet[0] + radius - 0.001, 0); ix++)
          if (get(ix, iy, iz)) return true;
      }
    }
    return false;
  };
  const floored = (feet: Vec) =>
    [
      [0, 0],
      [-0.3, -0.3],
      [0.3, -0.3],
      [-0.3, 0.3],
      [0.3, 0.3],
    ].every(([dx, dz]) => solid(feet[0] + dx!, feet[1] - CELL / 2, feet[2] + dz!));
  const outside = (at: Vec) => Math.abs(at[0]) > ARENA_HALF || Math.abs(at[2]) > ARENA_HALF;
  const onPad = (feet: Vec) =>
    map.pads.some(
      ({ at }) =>
        Math.abs(feet[0] - at[0]) < 1.4 && Math.abs(feet[2] - at[2]) < 1.4 && Math.abs(feet[1] - at[1]) < 0.5,
    );
  // Each list's entries, expanded one at a time, so a problem names the entry it comes from.
  function each(
    list: Layout['spawns'] | undefined,
    key: 'spawns',
    fn: (copy: { at: Vec }, path: string) => void,
  ): void;
  function each(
    list: Layout['pickups'],
    key: 'pickups',
    fn: (copy: Expanded['items'][number], path: string) => void,
  ): void;
  function each(
    list: Layout['pads'],
    key: 'pads',
    fn: (copy: Expanded['pads'][number], path: string) => void,
  ): void;
  function each(
    list: Spot[] | undefined,
    key: 'spawns' | 'pickups' | 'pads',
    fn:
      | ((copy: { at: Vec }, path: string) => void)
      | ((copy: Expanded['items'][number], path: string) => void)
      | ((copy: Expanded['pads'][number], path: string) => void),
  ): void {
    (list ?? []).forEach((spot, k) => {
      // Spread the already checked spot into only the matching authored list. Each branch preserves its contract.
      const blank = { ...layout, parts: [], spawns: [], pickups: [], pads: [] };
      let one: Expanded;
      if (key === 'pads') {
        if (!('to' in spot) || !('at' in spot)) throw new Error('Jump pad requires a destination');
        one = expand({ ...blank, pads: [spot] }, lib, () => [0, 0, 0]);
        for (const copy of one.pads) fn(copy, `/${key}/${k}`);
      } else if (key === 'pickups') {
        if (!('piece' in spot) || typeof spot.piece !== 'string') throw new Error('Pickup requires a piece');
        one = expand({ ...blank, pickups: [{ ...spot, piece: spot.piece }] }, lib, () => [0, 0, 0]);
        for (const copy of one.items) {
          // A pickup callback never requires a pad destination; the overload fixes which callback reaches this branch.
          (fn as (copy: Expanded['items'][number], path: string) => void)(copy, `/${key}/${k}`);
        }
      } else {
        one = expand({ ...blank, spawns: [spot] }, lib, () => [0, 0, 0]);
        for (const at of one.spawns)
          (fn as (copy: { at: Vec }, path: string) => void)({ at }, `/${key}/${k}`);
      }
    });
  }
  each(layout.spawns, 'spawns', ({ at }, path) => {
    if (outside(at)) fail(path, `the spawn at ${round(at)} is outside the arena`);
    else if (blocked(at)) fail(path, `the spawn at ${round(at)} is inside something`);
    else if (!floored(at)) fail(path, `the spawn at ${round(at)} has no floor under the whole of it`);
    else if (onPad(at)) fail(path, `the spawn at ${round(at)} is on a jump pad`);
  });
  each(layout.pickups, 'pickups', ({ at }, path) => {
    if (outside(at)) fail(path, `the pickup at ${round(at)} is outside the arena`);
    else if (blocked(at)) fail(path, `the pickup at ${round(at)} has no room to stand at it`);
    else if (!solid(at[0], at[1] - CELL / 2, at[2]))
      fail(path, `the pickup at ${round(at)} isn't on solid ground`);
  });
  each(layout.pads, 'pads', ({ piece, at, to, clear }, path) => {
    if (outside(at)) fail(path, `the jump pad at ${round(at)} is outside the arena`);
    else if (blocked(at)) fail(path, `the jump pad at ${round(at)} has something on it`);
    else if (!onGrid(at[0] + 1) || !onGrid(at[1]) || !onGrid(at[2] + 1))
      fail(path, `the jump pad at ${round(at)} is off the half-metre grid`);
    if (to && (blocked(to) || !floored(to))) {
      fail(path, `the jump pad at ${round(at)} throws you to ${round(to)}, where you can't land`);
      return;
    }
    // The throw, as the engine works it out (shared/map.js): up to clear above the higher end, and
    // down onto to. Nothing may be in the way of someone flying it.
    const rise = to[1] - at[1];
    const peak =
      Math.max(rise, 0) +
      (clear ?? pieces.get(piece)?.components?.find((c) => c.type === 'jumpPad')?.clear ?? 1.5);
    const up = Math.sqrt(2 * gravity * peak);
    const time = up / gravity + Math.sqrt((2 * (peak - rise)) / gravity);
    for (let t = 0.04; t < time - 0.04; t += 1 / 120) {
      const feet: Vec = [
        at[0] + ((to[0] - at[0]) * t) / time,
        at[1] + up * t - (gravity * t * t) / 2,
        at[2] + ((to[2] - at[2]) * t) / time,
      ];
      if (!blocked(feet, RADIUS - 0.05)) continue;
      fail(
        path,
        `the jump pad at ${round(at)} throws you into something at ${round(feet)}, on the way to ${round(to)}`,
      );
      break;
    }
  });
  for (const [team, at] of Object.entries(layout.zones?.flags ?? {})) {
    if (blocked(at) || !floored(at))
      fail(`/zones/flags/${team}`, `the ${team} flag at ${round(at)} has no room or no floor`);
    const [side, name] = SIDES[team] ?? [0, ''];
    if (side && Math.sign(at[0]) !== side)
      fail(
        `/zones/flags/${team}`,
        `the ${team} flag at ${round(at)} must be on its team's half: the ${name} (x ${side < 0 ? '< 0' : '> 0'})`,
      );
  }
  if (layout.zones?.flags) {
    for (const [team, [side, name]] of Object.entries(SIDES)) {
      const own = map.spawns.filter(([x]) => Math.sign(x) === side && Math.abs(x) >= TEAM_HALF).length;
      if (own < TEAM_SPAWNS)
        fail(
          '/spawns',
          `capture the flag needs at least ${TEAM_SPAWNS} spawns well into each team's half (${TEAM_HALF} m or more from the middle): the ${team} team's, in the ${name}, has ${own}`,
        );
    }
  }
  if (layout.zones?.pedestal && (blocked(layout.zones.pedestal) || !floored(layout.zones.pedestal)))
    fail('/zones/pedestal', `the pedestal at ${round(layout.zones.pedestal)} has no room or no floor`);
  if (!hook) {
    const reached = reach(get, map);
    each(layout.pickups, 'pickups', ({ at }, path) => {
      const [ix, iy, iz] = [cellAt(at[0], 0), cellAt(at[1] + 0.01, 1), cellAt(at[2], 2)];
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++)
        for (let dx = -1; dx <= 1 && !near; dx++) near = reached.has(ix + dx + NX * (iz + dz + NZ * iy));
      if (!near) fail(path, `the pickup at ${round(at)} can't be reached on foot from the spawns`);
    });
  }
  // What a screen draws for it: the faces of solid cells open to the air, two triangles each.
  let faces = 0;
  let solids = 0;
  for (let iy = 0, i = 0; iy < NY; iy++) {
    for (let iz = 0; iz < NZ; iz++) {
      for (let ix = 0; ix < NX; ix++, i++) {
        if (!cells[i]) continue;
        solids++;
        if (ix + 1 >= NX || !cells[i + 1]) faces++;
        if (ix === 0 || !cells[i - 1]) faces++;
        if (iz + 1 >= NZ || !cells[i + NX]) faces++;
        if (iz === 0 || !cells[i - NX]) faces++;
        if (iy + 1 >= NY || !cells[i + LAYER]) faces++;
        if (iy === 0 || !cells[i - LAYER]) faces++;
      }
    }
  }
  // Nothing floats: every solid cell is joined, face to face, to the bottom layer (the floor, the
  // pillars' feet).
  const adrift = floating(cells, solids);
  if (adrift.count)
    fail(
      '/parts',
      `${adrift.count} cells float, held up by nothing (round ${round(adrift.at)}): everything must stand on the floor, or on something that does`,
    );
  const counts = {
    boxes: map.boxes.length,
    pieces: map.items.length + map.pads.length + map.spawns.length,
    cells: solids,
    triangles: faces * 2,
  };
  return { problems, counts };
}

// Why a box can't be laid as it is, or null: its corners must be on the half-metre grid (the cells
// are half a metre: a box between grid lines fills cells it only half covers, or misses them), and it
// must be inside the arena, from the floor's slab up to the top of the arena.
function misplaced({ min, max }: Box): string | null {
  if (![...min, ...max].every(onGrid))
    return 'a box off the half-metre grid (every corner must be a multiple of 0.5)';
  if (min.some((v, a) => v >= max[a]!)) return 'an empty box';
  if (Math.min(min[0], min[2]) < -ARENA_HALF || Math.max(max[0], max[2]) > ARENA_HALF)
    return `a box outside the arena (-${ARENA_HALF} to ${ARENA_HALF} on x and z)`;
  if (min[1] < -CELL) return `a box below the floor's slab (y ${-CELL})`;
  if (max[1] > TOP) return `a box above the top of the arena (y ${TOP})`;
  return null;
}

// Scratch space for the searches below, made once: a mark per cell, and a list of cells to go on from.
const SEEN = new Uint8Array(LAYER * NY);
const QUEUE = new Int32Array(LAYER * NY);

// The solid cells (of solids) not joined, face to face, to the bottom layer: how many, and where one
// of them is.
function floating(cells: Uint8Array, solids: number): { count: number; at: Vec } {
  const seen = SEEN.fill(0);
  const stack = QUEUE;
  const size = cells.length;
  let top = 0;
  let reached = 0;
  for (let i = 0; i < LAYER; i++) {
    if (!cells[i]) continue;
    seen[i] = 1;
    stack[top++] = i;
  }
  while (top > 0) {
    const i = stack[--top]!;
    reached++;
    const ix = i % NX;
    const iz = ((i - ix) / NX) % NZ;
    let j = i + 1;
    if (ix + 1 < NX && cells[j] && !seen[j]) ((seen[j] = 1), (stack[top++] = j));
    j = i - 1;
    if (ix > 0 && cells[j] && !seen[j]) ((seen[j] = 1), (stack[top++] = j));
    j = i + NX;
    if (iz + 1 < NZ && cells[j] && !seen[j]) ((seen[j] = 1), (stack[top++] = j));
    j = i - NX;
    if (iz > 0 && cells[j] && !seen[j]) ((seen[j] = 1), (stack[top++] = j));
    j = i + LAYER;
    if (j < size && cells[j] && !seen[j]) ((seen[j] = 1), (stack[top++] = j));
    j = i - LAYER;
    if (j >= 0 && cells[j] && !seen[j]) ((seen[j] = 1), (stack[top++] = j));
  }
  const count = solids - reached;
  if (!count) return { count, at: [0, 0, 0] };
  let first = LAYER;
  while (!cells[first] || seen[first]) first++;
  const at: Vec = [
    GRID_MIN[0] + ((first % NX) + 0.5) * CELL,
    GRID_MIN[1] + (Math.floor(first / LAYER) + 0.5) * CELL,
    GRID_MIN[2] + ((Math.floor(first / NX) % NZ) + 0.5) * CELL,
  ];
  return { count, at };
}

// Every cell someone can stand in, reached on foot from the spawns: walking, stepping or jumping up
// to a metre, dropping down any height, and thrown by the jump pads: has(cell index), until the next
// search.
function reach(
  get: (ix: number, iy: number, iz: number) => number,
  map: Expanded,
): { has(k: number): boolean } {
  const standable = (ix: number, iy: number, iz: number) => {
    if (!get(ix, iy - 1, iz)) return false;
    for (let k = 0; k < CLEARANCE; k++) if (get(ix, iy + k, iz)) return false;
    return true;
  };
  const landing = (ix: number, iy: number, iz: number) => {
    for (; iy > 0; iy--) if (get(ix, iy - 1, iz)) return standable(ix, iy, iz) ? iy : -1;
    return -1;
  };
  const seen = SEEN.fill(0);
  const queue = QUEUE; // cell indices
  let tail = 0;
  const visit = (ix: number, iy: number, iz: number) => {
    const k = ix + NX * (iz + NZ * iy);
    if (iy < 0 || seen[k]) return;
    seen[k] = 1;
    queue[tail++] = k;
  };
  const stand = ([x, y, z]: Vec) => {
    const ix = cellAt(x, 0);
    const iz = cellAt(z, 2);
    const iy = landing(ix, Math.min(NY - 1, cellAt(y + 0.01, 1)), iz);
    if (iy >= 0) visit(ix, iy, iz);
  };
  for (const at of map.spawns) stand(at);
  // Where you stand on each jump pad (all 2 × 2 m of it), and where it throws you.
  const pads = new Map<number, Vec>();
  for (const { at, to } of map.pads) {
    const iy = cellAt(at[1] + 0.01, 1);
    for (let iz = cellAt(at[2] - 1, 2); iz < cellAt(at[2] + 1, 2); iz++)
      for (let ix = cellAt(at[0] - 1, 0); ix < cellAt(at[0] + 1, 0); ix++)
        pads.set(ix + NX * (iz + NZ * iy), to);
  }
  for (let head = 0; head < tail; head++) {
    const k = queue[head]!;
    const ix = k % NX;
    const iz = Math.floor(k / NX) % NZ;
    const iy = Math.floor(k / LAYER);
    const to = pads.get(k);
    if (to) stand(to);
    for (let side = 0; side < 4; side++) {
      const [dx, dz] = SIDE_STEPS[side]!;
      const land = landing(ix + dx, Math.min(NY - 1, iy + STEP), iz + dz);
      if (land >= 0) visit(ix + dx, land, iz + dz);
    }
  }
  return { has: (k: number) => seen[k] === 1 };
}
const SIDE_STEPS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
