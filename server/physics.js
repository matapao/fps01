// What happens to the arena after something breaks it, beyond the hole itself:
// - Gravel and hay blown away from over a drop (the bottom of a gravel bunker, a stable roof with hay
//   stacked on it) fall and land in heaps on whatever is below. What lands in the water sinks;
//   nothing lands on anyone, or on a jump pad.
// - A piece that nothing holds up any more falls: the top of a tree cut through, a bunker with its
//   legs blown away, an island of floor, the roof with no pillars left under it (server/roof.js). A
//   piece holds if it touches enough of the bottom layer, the floor or the pillars' feet. A tall one,
//   or one that comes down on a narrow footing, topples over first; a big one comes down in slabs.
//   It crushes whoever it lands on (unless a planet's pieces knocked it loose: they hurt nobody),
//   and after a long fall it shatters.
// - The water hears about every change, in case its basin has sprung a leak (server/pool.js).
// The browsers see it all through 'rubble', 'fall' and 'landed' messages (public/js/debris.js).

import { GRAVITY, TOPPLE_MS } from '../shared/constants.js';
import { onData } from '../shared/data.js';
import {
  AIR,
  BEAM,
  CELL,
  GRID_MIN,
  GRID_SIZE,
  JUMP_PADS,
  JUMP_PAD_HALF,
  MAP,
  MATERIALS,
  RUBBLE,
  inWater,
} from '../shared/map.js';
import { boxHitsWorld, playerBox } from '../shared/physics.js';
import { cellCentre, cellOf as cellAt } from '../shared/voxels.js';
import { round, send } from './util.js';
import { indexed } from '../shared/indexed.js';
import { mapVector, AXES } from '../shared/vector.js';
/** @typedef {import('../shared/contracts.ts').Vector3} Vector3 */
/** @typedef {import('../shared/runtime-types.ts').Player} Player */
/** @typedef {import('./subsystem-types.ts').CellMaterial} CellMaterial */
/** @typedef {import('./subsystem-types.ts').BreakCause} BreakCause */

const [NX, NY, NZ] = GRID_SIZE;
const LAYER = NX * NZ;
const GROUNDED = 400; // a piece touching this many cells of the bottom layer (the floor, the pillars' feet) holds
const MOST_SEARCHED = 150000; // a search that gets this far without knowing gives up: it holds
/** @type {boolean[]} */
let ANCHOR = []; // by material: what holds whatever touches it up (jump pads and flag pads: nothing breaks them)
onData(() => (ANCHOR = MATERIALS.map((material) => material?.breakable === false)));
const MOST_PIECES = 6; // loose pieces one break can send falling
const SLABS = 1500; // a loose piece this big comes down in slabs…
const SLAB = /** @type {const} */ ([120, 720]); // …of between this many cells and this many
const LASTS = 4; // a piece of fewer cells than this shatters where it lands…
const SHATTERS = 10; // …and so does one that falls this far (cells: 5 m)
const VOID_MS = 2500; // falling out of the arena, until it's gone
const DROP = 4; // cells (2 m): gravel and hay with less of a drop under them just break
const RUBBLE_SHOWN = 80; // pieces of gravel and hay each browser draws falling, for one break
/** @type {[number,number][]} */
const ACROSS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** @type {Uint32Array|null} */
let mark = null; // per cell: the number of the search that last got there
let searches = 0;

