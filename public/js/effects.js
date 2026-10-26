// Shot effects (tracers, beams, sparks, explosions), the lights they throw,
// everything in flight, ropes, and the fixtures of the arena: jump pads and flags.

import * as THREE from 'three';
import { context2d } from './dom.js';
import { GRAVITY } from '/shared/constants.js';
import { AIR, FLAG_BASES, TEAMS } from '/shared/map.js';
import { cellOf } from '/shared/voxels.js';
import { PROJECTILES } from '/shared/weapons.js';
import { TEAM_COLORS } from './avatars.js';

// A unit-length beam along +z, so lookAt() and scale.z can stretch it between two points.
const tracerGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
const impactGeometry = new THREE.SphereGeometry(0.08, 8, 6);
const chipGeometry = new THREE.BoxGeometry(1, 1, 1);
const blastGeometry = new THREE.SphereGeometry(1, 20, 14);
const ringGeometry = new THREE.RingGeometry(0.7, 1, 40).rotateX(-Math.PI / 2);
const SPARK = 0x8fe3ff;

// A soft round dot, for sparks and embers.
function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = context2d(canvas);
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}
/** @returns {import('./contracts.js').Vec3} */
const randomDirection = () => {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const ring = Math.sqrt(1 - z * z);
  return [Math.cos(angle) * ring, z, Math.sin(angle) * ring];
};

// A handful of point lights shared by everything that glows for a moment: blasts and muzzle
// flashes. They stay in the scene (adding a light later makes every shader recompile); each frame
// the brightest sources nearest you get them.
export class Lights {
  /** @param {THREE.Scene} scene */
  constructor(scene, count = 5) {
    this.lights = Array.from({ length: count }, () => {
      const light = new THREE.PointLight(0xffffff, 0, 20, 1.5);
      scene.add(light);
      return light;
    });
    /** @type {import('./render-contracts.js').Flash[]} */
    this.flashes = []; // { at, color, peak, life, total, range }
  }

  // A light that blazes up and dies away over seconds.
  /** @param {import('./contracts.js').Vec3} at @param {THREE.ColorRepresentation} color @param {number} intensity */
  flash(at, color, intensity, seconds = 0.35, range = 20) {
    this.flashes.push({
      at: [...at],
      color: new THREE.Color(color),
      peak: intensity,
      life: seconds,
      total: seconds,
      range,
    });
  }

  /** @param {number} dt @param {import('./contracts.js').Vec3} eye */
  update(dt, eye) {
    this.flashes = this.flashes.filter((flash) => (flash.life -= dt) > 0);
    const sources = this.flashes.map((flash) => ({
      at: flash.at,
      color: flash.color,
      intensity: flash.peak * (flash.life / flash.total) ** 1.5,
      range: flash.range,
    }));
    /** @param {{intensity:number,at:import('./contracts.js').Vec3}} source */
    const weight = (source) =>
      source.intensity / (4 + Math.hypot(...source.at.map((v, i) => v - (eye[i] ?? 0))));
    sources.sort((a, b) => weight(b) - weight(a));
    this.lights.forEach((light, i) => {
      const source = sources[i];
      light.intensity = source ? source.intensity : 0;
      if (!source) return;
      light.position.fromArray(source.at);
      light.color.copy(source.color);
      light.distance = source.range;
    });
  }
}

const SPARKS = 2400;

