// Everything the arena sheds, drawn in the browser: chunks flying from every blast and bouncing
// off what they hit, pieces that came loose falling (and toppling) until they land, dust sifting
// down after gravel and hay blown off something high, and water pouring out of a hole in the
// canal. Where things
// end up is the server's business (server/physics.js, server/pool.js); this only shows them going.

import * as THREE from 'three';
import { GRAVITY, TOPPLE_MS } from '/shared/constants.js';
import { onData } from '/shared/data.js';
import { AIR, CELL, GRID_MIN, MATERIALS } from '/shared/map.js';
import { cellOf } from '/shared/voxels.js';
import { leaks } from '/shared/water.js';

/** @type {(THREE.Color|null)[]} */
let COLORS = []; // each material's colour, by its place
onData(() => (COLORS = MATERIALS.map((material) => material && new THREE.Color(material.color))));
/** @param {import('/shared/voxels.js').Voxels} voxels @param {import('./contracts.js').Vec3} at */
const solidAt = (voxels, [x, y, z]) => voxels.get(cellOf(x, 0), cellOf(y, 1), cellOf(z, 2)) !== AIR;

// ---- Chunks ----

const MOST_CHUNKS = 1500;
const chunkColor = new THREE.Color();
const matrix = new THREE.Matrix4();
const rotation = new THREE.Quaternion();
const euler = new THREE.Euler();
const scale = new THREE.Vector3();
const place = new THREE.Vector3();