export class Physics {
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    /** @type {Map<number,import('./subsystem-types.ts').FallingPiece>} */
    this.falling = new Map(); // id → a piece on its way down
    /** @type {{dueAt:number,pieces:CellMaterial[]}[]} */
    this.rubble = []; // gravel and hay on their way down: { dueAt, pieces: [[ix, iy, iz, material]] }
    this.nextId = 1;
  }

  clear() {
    this.falling.clear();
    /** @type {{dueAt:number,pieces:CellMaterial[]}[]} */
    this.rubble = [];
  }

  // Cells have broken (a flat [ix, iy, iz, …] list, with what each was made of). cause: where the
  // blast was (at), whose it was (owner, for anyone crushed by what falls), and whether what falls
  // lands on nobody (harmless).
  /** @param {number[]} removed @param {number[]} materials @param {BreakCause} cause */
  broke(removed, materials, cause = {}) {
    this.game.pool.changed();
    if (!removed.length) return;
    this.dropRubble(removed, materials);
    const world = this.game.world;
    const seeds = [];
    for (let k = 0; k < removed.length; k += 3) {
      const [ix, iy, iz] = [indexed(removed, k), indexed(removed, k + 1), indexed(removed, k + 2)];
      for (const [dx, dy, dz] of /** @type {Vector3[]} */ ([
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ])) {
        const [nx, ny, nz] = [ix + dx, iy + dy, iz + dz];
        if (
          nx >= 0 &&
          ny >= 0 &&
          nz >= 0 &&
          nx < NX &&
          ny < NY &&
          nz < NZ &&
          indexed(world.cells, nx + NX * (nz + NZ * ny)) !== AIR
        )
          seeds.push(nx + NX * (nz + NZ * ny));
      }
    }
    const pieces = loosePieces(world, seeds)
      .sort((a, b) => b.length - a.length)
      .slice(0, MOST_PIECES);
    this.fall(
      pieces.flatMap((piece) => slabs(piece)),
      cause,
    );
    this.game.roof.broke(removed, cause);
  }

  // Cells (indices) of the roof that nothing holds up any more come down in slabs, straight down,
  // and whatever hung from them comes down with them.
  /** @param {number[]} cells @param {BreakCause} cause */
  bringDown(cells, cause) {
    const world = this.game.world;
    const kept = cells.map((i) => indexed(world.cells, i));
    for (const i of cells) world.cells[i] = AIR; // a look at what holds once they've gone…
    const seeds = [];
    for (const i of cells) {
      for (const j of [i + 1, i - 1, i + NX, i - NX, i + LAYER, i - LAYER])
        if (j >= 0 && j < world.cells.length && indexed(world.cells, j) !== AIR) seeds.push(j);
    }
    const hanging = loosePieces(world, seeds);
    cells.forEach((i, k) => (world.cells[i] = indexed(kept, k))); // …and back, to come down properly
    this.fall([...slabs(cells, 1), ...hanging.flatMap((piece) => slabs(piece))], cause, false);
  }

  // ---- Gravel and hay through a hole ----

  // The gravel and hay among broken cells with a drop of 2 m or more under them fall to the bottom
  // of it; the rest just breaks.
  /** @param {number[]} removed @param {number[]} materials */
  dropRubble(removed, materials) {
    const world = this.game.world;
    /** @type {CellMaterial[]} */
    const pieces = [];
    /** @type {[number,number,number,number,number][]} */
    const shown = [];
    let longest = 0;
    for (let k = 0, m = 0; k < removed.length; k += 3, m++) {
      const lands = indexed(RUBBLE, indexed(materials, m));
      if (!lands) continue;
      const [ix, iy, iz] = [indexed(removed, k), indexed(removed, k + 1), indexed(removed, k + 2)];
      const rest = restingCell((x, y, z) => world.get(x, y, z) !== AIR, ix, iy, iz);
      if (rest < 0 || iy - rest < DROP) continue;
      pieces.push([ix, iy, iz, lands]);
      longest = Math.max(longest, iy - rest);
      shown.push([...mapVector(cellCentre(ix, iy, iz), round), lands, round(GRID_MIN[1] + rest * CELL)]);
    }
    if (!pieces.length) return;
    const ms = fallMs(longest * CELL);
    this.rubble.push({ dueAt: this.game.now() + ms, pieces });
    const every = Math.ceil(shown.length / RUBBLE_SHOWN);
    this.game.broadcast({ type: 'rubble', pieces: shown.filter((_, i) => i % every === 0), ms });
  }

  // The gravel and hay come down, one after another, each on whatever is under it by now, sliding off
  // the top of a heap onto lower ground beside it.
  /** @param {CellMaterial[]} pieces */
  settle(pieces) {
    const game = this.game;
    const world = game.world;
    const filled = new Set();
    /** @param {number} x @param {number} y @param {number} z */
    const solid = (x, y, z) => world.get(x, y, z) !== AIR || filled.has(x + NX * (z + NZ * y));
    const cells = [];
    for (const [ix, iy, iz, material] of pieces) {
      let [x, z] = [ix, iz];
      let rest = restingCell(solid, x, iy, z);
      if (rest < 0) continue;
      for (let slide = 0; slide < 4; slide++) {
        /** @type {[number,number,number]|null} */
        let best = null;
        for (const [dx, dz] of ACROSS) {
          if (solid(x + dx, rest, z + dz)) continue;
          const lower = restingCell(solid, x + dx, rest, z + dz);
          if (lower >= 0 && lower <= rest - 2 && (!best || lower < best[2])) best = [x + dx, z + dz, lower];
        }
        if (!best) break;
        [x, z, rest] = best;
      }
      if (iy - rest < DROP) continue;
      const centre = cellCentre(x, rest, z);
      if (inWater(centre, world.water) || onPad(centre) || this.anyoneIn(x, rest, z)) continue;
      filled.add(x + NX * (z + NZ * rest));
      cells.push(x, rest, z, material);
    }
    if (!cells.length) return;
    world.deposit(cells);
    game.broadcast({ type: 'build', entry: ['d', ...cells] });
    game.pool.changed();
  }

  // Whether a player stands in a cell.
  /** @param {number} ix @param {number} iy @param {number} iz */
  anyoneIn(ix, iy, iz) {
    const lo = /** @type {Vector3} */ ([
      GRID_MIN[0] + ix * CELL,
      GRID_MIN[1] + iy * CELL,
      GRID_MIN[2] + iz * CELL,
    ]);
    for (const player of this.game.players.values()) {
      if (!player.alive) continue;
      const { min, max } = playerBox(player.feet, 0.05);
      if (AXES.every((a) => lo[a] < max[a] && lo[a] + CELL > min[a])) return true;
    }
    return false;
  }

  // ---- Pieces that come loose ----

  // Loose pieces (each a list of cell indices) leave the arena and start to fall: everyone takes
  // them away from their copy and watches them come down. All of them go before any falls, so
  // none comes down on another still waiting to fall. cause: what brought them down (see broke);
  // topple: whether they may tip over.
  /** @param {number[][]} pieces @param {BreakCause} cause */
  fall(pieces, cause, topple = true) {
    const world = this.game.world;
    const shapes = pieces.map((piece) =>
      piece.map(/** @returns {CellMaterial} */ (i) => [...cellOf(i), indexed(world.cells, i)]),
    );
    for (const cells of shapes) world.remove(cells.flatMap(([ix, iy, iz]) => [ix, iy, iz]));
    for (const cells of shapes) this.drop(cells, cause, topple);
  }

  // One piece, already out of the arena: how it falls, and everyone told. The roof comes down
  // straight, whatever brought it down: none of it tips over.
  /** @param {CellMaterial[]} cells @param {BreakCause} cause @param {boolean} topple */
  drop(cells, { at = null, owner = null, harmless = false }, topple) {
    const game = this.game;
    const world = game.world;
    const flat = cells.flatMap(([ix, iy, iz]) => [ix, iy, iz]);
    const beam = cellAt(MAP.roof.at - BEAM + 0.01, 1);
    const motion = plan(world, cells, at, topple && !cells.some(([, iy]) => iy >= beam));
    const ms =
      (motion.topple ? TOPPLE_MS : 0) + (Number.isFinite(motion.dy) ? fallMs(motion.dy * CELL) : VOID_MS);
    const id = this.nextId++;
    this.falling.set(id, { id, cells, shape: motion.shape, owner, harmless, landAt: game.now() + ms });
    game.broadcast({
      type: 'fall',
      id,
      entry: ['x', ...flat],
      cells: cells.flat(),
      topple: motion.topple,
      drop: Number.isFinite(motion.dy) ? round(motion.dy * CELL) : -1,
      ms: Math.round(ms),
    });
  }

  // A piece lands: it joins the arena where it came to rest (or shatters, if it's small or fell a
  // long way), and crushes whoever is there, unless it's harmless. Out of the arena, it's gone.
  /** @param {import('./subsystem-types.ts').FallingPiece} fall */
  land(fall) {
    const game = this.game;
    const world = game.world;
    this.falling.delete(fall.id);
    const { dy } = drop(world, fall.shape);
    /** @type {CellMaterial[]} */
    const rested = Number.isFinite(dy)
      ? fall.shape.map(([ix, iy, iz, material]) => [ix, iy - dy, iz, material])
      : [];
    const kept = fall.cells.length >= LASTS && dy < SHATTERS ? rested : [];
    if (rested.length && !fall.harmless) this.crush(rested, fall);
    if (kept.length) world.deposit(kept.flat());
    const centre = rested.length ? middle(rested) : null;
    game.broadcast({
      type: 'landed',
      id: fall.id,
      entry: ['d', ...kept.flat()],
      at: centre,
      size: fall.cells.length,
    });
    if (kept.length) {
      for (const player of game.players.values()) if (player.alive) this.free(player);
      game.pool.changed();
    }
  }

  // Everyone the piece comes down on gets hurt: badly, if it's big. It's a kill for whoever's blast
  // brought it down.
  /** @param {CellMaterial[]} rested @param {import('./subsystem-types.ts').FallingPiece} fall */
  crush(rested, fall) {
    const game = this.game;
    const attacker = fall.owner === null ? null : (game.players.get(fall.owner) ?? null);
    const amount = Math.min(300, 30 + 6 * fall.cells.length);
    for (const player of [...game.players.values()]) {
      if (!player.alive) continue;
      const { min, max } = playerBox(player.feet);
      const hit = rested.some(([ix, iy, iz]) => {
        const lo = /** @type {Vector3} */ ([
          GRID_MIN[0] + ix * CELL,
          GRID_MIN[1] + iy * CELL,
          GRID_MIN[2] + iz * CELL,
        ]);
        return AXES.every((a) => lo[a] < max[a] && lo[a] + CELL > min[a]);
      });
      if (hit) game.damage(attacker, player, amount, { weapon: 'crush' });
    }
  }

  // Someone a landed piece left stuck inside it goes up on top of it.
  /** @param {Player} player */
  free(player) {
    const world = this.game.world;
    const feet = /** @type {Vector3} */ ([...player.feet]);
    const stuck = () => {
      const { min, max } = playerBox(feet);
      return boxHitsWorld(world, min, max);
    };
    if (!stuck()) return;
    for (let up = 0; up < 40 && stuck(); up++) feet[1] = Math.floor(feet[1] / CELL + 1) * CELL + 0.001;
    player.feet = mapVector(feet, round);
    send(player.socket, { type: 'moved', feet: player.feet });
  }

  /** @param {number} now */
  tick(now) {
    for (const fall of [...this.falling.values()]) if (now >= fall.landAt) this.land(fall);
    if (!this.rubble.some((batch) => now >= batch.dueAt)) return;
    for (const batch of this.rubble.filter((b) => now >= b.dueAt)) this.settle(batch.pieces);
    this.rubble = this.rubble.filter((batch) => now < batch.dueAt);
  }
}