// Sparks, embers and glints: thousands of glowing points that fly, fall (some barely), bounce off
// the arena and fade, all drawn at once.
export class Sparks {
  /** @param {THREE.Scene} scene @param {import('/shared/voxels.js').Voxels} voxels */
  constructor(scene, voxels) {
    this.voxels = voxels;
    this.positions = new Float32Array(SPARKS * 3).fill(-1000);
    this.colors = new Float32Array(SPARKS * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.12,
        map: dotTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    /** @type {(import('./render-contracts.js').Spark|null)[]} */
    this.items = new Array(SPARKS).fill(null);
    this.next = 0;
  }

  // gravity: a share of the real thing; drag: how fast it slows in the air; bounce: whether it
  // bounces off the arena (or passes through it).
  /** @param {import('./contracts.js').Vec3} at @param {import('./contracts.js').Vec3} velocity @param {THREE.ColorRepresentation} color */
  emit(at, velocity, color, { life = 0.8, gravity = 1, drag = 0, bounce = true } = {}) {
    const slot = this.next;
    this.next = (this.next + 1) % SPARKS;
    this.items[slot] = {
      at: [...at],
      velocity: [...velocity],
      color: new THREE.Color(color),
      life,
      total: life,
      gravity,
      drag,
      bounce,
    };
  }

  /** @param {number} dt */
  update(dt) {
    const voxels = this.voxels;
    for (let i = 0; i < SPARKS; i++) {
      const item = this.items[i];
      if (!item) continue;
      item.life -= dt;
      if (item.life <= 0) {
        this.items[i] = null;
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      item.velocity[1] -= GRAVITY * item.gravity * dt;
      const slow = Math.max(0, 1 - item.drag * dt);
      for (const a of /** @type {const} */ ([1, 0, 2])) {
        item.velocity[a] *= slow;
        item.at[a] += item.velocity[a] * dt;
        if (
          !item.bounce ||
          voxels.get(cellOf(item.at[0], 0), cellOf(item.at[1], 1), cellOf(item.at[2], 2)) === AIR
        )
          continue;
        item.at[a] -= item.velocity[a] * dt;
        item.velocity[a] *= -0.4;
      }
      this.positions.set(item.at, i * 3);
      const glow = Math.min(1, item.life / (item.total * 0.6));
      this.colors.set([item.color.r * glow, item.color.g * glow, item.color.b * glow], i * 3);
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('color').needsUpdate = true;
  }
}

const METEOR_MS = 800; // how long a piece of a planet takes to streak in, once it shows

export class Effects {
  /** @param {THREE.Scene} scene @param {import('/shared/voxels.js').Voxels} voxels */
  constructor(scene, voxels) {
    this.scene = scene;
    this.voxels = voxels;
    /** @type {import('./render-contracts.js').Effect[]} */
    this.items = [];
    this.lights = new Lights(scene);
    this.sparks = new Sparks(scene, voxels);
    /** @type {import('./render-contracts.js').Meteor[]} */
    this.meteors = []; // pieces of a planet streaking in
  }

  // A piece of a blown-up planet streaking in: a fireball from far out to where it strikes, landing
  // in ms (the strike itself is a 'boom' from the server).
  /** @param {import('./contracts.js').Vec3} from @param {import('./contracts.js').Vec3} to @param {number} ms */
  meteor(from, to, ms) {
    const ball = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flameTexture,
        color: 0xffc070,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ball.scale.setScalar(1.8);
    ball.visible = false;
    this.scene.add(ball);
    this.meteors.push({ ball, from, to, landAt: performance.now() + ms, puffAt: 0 });
  }

  /** @param {import('./contracts.js').Vec3} from @param {import('./contracts.js').Vec3} to @param {boolean} mine */
  tracer(from, to, mine) {
    this.streak(from, to, mine ? 0xfff1b0 : 0xffb070, 0.02, 0.07);
  }

  // A straight line of light from one point to another, fading over life seconds.
  /** @param {import('./contracts.js').Vec3} from @param {import('./contracts.js').Vec3} to @param {THREE.ColorRepresentation} color @param {number} width @param {number} life */
  streak(from, to, color, width, life, glow = false) {
    const start = new THREE.Vector3().fromArray(from);
    const end = new THREE.Vector3().fromArray(to);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const beam = new THREE.Mesh(tracerGeometry, material);
    beam.position.copy(start);
    beam.lookAt(end);
    beam.scale.set(width, width, Math.max(0.01, start.distanceTo(end)));
    this.add(beam, life);
  }

  // The shotgun's pellets: a spray of quick streaks.
  /** @param {import('./contracts.js').Vec3} from @param {import('./contracts.js').Vec3[]} ends */
  pellets(from, ends) {
    for (const to of ends) this.streak(from, to, 0xffd9a0, 0.012, 0.06);
  }

  // One tick of the spark gun: a jagged bolt from the gun to where it hit.
  /** @param {import('./contracts.js').Vec3} from @param {import('./contracts.js').Vec3} to */
  beam(from, to) {
    this.bolt(from, to, 0.07, 0.12);
    this.streak(from, to, 0xe6f8ff, 0.008, 0.06, true);
  }

  // The overload: bolts arcing from the gun to its first victim and on to the next.
  /** @param {import('./contracts.js').Vec3[]} points */
  arc(points) {
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1],
        to = points[i];
      if (from && to) this.bolt(from, to, 0.3, 0.35);
    }
    for (const point of points.slice(1)) this.flashLight(point, SPARK, 30);
  }

  /** @param {import('./contracts.js').Vec3} from @param {import('./contracts.js').Vec3} to @param {number} life @param {number} jitter */
  bolt(from, to, life, jitter) {
    const length = Math.hypot(...to.map((v, i) => v - (from[i] ?? 0)));
    const pieces = Math.max(2, Math.min(12, Math.round(length / 1.5)));
    let last = from;
    for (let i = 1; i <= pieces; i++) {
      const k = i / pieces;
      // Calm where it leaves the gun, wild in the middle.
      const wild = jitter * Math.min(length, 6) * Math.sin(k * Math.PI);
      const point =
        i === pieces
          ? to
          : /** @type {import('./contracts.js').Vec3} */ (
              from.map((v, j) => v + ((to[j] ?? 0) - v) * k + (Math.random() - 0.5) * wild)
            );
      this.streak(last, point, SPARK, 0.018, life, true);
      last = point;
    }
  }

  // The railgun's trail: a bright core with a spiral around it, hanging in the air.
  /** @param {import('./contracts.js').Vec3} from @param {import('./contracts.js').Vec3} to @param {THREE.ColorRepresentation} color */
  rail(from, to, color) {
    this.streak(from, to, 0xffffff, 0.012, 0.5, true);
    this.streak(from, to, color, 0.03, 0.9, true);
    const start = new THREE.Vector3().fromArray(from);
    const end = new THREE.Vector3().fromArray(to);
    const along = end.clone().sub(start);
    const length = along.length();
    along.normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(along);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = along.clone().cross(side);
    const points = [];
    for (let d = 0.6; d < length; d += 0.08) {
      const angle = d * 5;
      points.push(
        start
          .clone()
          .addScaledVector(along, d)
          .addScaledVector(side, Math.cos(angle) * 0.07)
          .addScaledVector(up, Math.sin(angle) * 0.07),
      );
    }
    if (points.length < 2) return;
    const spiral = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.add(spiral, 1.1, null, true);
  }

  // A breaching slug or a bomb crashing through: dust where the wall gave way.
  /** @param {import('./contracts.js').Vec3} at */
  breach(at) {
    for (let i = 0; i < 10; i++) {
      const puff = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: smokeTexture,
          color: 0xb8b0a4,
          transparent: true,
          depthWrite: false,
        }),
      );
      puff.position.fromArray(at);
      const velocity = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.3,
        Math.random() - 0.5,
      ).setLength(1 + Math.random() * 2);
      this.add(puff, 0.9 + Math.random() * 0.4, (mesh, left, dt) => {
        mesh.position.addScaledVector(velocity, dt);
        mesh.scale.setScalar(0.4 + (1 - left) * 1.6);
      });
    }
    this.flashLight(at, 0xffd8a0, 25);
  }

  // A puff of smoke (behind a rocket) or flame (behind a piece of a planet).
  /** @param {import('./contracts.js').Vec3} at */
  puff(at, fire = false) {
    const puff = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: fire ? flameTexture : smokeTexture,
        color: fire ? 0xffa040 : 0xc9ced6,
        transparent: true,
        depthWrite: false,
        blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    puff.position.fromArray(at);
    this.add(
      puff,
      fire ? 0.3 : 0.7,
      (mesh, left) => mesh.scale.setScalar((fire ? 0.35 : 0.2) + (1 - left) * (fire ? 0.2 : 0.5)),
      false,
      fire ? 1 : 0.4,
    );
  }

  // A sphere of light growing out from a point: a teleport.
  /** @param {import('./contracts.js').Vec3} at @param {THREE.ColorRepresentation} color @param {number} radius */
  pulse(at, color, radius, life = 0.6) {
    const shell = new THREE.Mesh(
      blastGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    shell.position.fromArray(at);
    this.add(shell, life, (mesh, left) => mesh.scale.setScalar(0.2 + (1 - left) * radius), false, 0.5);
    this.flashLight(at, color, 30);
  }

  /** @param {import('./contracts.js').Vec3} at */
  impact(at) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, depthWrite: false });
    const spark = new THREE.Mesh(impactGeometry, material);
    spark.position.fromArray(at);
    this.add(spark, 0.18);
  }

  // Compressed air out of the muzzle, with a pale shock ring where it meets the ground.
  /** @param {import('./contracts.js').Vec3} from @param {import('./contracts.js').Vec3} at */
  pressure(from, at) {
    const heading = new THREE.Vector3(...at).sub(new THREE.Vector3(...from));
    const length = heading.length();
    heading.normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), heading);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xc6efff,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.quaternion.copy(turn);
      ring.position.fromArray(from);
      this.add(
        ring,
        0.22 + i * 0.025,
        (mesh, left) => {
          mesh.position.fromArray(from).addScaledVector(heading, Math.min(length, (1 - left) * length * 1.5));
          mesh.scale.setScalar(0.04 + (1 - left) * (0.35 + i * 0.12));
        },
        false,
        0.45,
      );
    }
    const shock = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xdcefff,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    shock.position.fromArray(at).add(new THREE.Vector3(0, 0.025, 0));
    this.add(shock, 0.35, (mesh, left) => mesh.scale.setScalar(0.1 + (1 - left) * 1.6), false, 0.55);
  }

  // A blast, as big as its reach (radius, in metres).
  /** @param {import('./contracts.js').Vec3} at */
  explosion(at, radius = 4.5) {
    const size = radius / 4.5;
    const fire = new THREE.Mesh(
      blastGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xff9a3c,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    fire.position.fromArray(at);
    this.add(fire, 0.5, (mesh, left) => mesh.scale.setScalar((0.5 + (1 - left) * 3) * size));
    const flash = new THREE.Mesh(
      blastGeometry,
      new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, depthWrite: false }),
    );
    flash.position.fromArray(at);
    this.add(flash, 0.12, (mesh, left) => mesh.scale.setScalar((1.6 - left * 0.6) * size));
    // A ring of shock racing out along the floor, and a shell of it in the air.
    const ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffe2b0,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    ring.position.fromArray(at);
    this.add(ring, 0.45, (mesh, left) => mesh.scale.setScalar(0.3 + (1 - left) * radius * 1.5), false, 0.8);
    const shell = new THREE.Mesh(
      blastGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xfff0d0,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    shell.position.fromArray(at);
    this.add(shell, 0.2, (mesh, left) => mesh.scale.setScalar(0.5 + (1 - left) * radius * 1.2), false, 0.35);
    // Sparks spraying out and skittering over the floor, and embers drifting down after.
    for (let i = 0; i < Math.round(45 * size); i++) {
      const speed = (8 + Math.random() * 14) * Math.min(1.6, size);
      this.sparks.emit(
        at,
        /** @type {import('./contracts.js').Vec3} */ (
          randomDirection().map((v, a) => v * speed + (a === 1 ? 3 : 0))
        ),
        new THREE.Color(1, 0.75 + Math.random() * 0.2, 0.4),
        { life: 0.4 + Math.random() * 0.8 },
      );
    }
    for (let i = 0; i < Math.round(30 * size); i++) {
      const from = /** @type {import('./contracts.js').Vec3} */ (
        at.map((v) => v + (Math.random() - 0.5) * radius * 0.6)
      );
      this.sparks.emit(
        from,
        [(Math.random() - 0.5) * 3, 1 + Math.random() * 4, (Math.random() - 0.5) * 3],
        new THREE.Color(1, 0.4 + Math.random() * 0.2, 0.08),
        { life: 1.5 + Math.random() * 1.8, gravity: 0.12, drag: 0.9 },
      );
    }
    // Then smoke rolling up.
    for (let i = 0; i < Math.round(7 * size); i++) {
      const puff = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: smokeTexture,
          color: 0x5d5853,
          transparent: true,
          depthWrite: false,
        }),
      );
      puff.position.fromArray(at.map((v) => v + (Math.random() - 0.5) * radius * 0.5));
      const rise = new THREE.Vector3(
        (Math.random() - 0.5) * 0.8,
        0.8 + Math.random() * 0.9,
        (Math.random() - 0.5) * 0.8,
      );
      this.add(
        puff,
        1.8 + Math.random() * 1.2,
        (mesh, left, dt) => {
          mesh.position.addScaledVector(rise, dt);
          mesh.scale.setScalar((0.8 + (1 - left) * 2.2) * size);
        },
        false,
        0.65,
      );
    }
    this.flashLight(at, 0xffc27a, 110 * Math.max(0.5, size), 0.5, 18 * Math.max(1, size));
  }

  // Bits of a block flying off where a bullet hit it: in its colour, away from the face it hit.
  /** @param {import('./contracts.js').Vec3} at @param {THREE.ColorRepresentation} color @param {import('./contracts.js').Vec3} normal */
  chips(at, color, normal, count = 5, size = 0.05) {
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshLambertMaterial({ color, transparent: true });
      const chip = new THREE.Mesh(chipGeometry, material);
      chip.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      chip.position.fromArray(at);
      const velocity = new THREE.Vector3(...normal)
        .multiplyScalar(2 + Math.random() * 2)
        .add(
          new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(3),
        );
      const spin = new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(14);
      this.add(chip, 0.7 + Math.random() * 0.3, (mesh, _left, dt) => {
        velocity.y -= 14 * dt;
        mesh.position.addScaledVector(velocity, dt);
        mesh.rotation.x += spin.x * dt;
        mesh.rotation.y += spin.y * dt;
      });
    }
  }

  /** @param {import('./contracts.js').Vec3} at @param {THREE.ColorRepresentation} color @param {number} intensity */
  flashLight(at, color, intensity, seconds = 0.3, range = 18) {
    this.lights.flash([at[0], at[1] + 0.5, at[2]], color, intensity, seconds, range);
  }

  // animate(mesh, shareOfLifeLeft, dt) runs every frame until the effect fades out. ownGeometry:
  // the mesh's geometry was made for it alone, and goes with it. peak: its opacity at the start.
  /** @param {import('./render-contracts.js').EffectMesh} mesh @param {number} life @param {import('./render-contracts.js').Effect['animate']} animate */
  add(mesh, life, animate = null, ownGeometry = false, peak = 1) {
    this.scene.add(mesh);
    this.items.push({ mesh, life, total: life, animate, ownGeometry, peak });
  }

  /** @param {number} dt @param {import('./contracts.js').Vec3} eye */
  update(dt, eye) {
    this.lights.update(dt, eye);
    this.sparks.update(dt);
    const now = performance.now();
    this.meteors = this.meteors.filter((meteor) => {
      const k = 1 - (meteor.landAt - now) / METEOR_MS;
      if (k >= 1) {
        this.scene.remove(meteor.ball);
        meteor.ball.material.dispose();
        return false;
      }
      meteor.ball.visible = k > 0;
      if (k > 0) {
        const at = /** @type {import('./contracts.js').Vec3} */ (
          meteor.from.map((v, i) => v + ((meteor.to[i] ?? 0) - v) * k)
        );
        meteor.ball.position.fromArray(at);
        if (now >= meteor.puffAt) {
          meteor.puffAt = now + 25;
          this.puff(at, true);
        }
      }
      return true;
    });
    this.items = this.items.filter((item) => {
      item.life -= dt;
      if (item.life > 0) {
        item.mesh.material.opacity = (item.peak * item.life) / item.total;
        item.animate?.(item.mesh, item.life / item.total, dt);
        return true;
      }
      this.scene.remove(item.mesh);
      item.mesh.material.dispose();
      if (item.ownGeometry) item.mesh.geometry.dispose();
      return false;
    });
  }
}

