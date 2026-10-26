// Your juggling balls in your own hands (F): two gloved hands keeping three balls going, a little
// faster and higher the faster you run. The hands are blocks, but every finger bends at three joints
// and the thumb at two, so they catch, grip and flick like a juggler's. F again (or the right button)
// moves on to the next trick; the action button throws a ball (toss): the right hand draws back with
// the ball in its fingers, snaps forward and lets go, follows through, and comes back to the balls
// still going. It lives in the gun's own scene (guns.js), centred in front of you. The tricks are
// MOVES in shared/tricks.js.

import * as THREE from 'three';
import { indexed } from '/shared/indexed.js';
import { mapVector } from '/shared/vector.js';
import { MOVES } from '/shared/tricks.js';

const glove = new THREE.MeshStandardMaterial({ color: 0x3a414c, roughness: 0.7 });
const cuff = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.6 });
const stripe = new THREE.MeshStandardMaterial({ color: 0xff8a2a, roughness: 0.5 });
/** @param {number} w @param {number} h @param {number} d @param {THREE.Material} material */
const box = (w, h, d, material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
/** @param {number} a @param {number} b @param {number} k */
const lerp = (a, b, k) => a + (b - a) * k;
/** @param {number} v @param {number} n */
const mod = (v, n) => ((v % n) + n) % n;

// How long each block of a finger is, from the knuckle out: index, middle, ring, little; and the thumb's.
const PHALANGES = [
  [0.013, 0.0095, 0.0085],
  [0.0145, 0.0105, 0.009],
  [0.0135, 0.0098, 0.0085],
  [0.011, 0.008, 0.0072],
];
const THUMB = [0.0145, 0.012];

// A chain of blocks on joints, from a parent: each joint where the last block ends. Returns the joints.
/** @param {THREE.Group} parent @param {number[]} lengths @param {number} width @param {number} height */
function chain(parent, lengths, width, height) {
  /** @type {THREE.Group[]} */
  const joints = [];
  let at = parent;
  lengths.forEach((length, j) => {
    const joint = new THREE.Group();
    if (j > 0) joint.position.z = -indexed(lengths, j - 1);
    const block = box(width - j * 0.0007, height - j * 0.0009, length - 0.0007, glove);
    block.position.z = -length / 2;
    joint.add(block);
    at.add(joint);
    at = joint;
    joints.push(joint);
  });
  return joints;
}

// A blocky gloved hand, palm up, fingers pointing away from you. side: -1 left, 1 right. Each finger
// is three blocks on three joints, the thumb two on two, set by pose().
/** @param {-1 | 1} side */
function hand(side) {
  const group = new THREE.Group();
  const palm = box(0.042, 0.013, 0.046, glove);
  const wrist = box(0.044, 0.016, 0.014, cuff);
  wrist.position.set(0, -0.001, 0.029);
  const band = box(0.045, 0.004, 0.005, stripe);
  band.position.set(0, 0.008, 0.026);
  group.add(palm, wrist, band);
  const fingers = PHALANGES.map((lengths, i) => {
    const knuckle = new THREE.Group();
    knuckle.position.set(side * (-0.017 + i * 0.0113), 0, -0.023);
    group.add(knuckle);
    return chain(knuckle, lengths, 0.0098, 0.011);
  });
  const root = new THREE.Group(); // where the thumb leaves the palm, turned out from it
  root.position.set(-side * 0.024, 0.002, -0.004);
  root.rotation.y = side * 0.6;
  group.add(root);
  const thumb = [root, ...chain(root, THUMB, 0.0105, 0.011)];
  return Object.assign(group, { userData: { fingers, thumb, side } });
}

// Bends a hand's fingers: curls, one for all or [index, middle, ring, little], 0 straight … 1 a fist
// (the middle joint bends most, as a real one does); the thumb, 0 out … 1 tucked across the palm;
// and spread, how far the fingers fan apart.
/** @param {ReturnType<typeof hand>} handGroup @param {number | number[]} curls @param {number} [thumb] @param {number} [spread] */
function pose(handGroup, curls, thumb = 0.3, spread = 0) {
  const { fingers, thumb: thumbJoints, side } = handGroup.userData;
  const [root, near, far] = [indexed(thumbJoints, 0), indexed(thumbJoints, 1), indexed(thumbJoints, 2)];
  fingers.forEach((joints, i) => {
    const amount = Array.isArray(curls) ? indexed(curls, i) : curls;
    indexed(joints, 0).rotation.x = amount * 1.1;
    indexed(joints, 1).rotation.x = amount * 1.4;
    indexed(joints, 2).rotation.x = amount * 0.9;
    indexed(joints, 0).rotation.y = side * spread * (i - 1.5) * 0.14;
  });
  root.rotation.set(thumb * 0.35, side * (0.6 - thumb * 0.45), 0);
  near.rotation.x = thumb * 0.6;
  far.rotation.x = thumb * 0.85;
}

// A grip that ripples from the little finger to the index (or back): how far each finger has got,
// given how far the whole grip has (0 … 1).
/** @param {number} k @param {number} [from] */
const ripple = (k, from = 3) =>
  [0, 1, 2, 3].map((i) => Math.max(0, Math.min(1, k * 1.6 - Math.abs(i - from) * 0.2)));

/** @param {number} k */
const smooth = (k) => {
  const t = Math.max(0, Math.min(1, k));
  return t * t * (3 - 2 * t);
};

// ---- Juggling ----

const BALL_COLORS = [0xe8524a, 0xf2c14e, 0x3d8bfd];
const HAND_Y = -0.1;

// A throw, ms after the click: where the right hand is, how it's turned, and how its fingers curl
// (0 open … 1 round the ball), its thumb and their spread. It draws back by the shoulder with the
// wrist cocked, drives forward and lets go (the fingers open from the little one to the index),
// snaps through wide open, and follows through, turned over. Then it eases back into the pattern.
/** @typedef {{at: import('./contracts.d.ts').Vec3, turn: import('./contracts.d.ts').Vec3, curl: number, thumb: number, spread: number}} ThrowPose */
/** @typedef {{at: import('./contracts.d.ts').Vec3, turn: import('./contracts.d.ts').Vec3, curls: number[], thumb: number, spread: number}} HandPose */
/** @type {(ThrowPose & {ms: number})[]} */
const THROW = [
  { ms: 0, at: [0.1, HAND_Y - 0.012, -0.4], turn: [-0.25, -0.25, -0.15], curl: 0.55, thumb: 0.55, spread: 0 },
  {
    ms: 85,
    at: [0.175, HAND_Y + 0.045, -0.29],
    turn: [0.65, -0.05, -0.4],
    curl: 0.68,
    thumb: 0.65,
    spread: 0,
  },
  {
    ms: 125,
    at: [0.115, HAND_Y + 0.07, -0.46],
    turn: [-0.45, -0.05, -0.15],
    curl: 0.4,
    thumb: 0.35,
    spread: 0.15,
  },
  {
    ms: 165,
    at: [0.06, HAND_Y + 0.05, -0.56],
    turn: [-1.15, 0.05, 0.25],
    curl: 0.02,
    thumb: 0.05,
    spread: 0.65,
  },
  {
    ms: 260,
    at: [0.035, HAND_Y + 0.005, -0.54],
    turn: [-1.3, 0.1, 0.55],
    curl: 0.12,
    thumb: 0.12,
    spread: 0.4,
  },
];
const RELEASE_MS = 125; // when the ball leaves the fingers
const THROWN_MS = 210; // and is out of sight, on its way

// The throwing hand's pose, ms into a throw: between the two moments either side of it.
/** @param {number} ms @returns {ThrowPose} */
function throwPose(ms) {
  const next = THROW.findIndex((key) => key.ms > ms);
  if (next === -1) return indexed(THROW, THROW.length - 1);
  if (next === 0) return indexed(THROW, 0);
  const [a, b] = [indexed(THROW, next - 1), indexed(THROW, next)];
  const k = smooth((ms - a.ms) / (b.ms - a.ms));
  /** @param {import('./contracts.d.ts').Vec3} u @param {import('./contracts.d.ts').Vec3} v */
  const mix = (u, v) => mapVector(u, (value, i) => lerp(value, v[i], k));
  return {
    at: mix(a.at, b.at),
    turn: mix(a.turn, b.turn),
    curl: lerp(a.curl, b.curl, k),
    thumb: lerp(a.thumb, b.thumb, k),
    spread: lerp(a.spread, b.spread, k),
  };
}

class Juggle {
  /** @param {THREE.Group} group */
  constructor(group) {
    this.left = hand(-1);
    this.right = hand(1);
    group.add(this.left, this.right);
    this.balls = BALL_COLORS.map((color) => {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.013, 18, 12),
        new THREE.MeshStandardMaterial({ color, roughness: 0.35 }),
      );
      group.add(ball);
      return ball;
    });
    this.beat = 0; // throws so far: the clock of the pattern
    /** @type {{ball: number, start: number, ms: number} | null} */
    this.throw = null; // { ball, start, ms }: a ball thrown at someone, back in the pattern after ms
  }

  // One of the balls thrown at someone, by the right hand: the next it would have thrown.
  /** @param {number} ms @param {number} now */
  toss(ms, now) {
    this.throw = { ball: Math.floor(this.beat) % 3, start: now, ms };
  }

  /** @param {number} dt @param {number} now @param {number} motion @param {string} move */
  update(dt, now, motion, move) {
    const tower = move === 'Tower';
    const beatSeconds = (tower ? 0.32 : 0.27) - motion * 0.07;
    this.beat += dt / beatSeconds;
    const height = (tower ? 0.2 : 0.085) + motion * 0.025;
    const hands = { [-1]: this.left, 1: this.right };
    // Each hand: carries a ball in from the outside and throws it from the inside, every other beat.
    /** @type {Partial<Record<-1 | 1, HandPose>>} */
    const poses = {};
    /** @param {-1 | 1} side */
    const poseFor = (side) => {
      const value = poses[side];
      if (!value) throw new Error(`Missing hand pose ${side}`);
      return value;
    };
    for (const side of /** @type {const} */ ([-1, 1])) {
      const t = mod(this.beat - (side === 1 ? 0 : 1), 2);
      const carrying = t >= 1;
      const k = carrying ? t - 1 : t;
      const x = carrying ? lerp(0.15, 0.05, k) : lerp(0.05, 0.15, k);
      const y = HAND_Y - (carrying ? Math.sin(Math.PI * k) * 0.03 : -Math.sin(Math.PI * k) * 0.012);
      // Catching, the fingers close round the ball from the little finger in, and the thumb comes
      // over; carrying it, they hold; throwing it, they flick open, the index last.
      const grip = carrying ? Math.min(1, k * 4) * (k < 0.82 ? 1 : (1 - k) / 0.18) : Math.max(0, 0.2 - k);
      poses[side] = {
        at: [side * x, y - 0.012, -0.4],
        turn: [-0.25, side * -0.25, side * -0.15],
        curls: ripple(grip).map((v, i) => 0.08 + v * (0.5 + i * 0.06)),
        thumb: 0.15 + grip * 0.5,
        spread: 0.3 * (1 - grip),
      };
    }
    // Throwing one at someone: the right hand leaves the pattern for the throw and eases back after.
    const thrown = this.throw && now - this.throw.start < this.throw.ms ? this.throw : null;
    if (!thrown) this.throw = null;
    const into = thrown ? now - thrown.start : 0;
    const weight = !thrown
      ? 0
      : into < 50
        ? smooth(into / 50)
        : into < 260
          ? 1
          : 1 - smooth((into - 260) / Math.max(1, thrown.ms - 260));
    if (weight > 0) {
      const key = throwPose(into);
      const pattern = poseFor(1);
      // The fingers open one after another as it lets go: the little finger first, the index last.
      /** @param {number} i */
      const opening = (i) => smooth((into - (RELEASE_MS - 20) - (3 - i) * 10) / 25);
      const curls = [0, 1, 2, 3].map((i) =>
        into < RELEASE_MS + 40 ? lerp(Math.max(key.curl, 0.55), key.curl, opening(i)) : key.curl,
      );
      poses[1] = {
        at: mapVector(pattern.at, (v, i) => lerp(v, key.at[i], weight)),
        turn: mapVector(pattern.turn, (v, i) => lerp(v, key.turn[i], weight)),
        curls: pattern.curls.map((v, i) => lerp(v, indexed(curls, i), weight)),
        thumb: lerp(pattern.thumb, key.thumb, weight),
        spread: lerp(pattern.spread, key.spread, weight),
      };
      // The other hand keeps the two left going, dipping a little to balance the throw.
      poseFor(-1).at[1] -= 0.012 * weight;
      poseFor(-1).at[0] += 0.015 * weight;
    }
    for (const side of /** @type {const} */ ([-1, 1])) {
      const { at, turn, curls, thumb, spread } = poseFor(side);
      hands[side].position.fromArray(at);
      hands[side].rotation.set(...turn);
      pose(hands[side], curls, thumb, spread);
    }
    this.balls.forEach((ball, i) => {
      if (thrown && thrown.ball === i) {
        this.carry(ball, into);
        return;
      }
      ball.visible = true;
      /** @type {import('./contracts.d.ts').Vec3} */
      let at;
      if (move === 'Shower') {
        // Round in a circle: thrown high from the right hand to the left, passed low back across.
        const q = mod(this.beat / 3 + i / 3, 1);
        if (q < 0.72) {
          const u = q / 0.72;
          at = [
            lerp(0.1, -0.12, u),
            HAND_Y + 4 * (height * 1.4) * u * (1 - u),
            -0.41 - 0.03 * Math.sin(Math.PI * u),
          ];
        } else {
          const u = (q - 0.72) / 0.28;
          at = [lerp(-0.12, 0.1, u), HAND_Y + 0.02 * Math.sin(Math.PI * u), -0.39];
        }
      } else {
        // The cascade: a figure of eight, every ball thrown every third beat, from hand to hand.
        const b = mod(this.beat - i, 6);
        const from = i % 2 === 0 ? 1 : -1;
        const u = b < 2 ? b / 2 : b < 3 ? b - 2 : b < 5 ? (b - 3) / 2 : b - 5;
        if (b < 2 || (b >= 3 && b < 5)) {
          const side = b < 2 ? from : -from;
          at = [
            lerp(side * 0.05, -side * 0.15, u),
            HAND_Y + 0.01 + 4 * height * u * (1 - u),
            -0.4 - 0.04 * Math.sin(Math.PI * u),
          ];
        } else {
          const side = b < 3 ? -from : from;
          at = [side * lerp(0.15, 0.05, u), HAND_Y + 0.012 - Math.sin(Math.PI * u) * 0.03, -0.4];
        }
      }
      ball.position.fromArray(at);
    });
  }

  // The ball being thrown: in the right hand's fingers until it lets go, then away out of sight.
  /** @param {THREE.Mesh} ball @param {number} into */
  carry(ball, into) {
    const palm = new THREE.Vector3(0, 0.02, -0.012).applyEuler(this.right.rotation).add(this.right.position);
    if (into < RELEASE_MS) {
      ball.visible = true;
      ball.position.copy(palm);
      return;
    }
    const flying = (into - RELEASE_MS) / 1000;
    ball.visible = into < THROWN_MS;
    if (ball.visible) ball.position.set(palm.x - 0.6 * flying, palm.y + 0.5 * flying, palm.z - 3.5 * flying);
  }
}

// ---- The whole thing ----

// The juggling in your hands: update(dt, now, motion) moves it (motion: 0 standing … 1 running flat
// out), next() moves on to the next trick and returns its name, toss(ms) throws a ball.
export function createTricks() {
  const group = new THREE.Group();
  const juggle = new Juggle(group);
  let move = 0;
  return {
    group,
    next() {
      move = (move + 1) % MOVES.length;
      return indexed(MOVES, move);
    },
    move: () => indexed(MOVES, move),
    // Thrown at someone: it goes, and is back in ms.
    /** @param {number} ms */
    toss(ms) {
      juggle.toss(ms, performance.now());
    },
    /** @param {number} dt @param {number} now @param {number} motion */
    update(dt, now, motion) {
      juggle.update(dt, now, motion, indexed(MOVES, move));
    },
  };
}