// ---- Searching the grid ----

/** @param {number} i @returns {Vector3} */
function cellOf(i) {
  const ix = i % NX;
  const rest = (i - ix) / NX;
  const iz = rest % NZ;
  return [ix, (rest - iz) / NZ, iz];
}

// Falling from a cell straight down: the cell it comes to rest in (on top of the first solid one,
// by solid(ix, iy, iz)), or -1 if there's nothing under it at all.
/** @param {(x:number,y:number,z:number)=>boolean} solid @param {number} ix @param {number} iy @param {number} iz */
function restingCell(solid, ix, iy, iz) {
  for (let y = iy - 1; y >= 0; y--) if (solid(ix, y, iz)) return y + 1;
  return -1;
}

/** @param {Vector3} at */
function onPad([x, y, z]) {
  return JUMP_PADS.some(
    ({ at }) =>
      Math.abs(x - at[0]) <= JUMP_PAD_HALF + CELL &&
      Math.abs(z - at[2]) <= JUMP_PAD_HALF + CELL &&
      Math.abs(y - at[1]) < 1,
  );
}

// How long a fall of this many metres takes.
/** @param {number} metres */
function fallMs(metres) {
  return 1000 * Math.sqrt((2 * Math.max(0, metres)) / GRAVITY) + 50;
}