// What each projectile looks like, by its model (projectiles/… in assets/assets.json): a ball with a
// blinking light, in its own colours (and a glow around the light), or a rocket that leaves a trail
// of smoke.
/** @type {Record<string,{size:number,color:number,light:number,glow?:number}>} */
const BALLS = {
  grenade: { size: 0.12, color: 0x46602f, light: 0xff3b2f },
  bouncer: { size: 0.12, color: 0x2f4a60, light: 0x4dd2ff },
  mortar: { size: 0.16, color: 0x3a3f46, light: 0xff8a2a },
  bomblet: { size: 0.09, color: 0x8a2a20, light: 0xffd27a },
  splitter: { size: 0.13, color: 0xffe14d, light: 0xfff6b0 },
  'splitter-bit': { size: 0.1, color: 0xffe14d, light: 0xfff6b0 },
  choir: { size: 0.16, color: 0xffc933, light: 0xffffff },
  missile: { size: 0.18, color: 0x5b6470, light: 0xff3b2f },
  pilot: { size: 0.3, color: 0x2f3a33, light: 0x5dff7a },
};
/** @type {Map<string,import('./render-contracts.js').ProjectileLook>} */
const looks = new Map(); // model → { geometry, material, blink… }, made the first time one flies
/** @param {string|null} kind */
const modelOf = (kind) =>
  ((kind === null ? undefined : PROJECTILES[kind]?.model) ?? 'projectiles/grenade').replace(
    /^projectiles\//,
    '',
  );

