import { mapVector } from './vector.js';
/** @typedef {import('./contracts.ts').Vector3} Vector3  @typedef {import('./layout-types.ts').Matrix3} Matrix3  @typedef {import('./layout-types.ts').Transform} Transform  @typedef {import('./layout-types.ts').Placement} Placement  @typedef {import('./layout-types.ts').LayoutLibrary} LayoutLibrary  @typedef {import('./layout-types.ts').LayoutBox} LayoutBox */
// Layouts as data (data/layouts.json): the maps, each built of primitives (boxes, blocks, holes,
// stairs, ramps, walls, floors and tiers of blocks), pieces (data/pieces.json) and prefabs (named
// groups of them: data/prefabs.json), placed with a position, a turn, a flip and a scale, and
// repeated in a row or mirrored across the middle of the map. Spawns, pickups, jump pads and zones
// (the flags, the pedestal, the water) are placed the same way.
//
// expand() turns a layout into what the engine plays on: boxes of a material, laid one after
// another (a later one replaces what an earlier one filled: air cuts doors and windows), and the
// spots of everything else. It is pure: the engine, the build tools and the agents' plan (look.ts)
// all use it. x runs west to east, z north to south, y up; the floor is at y = 0.

// A turn or a flip is a 3 × 3 matrix (row by row) on [x, y, z]; with a translation, a transform.
/** @type {Transform} */
const IDENTITY = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
/** @type {Record<0 | 90 | 180 | 270, Matrix3>} */
const TURNS = {
  0: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  90: [0, 0, -1, 0, 1, 0, 1, 0, 0], // clockwise seen from above: north to east, east to south
  180: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  270: [0, 0, 1, 0, 1, 0, -1, 0, 0],
};
/** @type {Record<'x' | 'z' | 'xz', Matrix3>} */
const FLIPS = {
  x: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
  z: [1, 0, 0, 0, 1, 0, 0, 0, -1],
  xz: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
};
// Mirrored copies, in the order they're laid: the original first.
/** @type {Record<string, ('x' | 'z' | 'xz' | null)[]>} */
const MIRRORS = {
  x: [null, 'x'],
  z: [null, 'z'],
  xz: [null, 'x', 'z', 'xz'], // all four quarters
  point: [null, 'xz'], // both halves, each the other turned round the middle
};
/** @type {Record<'east' | 'west' | 'south' | 'north', [number, number]>} */
const DIRECTIONS = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] };
export const MOST_BOXES = 20000; // boxes a layout may come to, all copies counted

/** @param {Matrix3} a @param {Matrix3} b @returns {Matrix3} */
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
/** @param {Matrix3} m @param {Vector3} point @returns {Vector3} */
const apply = (m, [x, y, z]) => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
];
// outer ∘ inner: inner first.
/** @param {Transform} outer @param {Transform} inner @returns {Transform} */
const compose = (outer, inner) => ({
  m: mul(outer.m, inner.m),
  t: mapVector(apply(outer.m, inner.t), (v, i) => v + outer.t[i]),
});
/** @param {Transform} tf @param {Vector3} p @returns {Vector3} */
const point = (tf, p) => mapVector(apply(tf.m, p), (v, i) => clean(v + tf.t[i]));
/** @param {number} v */
const clean = (v) => Math.round(v * 1e6) / 1e6 + 0; // no -0, no 1e-15 left over from a turn

// The transform a part's own placement makes: scale, then flip, then turn, then move to `at`.
/** @param {Placement} part @returns {Transform} */
function placement({ at = [0, 0, 0], turn = 0, flip = null, scale = null }) {
  let m = TURNS[turn] ?? TURNS[0];
  if (flip) m = mul(m, FLIPS[flip]);
  if (scale) m = mul(m, [scale[0], 0, 0, 0, scale[1], 0, 0, 0, scale[2]]);
  return { m, t: [...at] };
}

// Every copy a part is laid as: repeated along a step, and those mirrored across its parent's middle.
/** @param {Placement} part @returns {Transform[]} */
function copies(part) {
  const out = [];
  const count = part.repeat?.count ?? 1;
  const step = part.repeat?.step ?? [0, 0, 0];
  for (const flip of MIRRORS[part.mirror ?? ''] ?? [null]) {
    /** @type {Transform} */
    const mirror = flip ? { m: FLIPS[flip], t: [0, 0, 0] } : IDENTITY;
    for (let i = 0; i < count; i++)
      out.push(compose(mirror, { m: IDENTITY.m, t: mapVector(step, (v) => v * i) }));
  }
  return out;
}