/** @param {CellMaterial[]} cells */
function middle(cells) {
  const sum = /** @type {Vector3} */ ([0, 0, 0]);
  for (const [ix, iy, iz] of cells) AXES.forEach((a) => (sum[a] += cellCentre(ix, iy, iz)[a]));
  return mapVector(sum, (v) => round(v / cells.length));
}

// The pieces among the cells next to a break that have come loose: each a list of cell indices,
// touching less than GROUNDED cells of the bottom layer and with no jump pad or flag pad in it.
// Each search goes downwards first, so whatever stands on the ground finds it quickly.
/** @param {import('../shared/voxels.js').Voxels} world @param {number[]} seeds */
export function loosePieces(world, seeds) {
  if (!mark) mark = new Uint32Array(NX * NY * NZ);
  const cells = world.cells;
  const session = searches + 1;
  const held = new Set(); // searches that found their piece holds
  const pieces = [];
  for (const seed of seeds) {
    if (indexed(cells, seed) === AIR || indexed(mark, seed) >= session) continue;
    const search = ++searches;
    const piece = [seed];
    const stack = [seed];
    mark[seed] = search;
    let ground = seed < LAYER ? 1 : 0;
    let holds = indexed(ANCHOR, indexed(cells, seed));
    while (stack.length && !holds) {
      const i = stack.pop();
      if (i === undefined) break;
      const ix = i % NX;
      const rest = (i - ix) / NX;
      const iz = rest % NZ;
      const iy = (rest - iz) / NZ;
      for (let side = 0; side < 6 && !holds; side++) {
        let j; // downwards last, so it's the next looked at
        if (side === 0) j = iy + 1 < NY ? i + LAYER : -1;
        else if (side === 1) j = ix + 1 < NX ? i + 1 : -1;
        else if (side === 2) j = ix > 0 ? i - 1 : -1;
        else if (side === 3) j = iz + 1 < NZ ? i + NX : -1;
        else if (side === 4) j = iz > 0 ? i - NX : -1;
        else j = iy > 0 ? i - LAYER : -1;
        if (j < 0 || indexed(cells, j) === AIR) continue;
        if (indexed(mark, j) >= session) {
          if (indexed(mark, j) !== search && held.has(indexed(mark, j))) holds = true; // part of something that holds
          continue;
        }
        mark[j] = search;
        piece.push(j);
        stack.push(j);
        if (j < LAYER && ++ground >= GROUNDED) holds = true;
        if (indexed(ANCHOR, indexed(cells, j)) || piece.length >= MOST_SEARCHED) holds = true;
      }
    }
    if (holds) held.add(search);
    else pieces.push(piece);
  }
  return pieces;
}

