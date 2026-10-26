// The arena every layout stands in, as the engine builds it: a 72 × 72 m floor of 0.5 m cells
// floating over a bottomless void, pillars round its edge holding up a roof with a beam along their
// tops, skylights in the roof. x runs west to east, z north to south, y up; the floor is at y = 0
// (its slab is one cell thick, just below it). Pure: it works from what it's given, so the engine,
// the build checks and the agents' plan (src/agent/look.ts) all build arenas the same way.

/**
 * @typedef {[number, number, number]} Vector3
 * @typedef {{ min: Vector3, max: Vector3, m: number }} ArenaBox
 * @typedef {{
 *   floor: number,
 *   roof: { at: number, m: number, skylights?: [number, number, number, number][] },
 *   boxes: ArenaBox[],
 *   pads: { at: Vector3 }[],
 *   flags?: Record<string, Vector3>
 * }} ArenaLayout
 */

export const ARENA_HALF = 36; // the floor spans -36…36 on x and z
export const RIM = 2; // and round it, a rim this wide for the pillars to stand on, over the void
export const CELL = 0.5;
export const TOP = 18.5; // nothing is built higher than this (the highest roof's top): above it is open sky
/** @type {Vector3} */
export const GRID_MIN = [-ARENA_HALF - RIM, -CELL, -ARENA_HALF - RIM];
/** @type {Vector3} */
export const GRID_SIZE = [
  ((ARENA_HALF + RIM) * 2) / CELL,
  (TOP + CELL) / CELL,
  ((ARENA_HALF + RIM) * 2) / CELL,
];
export const VOID_Y = -12; // fall below this and you're gone
export const BEAM = 1; // the beam along the pillars' tops, under the roof's edge, is this deep
export const JUMP_PAD_HALF = 1; // jump pads are 2 × 2 m
export const FLAG_PAD_HALF = 1.5; // and flag pads 3 × 3 m

// The pillars round the edge that hold the roof up, each 2 m square, [x, z] its middle: one at each
// corner, and every 6 m along each side between them.
const ALONG = [-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30];
const EDGE = ARENA_HALF + RIM / 2;
/** @type {[number, number][]} */
export const PILLARS = [
  ...[-EDGE, EDGE].flatMap((x) =>
    [-EDGE, ...ALONG, EDGE].map((z) => /** @type {[number, number]} */ ([x, z])),
  ),
  ...[-EDGE, EDGE].flatMap((z) => ALONG.map((x) => /** @type {[number, number]} */ ([x, z]))),
];

// A map's arena as it stands before anyone shoots at it, for a game mode: material places, x
// fastest, then z, then y. map: an expanded layout with materials by place (floor, roof.m, boxes'
// m: 0 for air); pads, flags. place(id): a material's place, for the ones the engine builds with
// itself (pillar, jump-pad, red-pad, blue-pad).
/** @param {ArenaLayout} map @param {string} mode @param {(id: string) => number} place */
export function buildArena(map, mode, place) {
  const [nx, ny, nz] = GRID_SIZE;
  const cells = new Uint8Array(nx * ny * nz);
  // Fills the cells whose centres lie inside the box.
  /** @param {Vector3} min @param {Vector3} max @param {number} material */
  const fill = (min, max, material) => {
    /** @param {0 | 1 | 2} i */
    const lower = (i) => Math.max(0, Math.ceil((min[i] - GRID_MIN[i]) / CELL - 0.5));
    /** @param {0 | 1 | 2} i */
    const upper = (i) => Math.min(GRID_SIZE[i], Math.ceil((max[i] - GRID_MIN[i]) / CELL - 0.5));
    /** @type {Vector3} */
    const lo = [lower(0), lower(1), lower(2)];
    /** @type {Vector3} */
    const hi = [upper(0), upper(1), upper(2)];
    for (let y = lo[1]; y < hi[1]; y++) {
      for (let z = lo[2]; z < hi[2]; z++)
        for (let x = lo[0]; x < hi[0]; x++) cells[x + nx * (z + nz * y)] = material;
    }
  };
  const inside = ARENA_HALF;
  const outside = inside + RIM;
  const pillar = place('pillar');
  fill([-inside, -CELL, -inside], [inside, 0, inside], map.floor);
  // The pillars, the beam round the rim along their tops, and the roof over it all, with skylights
  // in it: [x, z, w, d] of open sky.
  const { at, m, skylights = [] } = map.roof;
  for (const [x, z] of PILLARS)
    fill([x - RIM / 2, -CELL, z - RIM / 2], [x + RIM / 2, at - BEAM, z + RIM / 2], pillar);
  fill([-outside, at - BEAM, -outside], [outside, at, outside], pillar);
  fill([-inside, at - BEAM, -inside], [inside, at, inside], 0);
  fill([-outside, at, -outside], [outside, at + CELL, outside], m);
  for (const [x, z, w, d] of skylights)
    fill([x - w / 2, at, z - d / 2], [x + w / 2, at + CELL, z + d / 2], 0);
  // What stands on the floor, box by box: a later box replaces what an earlier one filled.
  for (const { min, max, m: material } of map.boxes) fill(min, max, material);
  const pad = place('jump-pad');
  for (const {
    at: [x, y, z],
  } of map.pads)
    fill([x - JUMP_PAD_HALF, y - CELL, z - JUMP_PAD_HALF], [x + JUMP_PAD_HALF, y, z + JUMP_PAD_HALF], pad);
  if (mode === 'ctf') {
    for (const [team, [x, y, z]] of Object.entries(map.flags ?? {})) {
      fill(
        [x - FLAG_PAD_HALF, y - CELL, z - FLAG_PAD_HALF],
        [x + FLAG_PAD_HALF, y, z + FLAG_PAD_HALF],
        place(`${team}-pad`),
      );
    }
  }
  return cells;
}

// The cell a coordinate is in, along one axis.
/** @param {number} value @param {0 | 1 | 2} axis */
export const cellAt = (value, axis) => Math.floor((value - GRID_MIN[axis]) / CELL);
