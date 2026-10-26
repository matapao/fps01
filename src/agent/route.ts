/**
 * The way there on foot, for an agent's goto: A* over where a player can stand in the arena's
 * half-metre cells. A player is 0.8 m wide and 1.8 m tall, so a place to stand is a corner where four
 * cells meet, with the 2 × 2 cells round it clear for 2 m up and something under at least two of
 * them. From one to the next half a metre away (or diagonally, if both sides are clear) you walk,
 * step up half a metre, jump up a metre where there's head room, or drop any height; a jump pad
 * throws you to where it aims.
 *
 *   route(world, from, to, pads) → { path, reached, jumps }
 *
 * path is the feet's waypoints, where the way turns, climbs or drops, ending as near to `to` as
 * there's a way (reached says whether that's within a metre of it). jumps: the indices of waypoints
 * that need a jump to get onto. Pure, and quick: a few milliseconds across the arena.
 */
import { CELL, GRID_MIN, GRID_SIZE } from '../../shared/arena.js';

type Vec = [number, number, number];
export interface World {
  get(ix: number, iy: number, iz: number): number;
}
export interface Route {
  path: Vec[];
  reached: boolean;
  jumps: number[];
}

const [NX, NY, NZ] = GRID_SIZE;
const VX = NX + 1; // corners along x…
const VZ = NZ + 1; // …and z
const HEAD = 4; // cells of air someone needs over where they stand (2 m)
const STEP = 1; // cells you walk up without jumping (half a metre)
const JUMP = 2; // cells you jump up onto (a metre)
const MOST = 80000; // corners looked at, at most, before settling for the nearest
const ROOM = new Uint8Array(VX * VZ * NY);
const SIDES: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

const cornerOf = (v: number, axis: import('../../shared/contracts.ts').Axis) =>
  Math.round((v - GRID_MIN[axis]) / CELL);
const levelOf = (y: number) => Math.round((y - GRID_MIN[1]) / CELL);
const at = (vx: number, iy: number, vz: number): Vec => [
  GRID_MIN[0] + vx * CELL,
  GRID_MIN[1] + iy * CELL,
  GRID_MIN[2] + vz * CELL,
];