// A big loose piece (cell indices) split into slabs to come down one by one, some small and some
// large: cut across its longer side, again and again, until each part is small enough. Smaller
// pieces come down whole (least: the size that's split at all).
/** @param {number[]} piece */
function slabs(piece, least = SLABS) {
  if (piece.length < least) return [piece];
  /** @type {number[][]} */
  const out = [];
  /** @param {number[]} part */
  const split = (part) => {
    const most = SLAB[0] + Math.random() * (SLAB[1] - SLAB[0]);
    if (part.length <= most) {
      out.push(part);
      return;
    }
    const lo = /** @type {[number,number]} */ ([Infinity, Infinity]);
    const hi = /** @type {[number,number]} */ ([-Infinity, -Infinity]);
    for (const i of part) {
      const ix = i % NX;
      const iz = ((i - ix) / NX) % NZ;
      lo[0] = Math.min(lo[0], ix);
      hi[0] = Math.max(hi[0], ix);
      lo[1] = Math.min(lo[1], iz);
      hi[1] = Math.max(hi[1], iz);
    }
    const a = hi[0] - lo[0] >= hi[1] - lo[1] ? 0 : 1;
    const cut = lo[a] + (hi[a] - lo[a] + 1) * (0.3 + Math.random() * 0.4);
    /** @type {[number[],number[]]} */
    const [near, far] = [[], []];
    for (const i of part) {
      const ix = i % NX;
      (a === 0 ? ix : ((i - ix) / NX) % NZ) < cut ? near.push(i) : far.push(i);
    }
    if (!near.length || !far.length) {
      out.push(part);
      return;
    }
    split(near);
    split(far);
  };
  split(piece);
  return out;
}

// How far cells ([ix, iy, iz, …] each) can drop straight down before one of them lands on something:
// dy in cells (Infinity: there's nothing under any of them), how many columns they fill, and the
// columns they'd land on.
/** @param {import('../shared/voxels.js').Voxels} world @param {CellMaterial[]} cells @returns {import('./subsystem-types.ts').DropResult} */
export function drop(world, cells) {
  /** @type {Map<number,Vector3>} */
  const lowest = new Map();
  for (const [ix, iy, iz] of cells) {
    const key = ix + NX * iz;
    const previous = lowest.get(key);
    if (!previous || iy < previous[1]) lowest.set(key, [ix, iy, iz]);
  }
  let dy = Infinity;
  /** @type {[number,number][]} */
  let contacts = [];
  for (const [ix, iy, iz] of lowest.values()) {
    const rest = restingCell((x, y, z) => world.get(x, y, z) !== AIR, ix, iy, iz);
    if (rest < 0) continue;
    const gap = iy - rest;
    if (gap < dy) {
      dy = gap;
      contacts = [];
    }
    if (gap === dy) contacts.push([ix, iz]);
  }
  return { dy, columns: lowest.size, contacts };
}