// A box from its local corners, through a transform: [min, max] in the parent's space.
/** @param {Transform} tf @param {Vector3} min @param {Vector3} max @returns {[Vector3, Vector3]} */
function moved(tf, min, max) {
  const a = point(tf, min);
  const b = point(tf, max);
  return [mapVector(a, (v, i) => Math.min(v, b[i])), mapVector(a, (v, i) => Math.max(v, b[i]))];
}

// A primitive's boxes, in its own space (its `at` is where that space sits in its parent's).
/** @param {import('./layout-types.ts').PrimitivePart} part @returns {LayoutBox[]} */
function shape(part) {
  /** @type {LayoutBox[]} */
  const boxes = [];
  const m = 'm' in part ? part.m : 'air';
  /** @param {number} x @param {number} z @param {number} w @param {number} d @param {number} h @param {number} y @param {string} material */
  const block = (x, z, w, d, h, y, material = m) =>
    boxes.push({ min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2], m: material });
  switch (part.type) {
    case 'box':
      boxes.push({ min: part.min, max: part.max, m });
      break;
    case 'block':
      block(0, 0, part.size[0], part.size[2], part.size[1], 0);
      break;
    case 'hole':
      block(0, 0, part.size[0], part.size[2], part.size[1], 0, 'air');
      break;
    case 'floor': {
      const thick = part.thick ?? 0.5;
      block(0, 0, part.size[0], part.size[1], thick, -thick);
      break;
    }
    case 'walls': {
      // Four walls round an open middle: a room with no roof, a pen, a ring.
      const [w, h, d] = part.size;
      const t = part.thick ?? 0.5;
      block(0, -d / 2 + t / 2, w, t, h, 0);
      block(0, d / 2 - t / 2, w, t, h, 0);
      block(-w / 2 + t / 2, 0, t, d - t * 2, h, 0);
      block(w / 2 - t / 2, 0, t, d - t * 2, h, 0);
      break;
    }
    case 'tiers': {
      // Blocks stacked, each centred on the one below.
      let y = 0;
      for (const layer of part.layers) {
        block(0, 0, layer.size[0], layer.size[2], layer.size[1], y, layer.m ?? m);
        y += layer.size[1];
      }
      break;
    }
    case 'stairs':
    case 'ramp': {
      // Steps climbing towards dir, each solid down to the bottom. A ramp is stairs of half-metre
      // steps, as many as its rise needs, spread over its length: you walk up those.
      const [dx, dz] = DIRECTIONS[part.dir];
      const steps = part.type === 'ramp' ? Math.max(1, Math.round(part.rise / 0.5)) : part.steps;
      const run = part.type === 'ramp' ? part.length / steps : (part.run ?? 1);
      const rise = part.type === 'ramp' ? part.rise / steps : (part.rise ?? 1);
      const width = part.width ?? 2;
      const from = 'from' in part ? (part.from ?? 0) : 0;
      for (let i = 0; i < steps; i++) {
        const along = (i + 0.5) * run;
        const [w, d] = dx ? [run, width] : [width, run];
        block(dx * along, dz * along, w, d, from + rise * (i + 1), 0);
      }
      break;
    }
    default:
      break;
  }
  return boxes;
}

// The layout's parts, every copy, as world boxes { min, max, m } (m: a material id, or 'air'), in
// the order they're laid. lib: { pieces, prefabs } by id. swap: material ids to use instead of others.
/** @param {import('./contracts.ts').GeometryPart[]} parts @param {Transform} parent @param {LayoutLibrary} lib @param {LayoutBox[]} out @param {Record<string, string>} swap @param {number} depth */
function lay(parts, parent, lib, out, swap, depth = 0) {
  if (depth > 8) throw new Error('prefabs inside prefabs, more than 8 deep');
  for (const part of parts) {
    for (const copy of copies(part)) {
      const tf = compose(compose(parent, copy), placement(part));
      if (part.type === 'group') lay(part.parts, tf, lib, out, swap, depth + 1);
      else if (part.type === 'prefab')
        lay(required(lib.prefabs, part.id).parts, tf, lib, out, { ...swap, ...part.swap }, depth + 1);
      else if (part.type === 'piece')
        lay(required(lib.pieces, part.id).cells ?? [], tf, lib, out, { ...swap, ...part.swap }, depth + 1);
      else {
        for (const box of shape(part)) {
          const [min, max] = moved(tf, box.min, box.max);
          out.push({ min, max, m: swap[box.m] ?? box.m });
          if (out.length > MOST_BOXES) throw new Error(`more than ${MOST_BOXES} boxes`);
        }
      }
    }
  }
  return out;
}

