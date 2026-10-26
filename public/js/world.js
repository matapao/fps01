// Builds the scene: the arena, drawn from the shared voxel grid in 8 × 8 m columns, each redrawn
// when a blast tears a hole in it; the light it stands in, the sun's and the sky's, in each map's
// own colours; the pool's water, at whatever level it has run down to; and the universe around it:
// stars, a nebula, five planets (shoot one and it blows up) and the sun, drawn first in a pass of
// their own (see Sky).

import * as THREE from 'three';
import { context2d } from './dom.js';
import { onData } from '/shared/data.js';
import { AIR, CELL, GRID_MIN, GRID_SIZE, MATERIALS } from '/shared/map.js';
import { PLANETS } from '/shared/planets.js';

const SPACE = 0x0a0f1c; // what far-off parts of the arena fade into
const COLUMN = 16; // cells per side of a drawn column
const [NX, NY, NZ] = GRID_SIZE;
// Each material's look, by its place (data/materials.json): worked out again when the data changes.
/** @type {boolean[]} */
let SOLID = [];
/** @type {(THREE.Color|null)[]} */
let COLORS = [];
/** @type {(THREE.Color|null)[]} */
let CEILINGS = []; // undersides
/** @type {boolean[]} */
let TILED = [];
onData(() => {
  SOLID = MATERIALS.map(Boolean);
  COLORS = MATERIALS.map((material) => material && new THREE.Color(material.color));
  CEILINGS = MATERIALS.map((material) => material && new THREE.Color(material.ceiling ?? material.color));
  TILED = MATERIALS.map((material) => Boolean(material?.tiles));
});
const AO = /** @type {const} */ ([0.5, 0.68, 0.85, 1]); // how much a corner tucked against 0…3 solid cells is darkened

// Each face: normal, its four corners (counter-clockwise seen from outside) and a fixed shade.
/** @typedef {import('./contracts.js').Vec3} Vec3 */
/** @typedef {0|1|2} Axis */
const FACES = /** @type {{n:Vec3,corners:[Vec3,Vec3,Vec3,Vec3],shade:number}[]} */ ([
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
]).map((face) => {
  const axis = face.n.findIndex((v) => v !== 0);
  const tangents = /** @type {Axis[]} */ ([0, 1, 2]).filter((a) => a !== axis);
  const first = tangents[0],
    second = tangents[1];
  if (first === undefined || second === undefined) throw new Error('A cube face must have two tangent axes');
  return { ...face, tangents: /** @type {[Axis,Axis]} */ ([first, second]) };
});

// Where the sun is: the light on the arena comes from the same way as the sun in the sky.
export const SUN = new THREE.Vector3(-0.5, 0.62, 0.6).normalize();
const PLANET_DISTANCE = 1500; // how far off the planets are drawn: infinitely far, as the sky turns but never moves
const SKYLIGHT = 1.9; // how bright the light from the whole sky is…
const SUNLIGHT = 1.5; // …and the sun's, on what faces it

/** @param {import('/shared/voxels.js').Voxels} voxels */
export function createWorld(voxels) {
  const scene = new THREE.Scene(); // no background: the sky is drawn first, behind it
  scene.fog = new THREE.Fog(SPACE, 110, 320);
  return {
    scene,
    sky: new Sky(),
    water: new Water(scene),
    lighting: new Lighting(scene),
    building: new Building(voxels, scene),
  };
}