/** @param {string|null} kind @returns {import('./render-contracts.js').ProjectileLook} */
function lookOf(kind) {
  const model = modelOf(kind);
  const cached = looks.get(model);
  if (cached) return cached;
  /** @type {import('./render-contracts.js').ProjectileLook} */
  let look;
  if (model === 'ball') {
    look = { type: 'thrown', thrown: thrownBall() };
  } else if (model === 'rocket') {
    look = {
      type: 'rocket',
      body: new THREE.CylinderGeometry(0.05, 0.05, 0.34, 10).rotateX(Math.PI / 2),
      nose: new THREE.ConeGeometry(0.05, 0.12, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.23),
      bodyMaterial: new THREE.MeshLambertMaterial({ color: 0x5b6470 }),
      noseMaterial: new THREE.MeshLambertMaterial({ color: 0xc8392b }),
      glow: new THREE.SpriteMaterial({
        map: flameTexture,
        color: 0xffb060,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      trail: 'smoke',
    };
  } else {
    const ball = BALLS[model] ?? BALLS['grenade'];
    if (!ball) throw new Error('Default projectile look missing');
    look = {
      ...ball,
      type: 'ball',
      geometry: new THREE.SphereGeometry(ball.size, 12, 8),
      material: new THREE.MeshStandardMaterial({ color: ball.color, roughness: 0.4, metalness: 0.25 }),
      blinkGeometry: new THREE.SphereGeometry(ball.size * 0.35, 8, 6),
      blinkMaterial: new THREE.MeshBasicMaterial({ color: ball.light }),
      glow: ball.glow
        ? new THREE.SpriteMaterial({
            map: flameTexture,
            color: ball.glow,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        : null,
    };
  }
  looks.set(model, look);
  return look;
}

// A thrown juggling ball (shared/tricks.js). Made once, then copied.
function thrownBall() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8524a, roughness: 0.35 }),
  );
}