export function route(world: World, from: Vec, to: Vec, pads: { at: Vec; to: Vec }[] = []): Route {
  const solid = (ix: number, iy: number, iz: number) =>
    ix < 0 || iz < 0 || ix >= NX || iz >= NZ || iy >= NY
      ? false
      : iy < 0
        ? false
        : world.get(ix, iy, iz) !== 0;
  // Whether the 2 × 2 columns round a corner are clear from level iy up to (not with) top.
  const clear = (vx: number, iy: number, vz: number, top: number) => {
    for (let y = Math.max(0, iy); y < top; y++)
      for (let dz = -1; dz <= 0; dz++)
        for (let dx = -1; dx <= 0; dx++) if (solid(vx + dx, y, vz + dz)) return false;
    return true;
  };
  // Something under at least two of the four cells: not a corner hanging over an edge, where a step
  // too far drops you off.
  const supported = (vx: number, iy: number, vz: number) =>
    +solid(vx - 1, iy - 1, vz - 1) +
      +solid(vx, iy - 1, vz - 1) +
      +solid(vx - 1, iy - 1, vz) +
      +solid(vx, iy - 1, vz) >=
    2;
  // Room to stand at a corner, at a level: worked out once a route (1 yes, 2 no).
  const room = ROOM.fill(0);
  const roomAt = (vx: number, iy: number, vz: number) => {
    const k = vx + VX * (vz + VZ * iy);
    if (!room[k]) room[k] = clear(vx, iy, vz, iy + HEAD) ? 1 : 2;
    return room[k] === 1;
  };
  const standable = (vx: number, iy: number, vz: number) =>
    iy > 0 && iy < NY && supported(vx, iy, vz) && roomAt(vx, iy, vz);
  // Where you come down at a corner from level iy: the first level with something under it, if the
  // way down is clear. -1 if there's nothing under it (the void).
  const landing = (vx: number, iy: number, vz: number) => {
    for (let y = iy; y > 0; y--) {
      if (!clear(vx, y, vz, y + 1)) return -1;
      if (supported(vx, y, vz)) return roomAt(vx, y, vz) ? y : -1;
    }
    return -1;
  };
  const key = (vx: number, iy: number, vz: number) => vx + VX * (vz + VZ * iy);
  const unkey = (k: number): [number, number, number] => [
    k % VX,
    Math.floor(k / (VX * VZ)),
    Math.floor(k / VX) % VZ,
  ];

  // Where you start: the corner nearest your feet, or the first one round it you can stand at.
  let start = -1;
  const [sx, sy, sz] = [cornerOf(from[0], 0), levelOf(from[1] + 0.01), cornerOf(from[2], 2)];
  for (let r = 0; r <= 2 && start < 0; r++) {
    for (let dz = -r; dz <= r && start < 0; dz++) {
      for (let dx = -r; dx <= r && start < 0; dx++) {
        const y = landing(sx + dx, Math.min(NY - 1, sy + 1), sz + dz);
        if (y >= 0) start = key(sx + dx, y, sz + dz);
      }
    }
  }
  if (start < 0) return { path: [], reached: false, jumps: [] };
  const goal = [to[0], to[1], to[2]];
  const far = (vx: number, iy: number, vz: number) => {
    const [x, y, z] = at(vx, iy, vz);
    return Math.hypot(x - goal[0]!, z - goal[2]!) + Math.abs(y - goal[1]!);
  };
  // Where the jump pads are, by the corners on them, and where they throw you.
  const thrown = new Map<number, number>();
  for (const pad of pads) {
    const y = levelOf(pad.at[1] + 0.01);
    const land = landing(cornerOf(pad.to[0], 0), levelOf(pad.to[1] + 0.01) + 1, cornerOf(pad.to[2], 2));
    if (land < 0) continue;
    const target = key(cornerOf(pad.to[0], 0), land, cornerOf(pad.to[2], 2));
    for (let vz = cornerOf(pad.at[2] - 0.75, 2); vz <= cornerOf(pad.at[2] + 0.75, 2); vz++)
      for (let vx = cornerOf(pad.at[0] - 0.75, 0); vx <= cornerOf(pad.at[0] + 0.75, 0); vx++)
        thrown.set(key(vx, y, vz), target);
  }

  const cost = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const jumped = new Set<number>(); // corners you jump up onto
  const heap = new Heap();
  heap.push(start, far(...unkey(start)) / CELL);
  let best = start;
  let bestFar = far(...unkey(start));
  let looked = 0;
  while (heap.size && looked++ < MOST) {
    const k = heap.pop();
    const [vx, iy, vz] = unkey(k);
    const here = far(vx, iy, vz);
    if (here < bestFar) [best, bestFar] = [k, here];
    if (here < 0.6) break;
    const g = cost.get(k)!;
    const go = (next: number, step: number, jump = false) => {
      const total = g + step;
      if (total >= (cost.get(next) ?? Infinity)) return;
      cost.set(next, total);
      came.set(next, k);
      if (jump) jumped.add(next);
      else jumped.delete(next);
      const [nx, ny, nz] = unkey(next);
      heap.push(next, total + far(nx, ny, nz) / CELL);
    };
    const pad = thrown.get(k);
    if (pad !== undefined) {
      go(pad, 4); // it throws you whatever you do
      continue;
    }
    for (const [dx, dz, length] of SIDES) {
      const [nx, nz] = [vx + dx, vz + dz];
      if (nx < 1 || nz < 1 || nx >= VX - 1 || nz >= VZ - 1) continue;
      // Diagonally, only where both ways round the corner are open.
      if (dx && dz && (!roomAt(vx + dx, iy, vz) || !roomAt(vx, iy, vz + dz))) continue;
      if (roomAt(nx, iy, nz)) {
        // Walk on, or off an edge and down onto whatever is under it (not into the void).
        const level = landing(nx, iy, nz);
        if (level >= 0) go(key(nx, level, nz), length + (iy - level) * 0.1);
        continue;
      }
      for (let up = 1; up <= JUMP; up++) {
        if (!standable(nx, iy + up, nz)) continue;
        const jump = up > STEP;
        if (jump && !clear(vx, iy, vz, iy + HEAD + up)) break; // no head room to jump
        go(key(nx, iy + up, nz), length + up * (jump ? 1.5 : 0.5), jump);
        break;
      }
    }
  }

  // Back from the best corner to the start, then only the corners where the way changes.
  const corners: number[] = [];
  for (let k: number | undefined = best; k !== undefined; k = came.get(k)) corners.unshift(k);
  const path: Vec[] = [];
  const jumps: number[] = [];
  corners.forEach((k, i) => {
    const [vx, iy, vz] = unkey(k);
    const prev = corners[i - 1];
    const next = corners[i + 1];
    const keep =
      i === corners.length - 1 ||
      jumped.has(k) ||
      prev === undefined ||
      next === undefined ||
      (() => {
        const [px, py, pz] = unkey(prev);
        const [qx, qy, qz] = unkey(next);
        return py !== iy || qy !== iy || vx - px !== qx - vx || vz - pz !== qz - vz || thrown.has(prev);
      })();
    if (i === 0 || !keep) return;
    if (jumped.has(k)) jumps.push(path.length);
    path.push(at(vx, iy, vz));
  });
  // And from the last corner to the point itself, when it's on the level and close.
  const end = path.at(-1) ?? at(...unkey(start));
  if (
    bestFar < 1 &&
    Math.abs(goal[1]! - end[1]) < 0.3 &&
    Math.hypot(goal[0]! - end[0], goal[2]! - end[2]) > 0.05
  )
    path.push([goal[0]!, end[1], goal[2]!]);
  return { path, reached: bestFar < 1, jumps };
}

// A binary heap of keys by priority, smallest first.
class Heap {
  private keys: number[] = [];
  private costs: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, cost: number) {
    const { keys, costs } = this;
    let i = keys.length;
    keys.push(key);
    costs.push(cost);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (costs[parent]! <= cost) break;
      keys[i] = keys[parent]!;
      costs[i] = costs[parent]!;
      i = parent;
    }
    keys[i] = key;
    costs[i] = cost;
  }
  pop(): number {
    const { keys, costs } = this;
    const top = keys[0]!;
    const lastKey = keys.pop()!;
    const lastCost = costs.pop()!;
    if (keys.length) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= keys.length) break;
        const right = left + 1;
        const child = right < keys.length && costs[right]! < costs[left]! ? right : left;
        if (costs[child]! >= lastCost) break;
        keys[i] = keys[child]!;
        costs[i] = costs[child]!;
        i = child;
      }
      keys[i] = lastKey;
      costs[i] = lastCost;
    }
    return top;
  }
}
