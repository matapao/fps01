// What loot looks like: the powerup on the pedestal in the middle of the map (and any dropped by a
// dead carrier), crates drifting down on parachutes, and woollies on the run. Its rules are in
// shared/loot.js and on the server.

import * as THREE from 'three';
import { PEDESTAL, POWERUPS } from '/shared/loot.js';
import { redCrosses } from './pickups.js';

const runeGeometry = new THREE.IcosahedronGeometry(0.26, 0);
const haloGeometry = new THREE.SphereGeometry(0.42, 20, 14);
const ringGeometry = new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2);
const looks = Object.fromEntries(
  Object.entries(POWERUPS).map(([kind, { color }]) => [
    kind,
    {
      rune: new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.8,
        metalness: 0.3,
        roughness: 0.3,
        transparent: kind === 'shimmer',
        opacity: kind === 'shimmer' ? 0.45 : 1,
      }),
      halo: new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    },
  ]),
);

// A powerup: a glowing gem in its colour, inside a soft halo.
/** @param {string} kind */
function powerupModel(kind) {
  const group = new THREE.Group();
  const look = looks[kind];
  if (!look) throw new Error(`Unknown powerup: ${kind}`);
  group.add(new THREE.Mesh(runeGeometry, look.rune), new THREE.Mesh(haloGeometry, look.halo));
  return group;
}

export class Powerups {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(this.ring);
    this.place();
    /** @type {{kind:string,model:THREE.Group}|null} */
    this.pedestal = null; // { kind, model }
    /** @type {string|null} */
    this.soon = null; // the kind coming next, while it's announced
    /** @type {Map<number,{model:THREE.Group,y:number}>} */
    this.loose = new Map(); // id → model
  }

  // The pedestal's ring where it is on the map being played.
  place() {
    this.ring.visible = Boolean(PEDESTAL);
    if (PEDESTAL) this.ring.position.set(PEDESTAL[0], PEDESTAL[1] + 0.03, PEDESTAL[2]);
  }

  // state: { pedestal: kind | null, soon: { kind, ms } | null, loose: [[id, kind, x, y, z], …] }
  /** @param {import('../../shared/runtime-types.ts').Snapshot['powerups']|null} state */
  sync(state) {
    if (!state) return;
    if (this.pedestal?.kind !== state.pedestal) {
      if (this.pedestal) this.scene.remove(this.pedestal.model);
      /** @type {{kind:string,model:THREE.Group}|null} */
      this.pedestal = null;
      if (state.pedestal && PEDESTAL) {
        const model = powerupModel(state.pedestal);
        model.position.set(PEDESTAL[0], PEDESTAL[1] + 1, PEDESTAL[2]);
        this.scene.add(model);
        this.pedestal = { kind: state.pedestal, model };
      }
    }
    this.soon = state.soon?.kind ?? null;
    const seen = new Set();
    for (const [id, kind, x, y, z] of state.loose ?? []) {
      if (kind === null) continue;
      seen.add(id);
      if (this.loose.has(id)) continue;
      const model = powerupModel(kind);
      model.position.set(x, y + 0.8, z);
      const baseY = y + 0.8;
      this.scene.add(model);
      this.loose.set(id, { model, y: baseY });
    }
    for (const [id, { model }] of this.loose) {
      if (seen.has(id)) continue;
      this.scene.remove(model);
      this.loose.delete(id);
    }
  }

  /** @param {number} now */
  update(now) {
    /** @param {THREE.Group} model @param {number} y */
    const spin = (model, y, phase = 0) => {
      model.rotation.y = now / 500 + phase;
      model.rotation.x = Math.sin(now / 700 + phase) * 0.4;
      model.position.y = y + Math.sin(now / 400 + phase) * 0.1;
    };
    if (this.pedestal && PEDESTAL) spin(this.pedestal.model, PEDESTAL[1] + 1);
    for (const [id, { model, y }] of this.loose) spin(model, y, id);
    // The ring glows in the colour of what's there, or pulses in the colour of what's coming.
    const kind = this.pedestal?.kind ?? this.soon;
    this.ring.material.color.set(kind ? (POWERUPS[kind]?.color ?? '#ffffff') : '#ffffff');
    this.ring.material.opacity = this.pedestal ? 0.7 : this.soon ? 0.3 + 0.3 * Math.sin(now / 120) : 0.2;
  }
}

// Crates: a wooden box (or a white one with a red cross, for health) under a parachute until it lands.
const crateGeometry = new THREE.BoxGeometry(0.7, 0.7, 0.7);
const crateLooks = {
  special: new THREE.MeshLambertMaterial({ color: 0xb07a3c, emissive: 0x2a1a08 }),
  health: new THREE.MeshLambertMaterial({ color: 0xf2f2f2, emissive: 0x333333 }),
};
const crossMaterial = new THREE.MeshLambertMaterial({ color: 0xe8312a, emissive: 0x5a0a06 });
const markMaterial = new THREE.MeshBasicMaterial({ color: 0xffd23d });
const canopyGeometry = new THREE.SphereGeometry(1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const canopyMaterial = new THREE.MeshLambertMaterial({ color: 0xff5a3c, side: THREE.DoubleSide });
const cordMaterial = new THREE.LineBasicMaterial({ color: 0xdddddd });

/** @param {'special'|'health'} look */
function crateModel(look) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(crateGeometry, crateLooks[look]);
  box.position.y = 0.35;
  group.add(box);
  if (look === 'health') {
    const crosses = redCrosses(0.7, crossMaterial);
    crosses.position.y = 0.35;
    group.add(crosses);
  } else {
    // A big yellow question mark on two sides, made of blocks: you don't know what's in it.
    for (const side of [-1, 1]) {
      for (const [x, y, w, h] of /** @type {[number,number,number,number][]} */ ([
        [0, 0.52, 0.22, 0.06],
        [0.09, 0.45, 0.06, 0.12],
        [0, 0.38, 0.06, 0.08],
        [0, 0.22, 0.06, 0.06],
      ])) {
        const mark = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), markMaterial);
        mark.position.set(x, y, side * 0.36);
        group.add(mark);
      }
    }
  }
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
  canopy.position.y = 1.9;
  const cords = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(
      /** @type {import('./contracts.js').Vec3[]} */ ([
        [-0.35, 0.7, -0.35],
        [0.35, 0.7, -0.35],
        [-0.35, 0.7, 0.35],
        [0.35, 0.7, 0.35],
      ]).flatMap(([x, y, z]) => [new THREE.Vector3(x, y, z), new THREE.Vector3(x * 2.6, 1.9, z * 2.6)]),
    ),
    cordMaterial,
  );
  chute.add(canopy, cords);
  group.add(chute);
  return { group, chute, target: /** @type {import('./contracts.js').Vec3} */ ([0, 0, 0]) };
}