/** @param {string|null} kind */
function projectileMesh(kind) {
  const look = lookOf(kind);
  if (look.type === 'thrown') return { mesh: look.thrown.clone(), blink: null, trail: null };
  if (look.type === 'rocket') {
    const group = new THREE.Group();
    const glow = new THREE.Sprite(look.glow);
    glow.position.z = 0.24;
    glow.scale.setScalar(0.35);
    group.add(
      new THREE.Mesh(look.body, look.bodyMaterial),
      new THREE.Mesh(look.nose, look.noseMaterial),
      glow,
    );
    return { mesh: group, blink: null, trail: look.trail };
  }
  const mesh = new THREE.Mesh(look.geometry, look.material);
  const blink = new THREE.Mesh(look.blinkGeometry, look.blinkMaterial);
  blink.position.y = look.size * 0.85;
  mesh.add(blink);
  if (look.glow) {
    const glow = new THREE.Sprite(look.glow);
    glow.scale.setScalar(0.32);
    blink.add(glow);
  }
  return { mesh, blink, trail: null };
}

// Everything in flight (grenades, rockets, bombs), drawn between the server's position updates so
// it moves smoothly. Rockets point where they're going and leave smoke. onBounce(at) hears a
// grenade bounce off something.
export class Projectiles {
  /** @param {THREE.Scene} scene @param {Effects} effects @param {((at:import('./contracts.js').Vec3)=>void)|null} onBounce */
  constructor(scene, effects, onBounce = null) {
    this.scene = scene;
    this.effects = effects;
    this.onBounce = onBounce;
    /** @type {Map<number,import('./render-contracts.js').ProjectileShot>} */
    this.byId = new Map();
    this.at = 0;
    this.interval = 1000 / 30;
  }