// The pool's surface, on a map with a pool: see-through, from above and from below, at the level
// the server says.
class Water {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    const material = new THREE.MeshLambertMaterial({
      color: 0x3fb2f0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    this.surface.renderOrder = 1; // after the arena, so the basin shows through it
    this.surface.visible = false;
    /** @type {{min:Vec3,max:Vec3}|null} */
    this.pool = null;
    scene.add(this.surface);
  }

  // The map's pool ({ min, max } when it's full), or null.
  /** @param {{min:Vec3,max:Vec3}|null} pool */
  setPool(pool) {
    this.pool = pool;
    if (!pool) {
      this.surface.visible = false;
      return;
    }
    const { min, max } = pool;
    this.surface.scale.set(max[0] - min[0], 1, max[2] - min[2]);
    this.surface.position.set((min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2);
  }

  /** @param {number} level */
  setLevel(level) {
    this.surface.position.y = level;
    this.surface.visible = Boolean(this.pool && level > this.pool.min[1] + 0.01);
  }
}

// The light: from the whole sky (brighter from above than from below), and from the sun. Each map
// has its own colours for them ({ sky, ground, sun }): a warm desert, a bright summer's day, a cold
// winter's one.
export class Lighting {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.ambient = new THREE.HemisphereLight(0xfff3e2, 0x8a8f9c, SKYLIGHT);
    this.sun = new THREE.DirectionalLight(0xfff1dc, SUNLIGHT);
    this.sun.position.copy(SUN).multiplyScalar(100);
    scene.add(this.ambient, this.sun, this.sun.target);
  }

  /** @param {{sky:string,ground:string,sun:string}} look */
  setLook({ sky, ground, sun }) {
    this.ambient.color.set(sky);
    this.ambient.groundColor.set(ground);
    this.sun.color.set(sun);
  }
}

// The universe the arena floats in, drawn before everything else from a camera that turns with
// yours but never moves, so it's always infinitely far away.
export class Sky {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 1, 4000);
    this.scene.background = nebula();
    const sun = SUN;
    const pixels = Math.min(window.devicePixelRatio, 2); // star sizes are in screen pixels
    for (const [count, size, brightness] of /** @type {Vec3[]} */ ([
      [5200, 1.8, 0.85],
      [1400, 2.6, 1],
      [160, 4, 1],
    ]))
      this.scene.add(stars(count, size * pixels, brightness));
    this.scene.add(
      glow(sun.clone().multiplyScalar(2000), 340, '#fff4d6'),
      glow(sun.clone().multiplyScalar(2000), 90, '#ffffff'),
    );
    const daylight = new THREE.DirectionalLight(0xfff1dc, 3);
    daylight.position.copy(sun);
    this.scene.add(daylight, new THREE.AmbientLight(0x404a66, 0.25));
    /** @type {ReturnType<typeof planet>[]} */
    this.planets = [];
    this.setPlanets();
    /** @type {{made:ReturnType<typeof planet>,start:number,radius:number,flash:THREE.Sprite,debris:THREE.Points<THREE.BufferGeometry,THREE.PointsMaterial>,velocities:THREE.Vector3[]}[]} */
    this.bursts = []; // planets blowing up
  }

  // The planets in the data (data/sky.json): again when it changes.
  setPlanets() {
    for (const made of this.planets) {
      this.scene.remove(made);
      made.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        part.geometry.dispose();
        for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
          if (material instanceof THREE.MeshLambertMaterial) material.map?.dispose();
          material.dispose();
        }
      });
    }
    this.planets = PLANETS.map(({ dir, size, look }) => {
      const made = planet(look, Math.tan(size) * PLANET_DISTANCE);
      made.position.fromArray(dir).multiplyScalar(PLANET_DISTANCE);
      this.scene.add(made);
      return made;
    });
  }

  // The planets blown up this round (their indices): gone from the sky.
  /** @param {number[]} gone */
  setGone(gone) {
    this.planets.forEach((made, i) => (made.visible = !gone.includes(i)));
  }

  // A planet blows up: a flash that swells over it and fades, and its pieces flying apart.
  /** @param {number} n @param {number} now */
  explode(n, now) {
    const made = this.planets[n];
    const definition = PLANETS[n];
    if (!made || !definition) return;
    const radius = Math.tan(definition.size) * PLANET_DISTANCE;
    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: dot('#fff3d6'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    flash.position.copy(made.position);
    const count = 900;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(radius * (0.6 + Math.random() * 2.2));
      velocities.push(v);
      positions.set(made.position.toArray(), i * 3);
      color.copy(
        Math.random() < 0.5
          ? made.userData.color
          : new THREE.Color(Math.random() < 0.5 ? 0xffb050 : 0xfff0d0),
      );
      colors.set([color.r, color.g, color.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const debris = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 3 * Math.min(window.devicePixelRatio, 2),
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(flash, debris);
    this.bursts.push({ made, start: now, radius, flash, debris, velocities });
  }

  // The bursts, frame by frame: the flash swells and fades, the planet goes as it peaks, and its
  // pieces fly apart and fade.
  /** @param {number} now */
  update(now) {
    this.bursts = this.bursts.filter((burst) => {
      const t = (now - burst.start) / 1000;
      const { made, radius, flash, debris, velocities } = burst;
      flash.scale.setScalar(radius * (t < 0.35 ? 1 + t * 14 : 5.9 + (t - 0.35) * 2));
      flash.material.opacity = t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) / 2.2);
      if (t > 0.3) made.visible = false;
      const position = debris.geometry.getAttribute('position');
      const spread = Math.min(t, 6);
      velocities.forEach((v, i) =>
        position.setXYZ(
          i,
          made.position.x + v.x * spread,
          made.position.y + v.y * spread,
          made.position.z + v.z * spread,
        ),
      );
      position.needsUpdate = true;
      debris.material.opacity = Math.max(0, 1 - t / 7);
      if (t < 7) return true;
      this.scene.remove(flash, debris);
      debris.geometry.dispose();
      return false;
    });
  }

  // Turns with the camera, zooms with it, and draws.
  /** @param {THREE.WebGLRenderer} renderer @param {THREE.PerspectiveCamera} camera */
  render(renderer, camera) {
    camera.getWorldQuaternion(this.camera.quaternion);
    if (this.camera.fov !== camera.fov || this.camera.aspect !== camera.aspect) {
      this.camera.fov = camera.fov;
      this.camera.aspect = camera.aspect;
      this.camera.updateProjectionMatrix();
    }
    renderer.render(this.scene, this.camera);
  }
}

