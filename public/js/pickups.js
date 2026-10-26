// Pickups on their pads: weapons, health, armor and Health Orbs, turning and bobbing
// over a glowing ring in their colour, so you can find them from afar. A pad is empty for a while
// after someone takes what's on it (see ITEMS in shared/map.js). Each is a piece (data/pieces.json):
// its look is an asset (assets/assets.json), its colour the piece's own (rockets red, spark guns
// blue, railguns green).

import * as THREE from 'three';
import { ITEMS } from '/shared/map.js';

const ring = new THREE.RingGeometry(0.45, 0.6, 28).rotateX(-Math.PI / 2);

// A red cross on every face of a box `size` across: two flat bars laid just outside each face.
/** @param {number} size @param {THREE.Material} material */
export function redCrosses(size, material) {
  const group = new THREE.Group();
  const long = size * 0.7;
  const short = size * 0.22;
  const out = size / 2 + 0.005;
  for (const axis of [0, 1, 2]) {
    for (const side of [-1, 1]) {
      const a = (axis + 1) % 3;
      const b = (axis + 2) % 3;
      for (const [along, across] of /** @type {[number, number][]} */ ([
        [a, b],
        [b, a],
      ])) {
        const dims = /** @type {import('./contracts.js').Vec3} */ ([0.01, 0.01, 0.01]);
        dims[along] = long;
        dims[across] = short;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(...dims), material);
        bar.position.setComponent(axis, side * out);
        group.add(bar);
      }
    }
  }
  return group;
}

/** @param {THREE.ColorRepresentation} color */
function weaponModel(color) {
  const look = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2b3038 });
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.62), look);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10).rotateX(Math.PI / 2), dark);
  barrel.position.z = -0.42;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.09), dark);
  grip.position.set(0, -0.14, 0.14);
  group.add(body, barrel, grip);
  group.scale.setScalar(1.3);
  return group;
}

/** @param {boolean} big @param {THREE.ColorRepresentation} color */
function healthModel(big, color) {
  const group = new THREE.Group();
  if (big) {
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 24, 16),
        new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.6 }),
      ),
    );
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.46, 24, 16),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.18,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    return group;
  }
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f6fa, emissive: 0x777777 });
  const red = new THREE.MeshLambertMaterial({ color: 0xe8312a, emissive: 0x6a0a06 });
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), white), redCrosses(0.34, red));
  return group;
}

/** @param {THREE.ColorRepresentation} color */
function armorModel(color) {
  const group = new THREE.Group();
  const shard = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.28),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      metalness: 0.6,
      roughness: 0.3,
    }),
  );
  shard.scale.set(1, 1.3, 0.55);
  group.add(shard);
  return group;
}

// The pickups' models, by asset id.
/** @type {Record<string, (color: THREE.ColorRepresentation) => THREE.Group>} */
const MODELS = {
  'pickups/weapon': (color) => weaponModel(color),
  'pickups/health': (color) => healthModel(false, color),
  'pickups/orb': (color) => healthModel(true, color),
  'pickups/armor': (color) => armorModel(color),
};

export class Pickups {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** @type {{model:THREE.Group,base:THREE.Mesh<THREE.RingGeometry,THREE.MeshBasicMaterial>,y:number,phase:number}[]} */
    this.items = [];
  }

  // What lies where on the map being played (ITEMS).
  place() {
    for (const { model, base } of this.items) {
      this.scene.remove(model, base);
      model.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        part.geometry.dispose();
        for (const material of Array.isArray(part.material) ? part.material : [part.material])
          material.dispose();
      });
      base.material.dispose();
    }
    const scene = this.scene;
    this.items = ITEMS.map((item) => {
      const color = new THREE.Color(item.color ?? '#ffffff').getHex();
      const model = (item.asset ? MODELS[item.asset]?.(color) : undefined) ?? healthModel(false, color);
      const base = new THREE.Mesh(
        ring,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      base.position.set(item.at[0], item.at[1] + 0.03, item.at[2]);
      model.position.set(item.at[0], item.at[1] + 0.7, item.at[2]);
      scene.add(base, model);
      return { model, base, y: item.at[1], phase: Math.random() * 6 };
    });
  }

  // left: for each spot, in the order of ITEMS, 0 when it's there, or the seconds until it's back.
  /** @param {number[]} left */
  sync(left) {
    this.items.forEach((item, i) => {
      const there = !left[i];
      item.model.visible = there;
      item.base.material.opacity = there ? 0.6 : 0.15;
    });
  }

  /** @param {number} now */
  update(now) {
    for (const { model, y, phase } of this.items) {
      model.position.y = y + 0.7 + Math.sin(now / 450 + phase) * 0.08;
      model.rotation.y = now / 800 + phase;
    }
  }
}