  // The launch message gives a rocket its heading before the first position update arrives.
  /** @param {number} id @param {string|null} kind @param {import('./contracts.js').Vec3} from @param {import('./contracts.js').Vec3|null} velocity */
  launch(id, kind, from, velocity = null) {
    if (this.byId.has(id)) return;
    const made = projectileMesh(kind);
    made.mesh.position.fromArray(from);
    const heading = velocity ?? /** @type {import('./contracts.js').Vec3} */ ([0, 0, -1]);
    if (made.trail === 'smoke' && Math.hypot(...heading) > 1e-3) {
      made.mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(...heading).normalize(),
      );
    }
    made.mesh.visible = made.trail !== 'smoke' || velocity !== null;
    this.scene.add(made.mesh);
    this.byId.set(id, {
      ...made,
      id,
      kind,
      from: [...from],
      to: [...from],
      heading,
      authoritative: velocity === null ? [...from] : null,
      moved: null,
      puffAt: 0,
    });
  }

  // list: [[id, kind, x, y, z], …]
  /** @param {import('../../shared/runtime-types.ts').ProjectileSnapshot[]} list @param {number} now */
  sync(list, now) {
    if (this.at) this.interval = Math.min(100, Math.max(16, now - this.at));
    const seen = new Set();
    for (const [id, kind, x, y, z] of list) {
      seen.add(id);
      const shot = this.byId.get(id);
      if (shot) {
        // Turned back on itself since the last update: it bounced off something.
        const moved = /** @type {import('./contracts.js').Vec3} */ (
          shot.authoritative
            ? [x - shot.authoritative[0], y - shot.authoritative[1], z - shot.authoritative[2]]
            : [0, 0, 0]
        );
        if (
          (kind === null ? undefined : PROJECTILES[kind]?.bounce) &&
          shot.moved &&
          moved.some(
            (v, a) =>
              v * (shot.moved?.[a] ?? 0) < 0 && Math.abs(shot.moved?.[a] ?? 0) > 0.04 && Math.abs(v) > 0.01,
          )
        )
          this.onBounce?.(shot.to);
        shot.moved = moved;
        shot.authoritative = [x, y, z];
        if (Math.hypot(...moved) > 1e-3) {
          shot.heading = moved;
          shot.mesh.visible = true;
        }
        shot.from = this.position(shot, now);
        shot.to = [x, y, z];
        continue;
      }
      this.launch(id, kind, [x, y, z]);
    }
    for (const [id, shot] of this.byId) {
      if (seen.has(id)) continue;
      this.scene.remove(shot.mesh);
      this.byId.delete(id);
    }
    this.at = now;
  }

  /** @param {import('./render-contracts.js').ProjectileShot} shot @param {number} now @returns {import('./contracts.js').Vec3} */
  position(shot, now) {
    const k = Math.min(1, Math.max(0, (now - this.at) / this.interval));
    return /** @type {import('./contracts.js').Vec3} */ (
      shot.from.map((v, i) => v + ((shot.to[i] ?? 0) - v) * k)
    );
  }

  /** @param {number} now */
  update(now) {
    for (const shot of this.byId.values()) {
      const at = this.position(shot, now);
      shot.mesh.position.fromArray(at);
      if (shot.trail === 'smoke') {
        shot.mesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(...shot.heading).normalize(),
        );
      } else {
        shot.mesh.rotation.x = now / 90;
      }
      if (shot.blink) shot.blink.visible = Math.floor(now / 120) % 2 === 0;
      if (shot.trail && shot.mesh.visible && now >= shot.puffAt) {
        shot.puffAt = now + 28;
        this.effects.puff(shot.mesh.localToWorld(new THREE.Vector3(0, 0, 0.24)).toArray());
      }
    }
  }
}