// A soft round dot, for stars and the sun's glow.
function dot(color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = context2d(canvas);
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.25, color);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Stars scattered evenly over the sky, white with a few blue and orange ones among them.
/** @param {number} count @param {number} size @param {number} brightness */
function stars(count, size, brightness) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tints = [
    new THREE.Color(0xffffff),
    new THREE.Color(0xbcd4ff),
    new THREE.Color(0xffe2b8),
    new THREE.Color(0xffc49a),
  ];
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const z = Math.random() * 2 - 1;
    const angle = Math.random() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    positions.set([Math.cos(angle) * ring * 3000, z * 3000, Math.sin(angle) * ring * 3000], i * 3);
    color
      .copy(tints[Math.random() < 0.7 ? 0 : 1 + Math.floor(Math.random() * 3)] ?? new THREE.Color(0xffffff))
      .multiplyScalar(brightness * (0.5 + Math.random() * 0.5));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size,
    sizeAttenuation: false,
    vertexColors: true,
    map: dot(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

// A glow that always faces you: the sun.
/** @param {THREE.Vector3} at @param {number} size @param {string} color */
function glow(at, size, color) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: dot(color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sprite.position.copy(at);
  sprite.scale.setScalar(size);
  return sprite;
}

// The deep background: near black, with clouds of coloured gas along a band across the sky. Drawn
// once on a canvas wrapped around the sky (wider than high: longitude across, latitude down).
function nebula() {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = context2d(canvas);
  context.fillStyle = '#02030a';
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = 'lighter';
  const colors = [
    'rgba(120, 60, 200, 0.07)',
    'rgba(40, 120, 200, 0.06)',
    'rgba(200, 60, 140, 0.05)',
    'rgba(60, 170, 170, 0.05)',
  ];
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * width;
    const band = Math.sin((x / width) * Math.PI * 2) * 0.16; // the band waves across the sky
    const y = height * (0.5 + band + (Math.random() - 0.5) * 0.18);
    const radius = 60 + Math.random() * 220;
    for (const shift of [-width, 0, width]) {
      const gradient = context.createRadialGradient(x + shift, y, 0, x + shift, y, radius);
      gradient.addColorStop(0, colors[i % colors.length] ?? 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      context.fillStyle = gradient;
      context.fillRect(x + shift - radius, y - radius, radius * 2, radius * 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A texture of bands round a planet, from a list of colours, some of them speckled with blotches.
/** @param {string[]} shades @param {string[]|null} blotches */
function bandTexture(shades, blotches = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const context = context2d(canvas);
  for (let y = 0; y < 256; y += 4 + Math.floor(Math.random() * 10)) {
    context.fillStyle = shades[Math.floor(Math.random() * shades.length)] ?? '#ffffff';
    context.fillRect(0, y, 128, 14);
  }
  if (blotches) {
    for (let i = 0; i < 140; i++) {
      context.fillStyle = blotches[Math.floor(Math.random() * blotches.length)] ?? '#ffffff';
      context.beginPath();
      context.ellipse(
        Math.random() * 128,
        Math.random() * 256,
        2 + Math.random() * 9,
        2 + Math.random() * 6,
        Math.random() * Math.PI,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Rings round a planet: bright and faint stripes in a colour, fading at their edges.
/** @param {number} radius @param {Vec3} color */
function rings(radius, [r, g, b]) {
  const strip = document.createElement('canvas');
  strip.width = 256;
  strip.height = 1;
  const stripContext = context2d(strip);
  for (let x = 0; x < 256; x++) {
    const edge = Math.min(1, x / 40, (256 - x) / 40);
    stripContext.fillStyle = `rgba(${r}, ${g}, ${b}, ${(0.25 + Math.random() * 0.5) * edge})`;
    stripContext.fillRect(x, 0, 1, 1);
  }
  const ringTexture = new THREE.CanvasTexture(strip);
  ringTexture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.RingGeometry(radius * 1.35, radius * 2.3, 96, 1);
  // Map the strip across the ring, from its inner edge to its outer one.
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    const distance = Math.hypot(position.getX(i), position.getY(i));
    uv.setXY(i, (distance - radius * 1.35) / (radius * 0.95), 0.5);
  }
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({
      map: ringTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  mesh.rotation.set(Math.PI / 2.3, 0.3, 0);
  return mesh;
}

// What each planet looks like, by its asset (sky/planet-… in assets/assets.json): its bands, any
// blotches on it, its rings, a moon.
/** @type {Record<string,{shades:string[],rings?:Vec3,blotches?:string[],moon?:string}>} */
const PLANET_LOOKS = {
  ringed: {
    shades: ['#c9a27a', '#e3c9a3', '#a7764f', '#d8b48a', '#8c5f40', '#ead7b8'],
    rings: [230, 210, 180],
  },
  rocky: { shades: ['#a8442e', '#b5533a', '#93391f'], blotches: ['#6d2a1d', '#c86a48', '#5a2016'] },
  icy: { shades: ['#cfe9f5', '#e8f6fb', '#b5dcee', '#f4fbfe'], blotches: ['#9fcbe0', '#ffffff'] },
  moon: { shades: ['#3f8f7a', '#2f7766', '#57a58b', '#246152'], moon: '#b9b4ab' },
  violet: { shades: ['#7a4fc2', '#a07ae0', '#5a3696', '#8f66d6'], rings: [200, 180, 240] },
};

// A planet, lit by the sun: radius how big it's drawn where it's put.
/** @param {string} look @param {number} radius */
function planet(look, radius) {
  const definition = PLANET_LOOKS[look.replace(/^sky\/planet-/, '')] ?? PLANET_LOOKS['rocky'];
  if (!definition) throw new Error('Default planet look missing');
  const { shades, blotches, rings: ringColor, moon } = definition;
  const group = Object.assign(new THREE.Group(), { userData: { color: new THREE.Color(shades[0]) } });
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 32),
    new THREE.MeshLambertMaterial({ map: bandTexture(shades, blotches ?? null) }),
  );
  body.rotation.z = 0.3;
  group.add(body);
  if (ringColor) group.add(rings(radius, ringColor));
  if (moon) {
    const satellite = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.24, 24, 16),
      new THREE.MeshLambertMaterial({ color: moon }),
    );
    satellite.position.set(radius * 1.9, radius * 0.5, 0);
    group.add(satellite);
  }
  return group;
}

const BUILDS_PER_FRAME = 6; // columns redrawn in one frame at most: a big blast is spread over a few

export class Building {
  /** @param {import('/shared/voxels.js').Voxels} voxels @param {THREE.Scene} scene */
  constructor(voxels, scene) {
    this.voxels = voxels;
    this.scene = scene;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.columns = /** @type {[number,number]} */ ([Math.ceil(NX / COLUMN), Math.ceil(NZ / COLUMN)]);
    /** @type {Map<number,THREE.Mesh<THREE.BufferGeometry,THREE.MeshLambertMaterial>>} */
    this.meshes = new Map(); // column key → mesh
    this.dirty = new Set();
    this.markAll();
  }

  markAll() {
    for (let cz = 0; cz < this.columns[1]; cz++)
      for (let cx = 0; cx < this.columns[0]; cx++) this.dirty.add(cx + this.columns[0] * cz);
  }

  // Cells changed (a flat [ix, iy, iz, …] list): redraw their columns, and the neighbouring column
  // when a cell sits on the edge, since its faces there may now show.
  /** @param {number[]} cells */
  touch(cells) {
    for (let i = 0; i < cells.length; i += 3) {
      const ix = cells[i],
        iz = cells[i + 2];
      if (ix === undefined || iz === undefined) continue;
      for (const [dx, dz] of /** @type {import('./contracts.js').Vec2[]} */ ([
        [0, 0],
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ])) {
        const cx = Math.floor((ix + dx) / COLUMN);
        const cz = Math.floor((iz + dz) / COLUMN);
        if (cx >= 0 && cz >= 0 && cx < this.columns[0] && cz < this.columns[1])
          this.dirty.add(cx + this.columns[0] * cz);
      }
    }
  }

  // Redraws the columns that changed: up to `most` of them, the rest next frame.
  update(most = BUILDS_PER_FRAME) {
    let built = 0;
    for (const key of this.dirty) {
      if (built++ >= most) break;
      this.dirty.delete(key);
      this.build(key);
    }
  }

  /** @param {number} key */
  build(key) {
    const old = this.meshes.get(key);
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      this.meshes.delete(key);
    }
    const cx = key % this.columns[0];
    const cz = (key - cx) / this.columns[0];
    const data = meshColumn(this.voxels, cx * COLUMN, cz * COLUMN);
    if (data.count === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
    geometry.setIndex(data.indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    this.meshes.set(key, mesh);
  }
}

// The faces of one column of cells that border air, with shading and ambient occlusion baked in.
/** @param {import('/shared/voxels.js').Voxels} voxels @param {number} x0 @param {number} z0 */
function meshColumn(voxels, x0, z0) {
  /** @type {{positions:number[],normals:number[],colors:number[],indices:number[],count:number}} */
  const out = { positions: [], normals: [], colors: [], indices: [], count: 0 };
  /** @param {number} x @param {number} y @param {number} z */
  const solid = (x, y, z) => SOLID[voxels.get(x, y, z)];
  const ao = /** @type {[number,number,number,number]} */ ([0, 0, 0, 0]);
  for (let y = 0; y < NY; y++) {
    for (let z = z0; z < Math.min(z0 + COLUMN, NZ); z++) {
      for (let x = x0; x < Math.min(x0 + COLUMN, NX); x++) {
        const material = voxels.get(x, y, z);
        if (material === AIR) continue;
        // Floors read as 1 m tiles; cells bullets have worn look darker, so you can see them going.
        const worn = voxels.wear.size ? voxels.worn(x, y, z) : 0;
        const tint = (TILED[material] && ((x >> 1) + (z >> 1)) % 2 ? 0.9 : 1) * (1 - 0.55 * worn);
        for (const face of FACES) {
          const color = face.n[1] === -1 ? CEILINGS[material] : COLORS[material];
          if (!color) continue;
          const ox = x + face.n[0];
          const oy = y + face.n[1];
          const oz = z + face.n[2];
          if (solid(ox, oy, oz)) continue;
          const [t1, t2] = face.tangents;
          for (const v of /** @type {const} */ ([0, 1, 2, 3])) {
            const c = face.corners[v];
            const d1 = /** @type {Vec3} */ ([0, 0, 0]);
            const d2 = /** @type {Vec3} */ ([0, 0, 0]);
            d1[t1] = c[t1] ? 1 : -1;
            d2[t2] = c[t2] ? 1 : -1;
            const side1 = solid(ox + d1[0], oy + d1[1], oz + d1[2]) ? 1 : 0;
            const side2 = solid(ox + d2[0], oy + d2[1], oz + d2[2]) ? 1 : 0;
            const corner = solid(ox + d1[0] + d2[0], oy + d1[1] + d2[1], oz + d1[2] + d2[2]) ? 1 : 0;
            ao[v] = side1 && side2 ? 0 : 3 - side1 - side2 - corner;
          }
          const base = out.count;
          for (const v of /** @type {const} */ ([0, 1, 2, 3])) {
            const c = face.corners[v];
            out.positions.push(
              GRID_MIN[0] + (x + c[0]) * CELL,
              GRID_MIN[1] + (y + c[1]) * CELL,
              GRID_MIN[2] + (z + c[2]) * CELL,
            );
            out.normals.push(...face.n);
            const light = face.shade * (AO[ao[v]] ?? 1) * tint;
            out.colors.push(color.r * light, color.g * light, color.b * light);
          }
          // Split the quad along the diagonal that keeps the shading smooth.
          if (ao[0] + ao[2] >= ao[1] + ao[3])
            out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else out.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          out.count += 4;
        }
      }
    }
  }
  return out;
}