export class Crates {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<number,ReturnType<typeof crateModel>>} */
    this.byId = new Map();
  }

  // list: [[id, 'special' | 'health', x, y, z, landed], …]
  /** @param {NonNullable<import('../../shared/runtime-types.ts').Snapshot['crates']>} list */
  sync(list = []) {
    const seen = new Set();
    for (const [id, look, x, y, z, landed] of list) {
      seen.add(id);
      let crate = this.byId.get(id);
      if (!crate) {
        crate = crateModel(look);
        crate.group.position.set(x, y, z);
        this.scene.add(crate.group);
        this.byId.set(id, crate);
      }
      crate.target = [x, y, z];
      crate.chute.visible = landed !== 1;
    }
    for (const [id, crate] of this.byId) {
      if (seen.has(id)) continue;
      this.scene.remove(crate.group);
      this.byId.delete(id);
    }
  }

  /** @param {number} now @param {number} dt */
  update(now, dt) {
    for (const crate of this.byId.values()) {
      crate.group.position.lerp(new THREE.Vector3(...crate.target), 1 - Math.exp(-dt * 12));
      crate.group.rotation.z = crate.chute.visible ? Math.sin(now / 600) * 0.08 : 0; // swaying under the chute
    }
  }
}

// Woolly: a fluffy white body with a black head and legs, running and bouncing along.
const woolGeometry = new THREE.SphereGeometry(0.22, 10, 8);
const woolMaterial = new THREE.MeshLambertMaterial({ color: 0xf4f1e8 });
const blackMaterial = new THREE.MeshLambertMaterial({ color: 0x1d1d22 });
const headGeometry = new THREE.BoxGeometry(0.16, 0.16, 0.22);
const legGeometry = new THREE.BoxGeometry(0.06, 0.2, 0.06);

function woollyModel() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  for (const [x, y, z] of /** @type {import('./contracts.js').Vec3[]} */ ([
    [0, 0.32, 0],
    [0.12, 0.34, 0.1],
    [-0.12, 0.34, 0.1],
    [0.12, 0.34, -0.1],
    [-0.12, 0.34, -0.1],
    [0, 0.42, 0],
  ])) {
    const puff = new THREE.Mesh(woolGeometry, woolMaterial);
    puff.position.set(x, y, z);
    puff.scale.setScalar(0.8);
    body.add(puff);
  }
  const head = new THREE.Mesh(headGeometry, blackMaterial);
  head.position.set(0, 0.42, -0.3);
  const legs = /** @type {import('./contracts.js').Vec2[]} */ ([
    [-0.1, -0.12],
    [0.1, -0.12],
    [-0.1, 0.12],
    [0.1, 0.12],
  ]).map(([x, z]) => {
    const leg = new THREE.Mesh(legGeometry, blackMaterial);
    leg.position.set(x, 0.1, z);
    return leg;
  });
  body.add(head, ...legs);
  group.add(body);
  return { group, body, legs, target: new THREE.Vector3() };
}

export class Woollies {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<number,ReturnType<typeof woollyModel>>} */
    this.byId = new Map();
  }

  // list: [[id, x, y, z, dirX, dirZ], …]
  /** @param {[number,number,number,number,number,number][]} list */
  sync(list = []) {
    const seen = new Set();
    for (const [id, x, y, z, dx, dz] of list) {
      seen.add(id);
      let woolly = this.byId.get(id);
      if (!woolly) {
        woolly = woollyModel();
        woolly.group.position.set(x, y, z);
        this.scene.add(woolly.group);
        this.byId.set(id, woolly);
      }
      woolly.target = new THREE.Vector3(x, y, z);
      woolly.group.rotation.y = Math.atan2(-dx, -dz);
    }
    for (const [id, woolly] of this.byId) {
      if (seen.has(id)) continue;
      this.scene.remove(woolly.group);
      this.byId.delete(id);
    }
  }

  /** @param {number} now @param {number} dt */
  update(now, dt) {
    for (const woolly of this.byId.values()) {
      woolly.group.position.lerp(woolly.target, 1 - Math.exp(-dt * 15));
      woolly.body.position.y = Math.abs(Math.sin(now / 90)) * 0.06; // bouncing as it runs
      woolly.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(now / 70 + (i % 2) * Math.PI) * 0.6));
    }
  }

  // Where one is (for its baa), if it's still around.
  /** @param {number} id */
  at(id) {
    return this.byId.get(id)?.group.position.toArray() ?? null;
  }
}