// Grappling-hook ropes: a line from someone's hand to where their hook caught, with the hook on the end.
const ropeGeometry = new THREE.CylinderGeometry(0.016, 0.016, 1, 5, 1, true)
  .translate(0, 0.5, 0)
  .rotateX(Math.PI / 2);
const ropeMaterial = new THREE.MeshBasicMaterial({ color: 0x1d1a16 });
const hookGeometry = new THREE.ConeGeometry(0.07, 0.2, 6).rotateX(Math.PI / 2); // points along +z
const hookMaterial = new THREE.MeshLambertMaterial({ color: 0xb8c0c9 });

export class Ropes {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<number|null,{line:THREE.Mesh<THREE.CylinderGeometry,THREE.MeshBasicMaterial>,hook:THREE.Mesh<THREE.ConeGeometry,THREE.MeshLambertMaterial>,seen:boolean}>} */
    this.ropes = new Map(); // owner → { line, hook, seen }
  }

  // Shows the rope from one point to the other this frame.
  /** @param {number|null} owner @param {import('./contracts.js').Vec3} from @param {import('./contracts.js').Vec3} to */
  draw(owner, from, to) {
    let rope = this.ropes.get(owner);
    if (!rope) {
      rope = {
        seen: false,
        line: new THREE.Mesh(ropeGeometry, ropeMaterial),
        hook: new THREE.Mesh(hookGeometry, hookMaterial),
      };
      this.scene.add(rope.line, rope.hook);
      this.ropes.set(owner, rope);
    }
    rope.seen = true;
    const start = new THREE.Vector3().fromArray(from);
    const end = new THREE.Vector3().fromArray(to);
    rope.line.position.copy(start);
    rope.line.lookAt(end);
    rope.line.scale.set(1, 1, start.distanceTo(end));
    rope.hook.position.copy(end);
    rope.hook.lookAt(end.clone().add(end.clone().sub(start)));
  }

  // Call after drawing every rope for the frame: removes the ones that weren't drawn.
  sweep() {
    for (const [owner, rope] of this.ropes) {
      if (rope.seen) {
        rope.seen = false;
        continue;
      }
      this.scene.remove(rope.line, rope.hook);
      this.ropes.delete(owner);
    }
  }
}

// Soft round puffs, drawn once, for fire and smoke.
/** @param {string} inner @param {string} outer */
function puffTexture(inner, outer) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = context2d(canvas);
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.45, outer);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const smokeTexture = puffTexture('rgba(255, 255, 255, 0.95)', 'rgba(255, 255, 255, 0.7)');
const flameTexture = puffTexture('rgba(255, 246, 214, 1)', 'rgba(255, 150, 40, 0.75)');