// Points placed the same way (spawns, pickups, pads): each copy's transform.
/** @template {Placement} T @param {T[]} list @returns {{spot: T, tf: Transform}[]} */
function spots(list) {
  const out = [];
  for (const spot of list) for (const copy of copies(spot)) out.push({ spot, tf: copy });
  return out;
}

// A layout, expanded: { id, name, about, floor, roof, look, boxes, spawns, items, pads, flags, pool,
// pedestal }, everything in metres in the world, materials by id. lib: { pieces, prefabs } (Maps by
// id). launch(at, to, clear) works out a jump pad's throw (it needs the game's gravity).
/** @param {import('./contracts.ts').Layouts['layouts'][number]} layout @param {LayoutLibrary} lib @param {(at: Vector3, to: Vector3, clear?: number) => Vector3} launch @returns {import('./layout-types.ts').ExpandedLayout} */
export function expand(layout, lib, launch) {
  const boxes = lay(layout.parts ?? [], IDENTITY, lib, [], {});
  const spawns = spots(layout.spawns ?? []).map(({ spot, tf }) => point(tf, spot.at));
  const items = spots(layout.pickups ?? []).map(({ spot, tf }) => ({
    piece: spot.piece,
    at: point(tf, spot.at),
  }));
  const pads = spots(layout.pads ?? []).map(({ spot, tf }) => {
    const at = point(tf, spot.at);
    const to = point(tf, spot.to);
    return {
      piece: spot.piece ?? 'jump-pad',
      at,
      to,
      clear: spot.clear ?? null,
      launch: launch(at, to, spot.clear),
    };
  });
  const zones = layout.zones ?? {};
  return {
    id: layout.id,
    name: layout.name,
    about: layout.about ?? '',
    floor: layout.floor,
    roof: {
      at: layout.roof.at,
      m: layout.roof.m,
      skylights: (layout.roof.skylights ?? []).map((s) => [s.at[0], s.at[1], s.size[0], s.size[1]]),
    },
    look: { ...layout.look },
    boxes,
    spawns,
    items,
    pads,
    flags: zones.flags ? { red: [...zones.flags.red], blue: [...zones.flags.blue] } : {},
    pool: zones.pool
      ? {
          name: zones.pool.name,
          min: [...zones.pool.min],
          max: [...zones.pool.max],
          basin: { min: [...zones.pool.basin.min], max: [...zones.pool.basin.max] },
        }
      : null,
    pedestal: zones.pedestal ? [...zones.pedestal] : null,
  };
}

// Every material a layout's parts use, and every piece and prefab (by id), for checking references.
/** @param {import('./contracts.ts').Layouts['layouts'][number]} layout @param {LayoutLibrary} lib */
export function references(layout, lib) {
  const used = {
    materials: new Set([layout.floor, layout.roof?.m].filter(Boolean)),
    pieces: new Set(/** @type {string[]} */ ([])),
    prefabs: new Set(/** @type {string[]} */ ([])),
  };
  /** @param {import('./contracts.ts').GeometryPart[] | undefined} parts */
  const walk = (parts) => {
    for (const part of parts ?? []) {
      if ('m' in part) used.materials.add(part.m);
      if ('layers' in part) for (const layer of part.layers) if (layer.m) used.materials.add(layer.m);
      if ('swap' in part) for (const to of Object.values(part.swap ?? {})) used.materials.add(to);
      if (part.type === 'group') walk(part.parts);
      if (part.type === 'prefab') used.prefabs.add(part.id);
      if (part.type === 'piece') used.pieces.add(part.id);
    }
  };
  walk(layout.parts);
  for (const id of used.prefabs) walk(lib.prefabs.get(id)?.parts);
  for (const pickup of layout.pickups ?? []) used.pieces.add(pickup.piece);
  for (const pad of layout.pads ?? []) used.pieces.add(pad.piece ?? 'jump-pad');
  return used;
}

/** @template T @param {Map<string, T>} values @param {string} id @returns {T} */
function required(values, id) {
  const value = values.get(id);
  if (value === undefined) throw new Error(`Missing layout reference ${id}`);
  return value;
}