// Pieces of whatever broke, flying out and bouncing off the arena until they come to rest, then
// crumbling away. All of them are drawn as one mesh.
export class Chunks {
  /** @param {THREE.Scene} scene @param {import('/shared/voxels.js').Voxels} voxels */
  constructor(scene, voxels) {
    this.voxels = voxels;
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      MOST_CHUNKS,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, chunkColor.set(0xffffff)); // so the colours are there before the first one flies
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    /** @type {import('./render-contracts.js').Chunk[]} */
    this.items = [];
  }

  // One chunk, at a point, flying off with a velocity.
  /** @param {import('./contracts.js').Vec3} at @param {import('./contracts.js').Vec3} velocity @param {THREE.Color} color @param {number} size */
  fling(at, velocity, color, size, life = 4 + Math.random() * 3) {
    if (this.items.length >= MOST_CHUNKS) this.items.shift();
    this.items.push({
      at: [...at],
      velocity: [...velocity],
      spin: /** @type {import('./contracts.js').Vec3} */ ([0, 0, 0].map(() => (Math.random() - 0.5) * 18)),
      turn: [Math.random() * 6, Math.random() * 6, Math.random() * 6],
      color: chunkColor
        .copy(color)
        .multiplyScalar(0.8 + Math.random() * 0.35)
        .clone(),
      size,
      life,
      total: life,
    });
  }

  // A blast tore these cells out (a flat [ix, iy, iz, …] list, and what each was): they fly out from
  // where it went off, more and harder the bigger it was.
  /** @param {import('./contracts.js').Vec3} at @param {number[]} cells @param {number[]} materials */
  blast(at, cells, materials, power = 1) {
    const count = Math.min(220, Math.ceil(cells.length / 3 / (2.2 - Math.min(1.2, power * 0.6))));
    for (let n = 0; n < count; n++) {
      const k = Math.floor(Math.random() * (cells.length / 3));
      const material = materials[k];
      const color = material === undefined ? null : COLORS[material];
      if (!color) continue;
      const x = cells[k * 3],
        y = cells[k * 3 + 1],
        z = cells[k * 3 + 2];
      if (x === undefined || y === undefined || z === undefined) continue;
      const from = /** @type {import('./contracts.js').Vec3} */ ([
        GRID_MIN[0] + (x + Math.random()) * CELL,
        GRID_MIN[1] + (y + Math.random()) * CELL,
        GRID_MIN[2] + (z + Math.random()) * CELL,
      ]);
      const out = /** @type {import('./contracts.js').Vec3} */ (
        from.map((v, a) => v - (at[a] ?? 0) + (Math.random() - 0.5) * 0.6)
      );
      out[1] += 0.5;
      const length = Math.hypot(...out) || 1;
      const speed = (5 + Math.random() * 11) * (0.6 + power * 0.5);
      this.fling(
        from,
        /** @type {import('./contracts.js').Vec3} */ (out.map((v) => (v / length) * speed)),
        color,
        (0.12 + Math.random() * 0.25) * (0.8 + power * 0.25),
      );
    }
  }

  // Bits of something that just came down, thrown up and out around where it landed.
  /** @param {import('./contracts.js').Vec3} at @param {number[]} materials @param {number} size */
  crash(at, materials, size) {
    const count = Math.min(160, 12 + size);
    for (let n = 0; n < count; n++) {
      const material = materials[Math.floor(Math.random() * materials.length)];
      const color = material === undefined ? null : COLORS[material];
      if (!color) continue;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      const from = /** @type {import('./contracts.js').Vec3} */ ([
        at[0] + (Math.random() - 0.5) * 1.5,
        at[1] + 0.3,
        at[2] + (Math.random() - 0.5) * 1.5,
      ]);
      this.fling(
        from,
        [Math.cos(angle) * speed, 2 + Math.random() * 5, Math.sin(angle) * speed],
        color,
        0.1 + Math.random() * 0.3,
      );
    }
  }

  /** @param {number} dt */
  update(dt) {
    const voxels = this.voxels;
    this.items = this.items.filter((item) => (item.life -= dt) > 0);
    this.items.forEach((item, i) => {
      if (!item.resting) {
        item.velocity[1] -= GRAVITY * dt;
        // One axis at a time: a chunk that runs into something bounces off it, losing speed.
        for (const a of /** @type {const} */ ([1, 0, 2])) {
          item.at[a] += item.velocity[a] * dt;
          if (!solidAt(voxels, item.at)) continue;
          item.at[a] -= item.velocity[a] * dt;
          item.velocity[a] *= -0.35;
          for (const b of /** @type {const} */ ([0, 1, 2])) if (b !== a) item.velocity[b] *= 0.7;
          if (a === 1 && Math.hypot(...item.velocity) < 1.2) item.resting = true;
        }
        for (const a of /** @type {const} */ ([0, 1, 2])) item.turn[a] += item.spin[a] * dt;
        if (item.at[1] < GRID_MIN[1] - 40) item.life = 0;
      }
      const fade = Math.min(1, item.life / 0.8);
      euler.set(...item.turn);
      matrix.compose(
        place.fromArray(item.at),
        rotation.setFromEuler(euler),
        scale.setScalar(item.size * fade),
      );
      this.mesh.setMatrixAt(i, matrix);
      this.mesh.setColorAt(i, item.color);
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---- Pieces falling ----

// Each face of a cell: its normal, its four corners and a fixed shade (as in world.js).
/** @type {{n:import('./contracts.js').Vec3,corners:import('./contracts.js').Vec3[],shade:number}[]} */
const FACES = [
  {
    n: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
    shade: 0.86,
  },
  {
    n: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    shade: 0.86,
  },
  {
    n: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    shade: 1,
  },
  {
    n: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    shade: 0.8,
  },
  {
    n: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    shade: 0.93,
  },
  {
    n: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    shade: 0.93,
  },
];
const pieceMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true });

// The outside of a piece: cells as a flat [ix, iy, iz, material, …] list.
/** @param {number[]} cells */
function pieceGeometry(cells) {
  const inside = new Set();
  for (let k = 0; k < cells.length; k += 4) inside.add(`${cells[k]},${cells[k + 1]},${cells[k + 2]}`);
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  for (let k = 0; k < cells.length; k += 4) {
    const [ix, iy, iz, material] = [cells[k], cells[k + 1], cells[k + 2], cells[k + 3]];
    if (ix === undefined || iy === undefined || iz === undefined || material === undefined) continue;
    const color = COLORS[material] ?? COLORS[1] ?? new THREE.Color(0xffffff);
    for (const face of FACES) {
      if (inside.has(`${ix + face.n[0]},${iy + face.n[1]},${iz + face.n[2]}`)) continue;
      const base = positions.length / 3;
      for (const [cx, cy, cz] of face.corners) {
        positions.push(
          GRID_MIN[0] + (ix + cx) * CELL,
          GRID_MIN[1] + (iy + cy) * CELL,
          GRID_MIN[2] + (iz + cz) * CELL,
        );
        normals.push(...face.n);
        colors.push(color.r * face.shade, color.g * face.shade, color.b * face.shade);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// Pieces of the arena that came loose, on their way down: toppling over first if the server says
// they do, then falling the rest of the way, until the server says they've landed.
export class Falling {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<number,import('./render-contracts.js').FallingPiece>} */
    this.pieces = new Map(); // id → { group, cells, topple, drop, start, ms }
  }

  /** @param {import('./render-contracts.js').FallingMessage} message @param {number} now */
  start({ id, cells, topple, drop, ms }, now) {
    const pivot = topple?.pivot ?? [0, 0, 0];
    const mesh = new THREE.Mesh(pieceGeometry(cells), pieceMaterial.clone());
    mesh.position.set(-pivot[0], -pivot[1], -pivot[2]);
    const group = new THREE.Group(); // turns about the edge it topples over
    group.position.fromArray(pivot);
    group.add(mesh);
    this.scene.add(group);
    this.pieces.set(id, { group, mesh, cells, topple, drop, pivot, start: now, ms });
  }

  // It has landed: it's part of the arena again (or gone). Returns what it was made of.
  /** @param {number} id */
  land(id) {
    const piece = this.pieces.get(id);
    if (!piece) return [];
    this.remove(id, piece);
    const materials = [];
    for (let k = 3; k < piece.cells.length; k += 4) {
      const material = piece.cells[k];
      if (material !== undefined) materials.push(material);
    }
    return materials;
  }

  /** @param {number} id @param {import('./render-contracts.js').FallingPiece} piece */
  remove(id, piece) {
    this.pieces.delete(id);
    this.scene.remove(piece.group);
    piece.mesh.geometry.dispose();
    piece.mesh.material.dispose();
  }

  clear() {
    for (const [id, piece] of this.pieces) this.remove(id, piece);
  }

  /** @param {number} now */
  update(now) {
    for (const [id, piece] of this.pieces) {
      const t = (now - piece.start) / 1000;
      const { topple, group, pivot } = piece;
      const tipping = topple ? TOPPLE_MS / 1000 : 0;
      if (topple) {
        // Slowly at first, then faster, over its edge.
        const angle = (Math.PI / 2) * Math.min(1, (t / tipping) ** 2);
        if (topple.axis === 'x') group.rotation.set(0, 0, topple.sign > 0 ? -angle : angle);
        else group.rotation.set(topple.sign > 0 ? angle : -angle, 0, 0);
      }
      const falling = Math.max(0, t - tipping);
      const fallen = 0.5 * GRAVITY * falling * falling;
      group.position.y = pivot[1] - (piece.drop < 0 ? fallen : Math.min(piece.drop, fallen));
      if (piece.drop < 0) piece.mesh.material.opacity = Math.max(0, 1 - falling / 2.5); // out into space
      if (t * 1000 > piece.ms + 3000) this.remove(id, piece); // never heard it land
    }
  }
}

// ---- Dust sifting down ----

const FLAKES = 900;

// Dust sifting down from wherever gravel or hay was blown off, in its colour, for a few seconds after.
export class Dust {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.positions = new Float32Array(FLAKES * 3).fill(-1000);
    this.colors = new Float32Array(FLAKES * 3).fill(1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        vertexColors: true,
        size: 0.09,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    /** @type {(import('./render-contracts.js').Flake|null)[]} */
    this.flakes = Array.from({ length: FLAKES }, () => null);
    /** @type {import('./render-contracts.js').DustFall[]} */
    this.falls = []; // { lo: [x, z], hi: [x, z], top, bottom, color, until }
  }

  // Dust falling from the cells of a hole (pieces: [x, y, z, material, landY] each), for a while.
  /** @param {[number,number,number,number,number][]} pieces @param {number} now */
  sift(pieces, now) {
    const first = pieces[0];
    if (!first) return;
    const xs = pieces.map((p) => p[0]);
    const zs = pieces.map((p) => p[2]);
    this.falls.push({
      lo: [Math.min(...xs) - 0.3, Math.min(...zs) - 0.3],
      hi: [Math.max(...xs) + 0.3, Math.max(...zs) + 0.3],
      top: Math.max(...pieces.map((p) => p[1])),
      bottom: Math.min(...pieces.map((p) => p[4])),
      color: COLORS[first[3]] ?? new THREE.Color(0xffffff),
      until: now + 5000,
    });
  }

  /** @param {number} dt @param {number} now */
  update(dt, now) {
    this.falls = this.falls.filter((fall) => now < fall.until + 4000);
    const active = this.falls.filter((fall) => now < fall.until);
    for (let i = 0; i < FLAKES; i++) {
      let flake = this.flakes[i];
      if (flake && flake.at[1] < flake.fall.bottom) flake = this.flakes[i] = null;
      if (!flake && active.length && Math.random() < dt * 4) {
        const fall = active[i % active.length];
        if (!fall) continue;
        flake = this.flakes[i] = {
          fall,
          at: [
            fall.lo[0] + Math.random() * (fall.hi[0] - fall.lo[0]),
            fall.top - Math.random() * 0.5,
            fall.lo[1] + Math.random() * (fall.hi[1] - fall.lo[1]),
          ],
          speed: 1 + Math.random() * 1.2,
          phase: Math.random() * 10,
        };
        this.colors.set([fall.color.r, fall.color.g, fall.color.b], i * 3);
      }
      if (!flake) {
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      flake.at[1] -= flake.speed * dt;
      flake.at[0] += Math.sin(now / 600 + flake.phase) * 0.4 * dt;
      flake.at[2] += Math.cos(now / 700 + flake.phase) * 0.4 * dt;
      this.positions.set(flake.at, i * 3);
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('color').needsUpdate = true;
  }
}

// ---- Water pouring out of the pool ----

const DROPS = 1200;

// Water pouring out of the holes in the pool while it runs out, and spreading into puddles on the
// floor below, which dry up after a while.
export class Pour {
  /** @param {THREE.Scene} scene @param {import('/shared/voxels.js').Voxels} voxels */
  constructor(scene, voxels) {
    this.scene = scene;
    this.voxels = voxels;
    this.positions = new Float32Array(DROPS * 3).fill(-1000);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0x7cc8ff,
        size: 0.12,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    /** @type {(import('./render-contracts.js').WaterDrop|null)[]} */
    this.drops = Array.from({ length: DROPS }, () => null);
    /** @type {import('./render-contracts.js').Opening[]} */
    this.openings = [];
    this.lookedAt = 0;
    /** @type {Map<string,import('./render-contracts.js').Puddle>} */
    this.puddles = new Map(); // "x,z" → { mesh, grownUntil }
    this.puddleMaterial = new THREE.MeshLambertMaterial({
      color: 0x3f9ed8,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
  }

  // While the level drops, every few frames: where the water gets out, and where it lands.
  /** @param {number} dt @param {number} now @param {number} level @param {boolean} running */
  update(dt, now, level, running) {
    if (running && now - this.lookedAt > 300) {
      this.lookedAt = now;
      this.openings = leaks(this.voxels, level).map((at) => ({ at, floor: this.floorUnder(at) }));
      for (const { floor } of this.openings) if (floor) this.puddle(floor, now);
    }
    if (!running) this.openings = [];
    for (let i = 0; i < DROPS; i++) {
      let drop = this.drops[i];
      if (drop && (solidAt(this.voxels, drop.at) || drop.at[1] < drop.floor - 0.1))
        drop = this.drops[i] = null;
      if (!drop && this.openings.length && Math.random() < dt * 12) {
        const opening = this.openings[i % this.openings.length];
        if (!opening) continue;
        const { at, floor } = opening;
        drop = this.drops[i] = {
          at: [
            at[0] + (Math.random() - 0.5) * 0.4,
            at[1] + (Math.random() - 0.5) * 0.3,
            at[2] + (Math.random() - 0.5) * 0.4,
          ],
          velocity: [(Math.random() - 0.5) * 1.2, -0.5 - Math.random(), (Math.random() - 0.5) * 1.2],
          floor: floor?.[1] ?? at[1] - 30,
        };
      }
      if (!drop) {
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      drop.velocity[1] -= GRAVITY * dt;
      for (const a of /** @type {const} */ ([0, 1, 2])) drop.at[a] += drop.velocity[a] * dt;
      this.positions.set(drop.at, i * 3);
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    // Puddles spread while water lands in them, and dry up afterwards.
    for (const [key, puddle] of this.puddles) {
      const wet = now < puddle.grownUntil;
      puddle.size = Math.min(3.5, puddle.size + (wet ? dt * 0.8 : 0));
      puddle.mesh.scale.setScalar(puddle.size);
      puddle.mesh.material.opacity = wet ? 0.55 : Math.max(0, puddle.mesh.material.opacity - dt / 25);
      if (!wet && puddle.mesh.material.opacity <= 0) {
        this.scene.remove(puddle.mesh);
        puddle.mesh.material.dispose();
        this.puddles.delete(key);
      }
    }
  }

  // Where water falling from a point lands: the floor straight below it, or null (the void).
  /** @param {import('./contracts.js').Vec3} at @returns {import('./contracts.js').Vec3|null} */
  floorUnder(at) {
    const hit = this.voxels.raycast(at, [0, -1, 0], 40);
    return hit ? [at[0], at[1] - hit.distance, at[2]] : null;
  }

  /** @param {import('./contracts.js').Vec3} at @param {number} now */
  puddle(at, now) {
    const key = `${Math.round(at[0])},${Math.round(at[1])},${Math.round(at[2])}`;
    let puddle = this.puddles.get(key);
    if (!puddle) {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
        this.puddleMaterial.clone(),
      );
      mesh.position.set(at[0], at[1] + 0.02, at[2]);
      this.scene.add(mesh);
      puddle = { mesh, size: 0.2, grownUntil: now };
      this.puddles.set(key, puddle);
    }
    puddle.grownUntil = now + 700;
  }

  // Somewhere to hear it from: the opening nearest to a point, or null.
  /** @param {import('./contracts.js').Vec3} to */
  nearest(to) {
    let best = null;
    let bestDistance = Infinity;
    for (const { at } of this.openings) {
      const distance = Math.hypot(...at.map((v, i) => v - (to[i] ?? 0)));
      if (distance < bestDistance) [best, bestDistance] = [at, distance];
    }
    return best;
  }

  clear() {
    /** @type {import('./render-contracts.js').Opening[]} */
    this.openings = [];
    this.drops.fill(null);
    for (const puddle of this.puddles.values()) {
      this.scene.remove(puddle.mesh);
      puddle.mesh.material.dispose();
    }
    this.puddles.clear();
  }
}