// How a loose piece falls: whether it topples over first (a tall one, or one coming down on a
// narrow footing; never a wide flat slab, which comes down flat), the shape it's in after that
// ([ix, iy, iz, material] cells, before it drops), and how far it then drops (cells; Infinity: out
// of the arena). It tips over the edge of what it comes down on, on that side (or its own bottom
// edge, if it comes down on nothing).
/** @param {import('../shared/voxels.js').Voxels} world @param {CellMaterial[]} cells @param {Vector3|null} from @returns {import('./subsystem-types.ts').FallingPlan} */
export function plan(world, cells, from, topple = true) {
  const straight = drop(world, cells);
  if (!topple) return { topple: null, shape: cells, dy: straight.dy };
  const lo = mapVector([0, 0, 0], (_, a) => Math.min(...cells.map((c) => c[a])));
  const hi = mapVector([0, 0, 0], (_, a) => Math.max(...cells.map((c) => c[a])));
  const width = Math.max(hi[0] - lo[0], hi[2] - lo[2]) + 1;
  const height = hi[1] - lo[1] + 1;
  const slab = height <= 3 && width >= 8;
  const narrow =
    !slab &&
    Number.isFinite(straight.dy) &&
    straight.columns >= 4 &&
    straight.contacts.length * 4 <= straight.columns;
  const tall = height >= 4 && height >= 2.5 * width;
  if (!narrow && !tall) return { topple: null, shape: cells, dy: straight.dy };
  const { axis, sign } = toppleWay(cells, straight, from);
  const a = axis === 'x' ? 0 : 2;
  const feet = straight.contacts.length
    ? straight.contacts.map(([ix, iz]) => (a === 0 ? ix : iz))
    : [lo[a], hi[a]];
  const pivot = sign > 0 ? Math.max(...feet) + 1 : Math.min(...feet);
  const py = lo[1];
  /** @type {CellMaterial[]} */
  let shape = cells.map(([ix, iy, iz, material]) => {
    const along = a === 0 ? ix : iz;
    const moved = sign > 0 ? pivot + (iy - py) : pivot - 1 - (iy - py);
    const up = sign > 0 ? py + (pivot - along) - 1 : py + (along - pivot);
    return a === 0 ? [moved, up, iz, material] : [ix, up, moved, material];
  });
  // Tipped over, it rests on whatever is in the way: up out of it, a little at most.
  /** @param {CellMaterial} cell */
  const blocked = (cell) => world.get(cell[0], cell[1], cell[2]) !== AIR;
  for (let up = 0; up < 6 && shape.some(blocked); up++)
    shape = shape.map(([ix, iy, iz, material]) => [ix, iy + 1, iz, material]);
  shape = shape.filter((cell) => !blocked(cell)); // what it still tips into breaks off
  const pivotAt = mapVector(
    [
      GRID_MIN[0] + (a === 0 ? pivot : 0) * CELL,
      GRID_MIN[1] + py * CELL,
      GRID_MIN[2] + (a === 2 ? pivot : 0) * CELL,
    ],
    round,
  );
  return { topple: { axis, sign, pivot: pivotAt }, shape, dy: drop(world, shape).dy };
}

// Which way a piece topples: off its footing, towards where its weight is; or else away from the
// blast; or any way at all.
/** @param {CellMaterial[]} cells @param {import('./subsystem-types.ts').DropResult} straight @param {Vector3|null} from @returns {{axis:'x'|'z',sign:number}} */
function toppleWay(cells, straight, from) {
  const centre = /** @type {[number,number]} */ ([0, 0]);
  for (const [ix, , iz] of cells) {
    centre[0] += (ix + 0.5) / cells.length;
    centre[1] += (iz + 0.5) / cells.length;
  }
  let [dx, dz] = [0, 0];
  if (straight.contacts.length) {
    const foot = /** @type {[number,number]} */ ([0, 0]);
    for (const [ix, iz] of straight.contacts) {
      foot[0] += (ix + 0.5) / straight.contacts.length;
      foot[1] += (iz + 0.5) / straight.contacts.length;
    }
    [dx, dz] = [centre[0] - foot[0], centre[1] - foot[1]];
  }
  if (Math.hypot(dx, dz) < 0.5 && from)
    [dx, dz] = [GRID_MIN[0] + centre[0] * CELL - from[0], GRID_MIN[2] + centre[1] * CELL - from[2]];
  if (Math.hypot(dx, dz) < 0.01) {
    const angle = Math.random() * Math.PI * 2;
    [dx, dz] = [Math.cos(angle), Math.sin(angle)];
  }
  return Math.abs(dx) >= Math.abs(dz)
    ? { axis: 'x', sign: Math.sign(dx) || 1 }
    : { axis: 'z', sign: Math.sign(dz) || 1 };
}