// Jump pads: a glowing ring on the pad, and a faint column of light above it as high as it throws
// you, so you can find them from across the map.
const padRing = new THREE.RingGeometry(0.55, 0.95, 32).rotateX(-Math.PI / 2);
const padBeam = new THREE.CylinderGeometry(0.9, 0.9, 1, 24, 1, true).translate(0, 0.5, 0);

export class PadGlows {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** @type {THREE.Mesh<THREE.RingGeometry,THREE.MeshBasicMaterial>[]} */
    this.rings = [];
    /** @type {THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>[]} */
    this.meshes = [];
  }

  // The pads on the map being played.
  /** @param {{at:import('./contracts.js').Vec3,to:import('./contracts.js').Vec3}[]} pads */
  place(pads) {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.material.dispose();
    }
    /** @type {THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>[]} */
    this.meshes = [];
    this.rings = pads.map(({ at, to }) => {
      const ring = new THREE.Mesh(
        padRing,
        new THREE.MeshBasicMaterial({
          color: 0x5fe6ff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.position.set(at[0], at[1] + 0.03, at[2]);
      const beam = new THREE.Mesh(
        padBeam,
        new THREE.MeshBasicMaterial({
          color: 0x5fe6ff,
          transparent: true,
          opacity: 0.06,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      beam.position.set(at[0], at[1], at[2]);
      beam.scale.y = Math.max(3, to[1] - at[1] + 2.5);
      this.scene.add(ring, beam);
      this.meshes.push(ring, beam);
      return ring;
    });
  }

  /** @param {number} now */
  update(now) {
    this.rings.forEach((ring, i) => {
      ring.material.opacity = 0.55 + Math.sin(now / 200 + i) * 0.3;
      ring.scale.setScalar(1 + ((now / 900 + i * 0.3) % 1) * 0.15);
    });
  }
}

// Capture the flag: each team's flag stand at its base, and its flag, standing there or lying where
// it was dropped. A carried flag is drawn on its carrier's back instead (see avatars.js). They glow
// a little in their team's colour.
const standGeometry = new THREE.CylinderGeometry(0.55, 0.65, 0.12, 24);
const flagPoleGeometry = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8).translate(0, 1.1, 0);
const flagBannerGeometry = new THREE.PlaneGeometry(0.9, 0.55).translate(0.45, 0, 0);
const flagPoleMaterial = new THREE.MeshLambertMaterial({ color: 0xd8dde4 });

export class Flags {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.items = Object.fromEntries(
      TEAMS.map((team) => {
        const color = TEAM_COLORS[team] ?? '#ffffff';
        const glowing = new THREE.MeshLambertMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.35,
          side: THREE.DoubleSide,
        });
        const stand = new THREE.Mesh(standGeometry, glowing);
        const flag = new THREE.Group();
        const banner = new THREE.Mesh(flagBannerGeometry, glowing);
        banner.position.y = 1.85;
        flag.add(new THREE.Mesh(flagPoleGeometry, flagPoleMaterial), banner);
        scene.add(stand, flag);
        return [team, { stand, flag, banner, dropped: false }];
      }),
    );
    this.place();
    this.sync(null);
  }

  // Each stand at its team's base, on the map being played.
  place() {
    for (const [team, { stand }] of Object.entries(this.items)) {
      if (team !== 'red' && team !== 'blue') continue;
      const base = FLAG_BASES[team];
      if (base) stand.position.fromArray(base);
      stand.position.y += 0.06;
    }
  }

  // flags: { red: { state, at }, blue: … } in capture the flag, or null in deathmatch.
  /** @param {import('../../shared/runtime-types.ts').RoundSnapshot['flags']|null|undefined} flags */
  sync(flags) {
    for (const [team, item] of Object.entries(this.items)) {
      if (team !== 'red' && team !== 'blue') continue;
      const flag = flags?.[team];
      item.stand.visible = Boolean(flags);
      item.flag.visible = Boolean(flag && flag.state !== 'carried');
      if (flag?.at) item.flag.position.fromArray(flag.at);
      item.dropped = flag?.state === 'dropped';
    }
  }

  /** @param {number} now */
  update(now) {
    for (const item of Object.values(this.items)) {
      item.banner.rotation.y = Math.sin(now / 300) * 0.3; // flapping
      item.flag.rotation.z = item.dropped ? 0.6 : 0; // fallen over where it was dropped
    }
  }
}
