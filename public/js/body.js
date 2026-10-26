// Everyone's body (but your own): 100 boxes, one for each point of health, so you can see how hurt
// someone is, and a pair of black shades. Most of the boxes are flesh, in the player's colour; the
// rest are their skeleton: a spine down their back, their hands and their feet. Every point of
// damage takes the colour off a box, from the feet up (see ORDER): flesh is knocked off (avatars.js
// and main.js throw it about), and bone stays where it is, gone white. With one point left, all
// there is of someone is a white spine, hands and feet, their shades, and one box of colour on top
// of their head; a kill sends every box flying. Health above 100 and armor don't add boxes: they
// glow instead.

import * as THREE from 'three';

export const BOX = 0.125; // the size of each box: 14 of them make someone 1.75 m tall
export const HEALTH_BOXES = 100; // the first 100: one for each point of health…
export const BOXES = HEALTH_BOXES + 2; // …and the shades

// The boxes, bottom up: [column (0 … 5, left to right as they face you), layer (0 … 13), row (-1, 0
// front, 1 back), part, whether it's bone]. Legs (each with a foot, toe and all, of bone), a torso
// (the spine up the middle of its back), arms with hands (of bone), a head, and last the shades,
// sitting out in front of the face.
/** @typedef {'left leg'|'right leg'|'belt'|'torso'|'left arm'|'right arm'|'head'|'shades'} BodyPart */
/** @typedef {{column:number,layer:number,row:number,part:BodyPart,bone:boolean}} BodyBox */
/** @returns {(BodyBox & {at: import('./contracts.js').Vec3})[]} */
function layout() {
  /** @type {BodyBox[]} */
  const boxes = [];
  /** @param {number} column @param {number} layer @param {number} row @param {BodyPart} part */
  const add = (column, layer, row, part, bone = false) => boxes.push({ column, layer, row, part, bone });
  for (const [column, part] of /** @type {[number, BodyPart][]} */ ([
    [1, 'left leg'],
    [4, 'right leg'],
  ])) {
    for (let layer = 0; layer < 6; layer++)
      for (const row of [0, 1]) add(column, layer, row, part, layer === 0);
    add(column, 0, -1, part, true); // the toe
  }
  for (let layer = 6; layer < 11; layer++) {
    for (let column = 1; column <= 4; column++) {
      for (const row of [0, 1])
        add(column, layer, row, layer === 6 ? 'belt' : 'torso', row === 1 && (column === 2 || column === 3));
    }
  }
  for (const [column, part] of /** @type {[number, BodyPart][]} */ ([
    [0, 'left arm'],
    [5, 'right arm'],
  ])) {
    for (let layer = 6; layer < 11; layer++) for (const row of [0, 1]) add(column, layer, row, part);
    add(column, 5, 0, part, true); // the hand
  }
  for (let layer = 11; layer < 14; layer++)
    for (const column of [2, 3]) for (const row of [0, 1]) add(column, layer, row, 'head');
  for (const column of [2, 3]) add(column, 12, -1, 'shades');
  return boxes.map(({ column, layer, row, part, bone }) => ({
    part,
    bone,
    column,
    layer,
    row,
    at: [(column - 2.5) * BOX, (layer + 0.5) * BOX, row * BOX - BOX / 2],
  }));
}
export const LAYOUT = layout();
/** A caller's box index comes from this fixed layout or its damage order. @param {number} index */
function boxAtIndex(index) {
  const box = LAYOUT[index];
  if (!box) throw new RangeError('Body box index is outside the fixed layout');
  return box;
}

// The order the colour goes in, as health drops: a layer at a time from the feet up; in each layer
// the back before the front, and the outside before the middle. Last of all, a box on top of the
// head, at the front.
export const ORDER = LAYOUT.slice(0, HEALTH_BOXES)
  .map((box, i) => ({ ...box, i }))
  .sort(
    (a, b) =>
      a.layer - b.layer ||
      b.row - a.row ||
      Math.abs(b.column - 2.5) - Math.abs(a.column - 2.5) ||
      a.column - b.column,
  )
  .map(({ i }) => i);

// How each part is shaded against the player's colour: legs and belt darker, the head a touch lighter.
const SHADE = {
  'left leg': 0.72,
  'right leg': 0.72,
  belt: 0.55,
  torso: 1,
  'left arm': 0.86,
  'right arm': 0.86,
  head: 1.08,
};
const SHADES = new THREE.Color(0x14181f);
const BONE = new THREE.Color(0xffffff);
const HIP = 6 * BOX;
const SHOULDER = 11 * BOX;

const place = new THREE.Object3D();
const color = new THREE.Color();

// One body: an instanced box for each of the 100, with its own material (so it can glow, or go see-through).
/** @param {string} playerColor */
export function createBody(playerColor) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(BOX * 0.96, BOX * 0.96, BOX * 0.96),
    material,
    BOXES,
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const jitter = LAYOUT.map(() => 0.94 + Math.random() * 0.12); // so it reads as boxes, not a block
  const body = {
    mesh,
    material,
    present: new Uint8Array(BOXES).fill(1),
    white: new Uint8Array(BOXES), // bones that have lost their colour
    gone: /** @type {number[]} */ ([]), // the boxes that lost theirs, the latest last: it comes back in the opposite order
    count: HEALTH_BOXES, // boxes with their colour still on
    stride: 0, // how far into a stride the legs are, in radians
    tint: '',
    /** @param {string} hex */
    setColor(hex) {
      if (hex === this.tint) return;
      this.tint = hex;
      for (let i = 0; i < BOXES; i++) this.paint(i);
    },
    // One box in its colour: the player's (shaded by part), white for bare bone, black for the shades.
    /** @param {number} i */
    paint(i) {
      const { part } = boxAtIndex(i);
      if (part === 'shades') color.copy(SHADES);
      else if (this.white[i]) color.copy(BONE);
      else color.set(this.tint).multiplyScalar(SHADE[part] * (jitter[i] ?? 1));
      mesh.setColorAt(i, color);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    // Takes the colour off this many more boxes, from the feet up: flesh is knocked off, bone goes
    // white. Returns them as [{ i, bone, color }], with the colour each had. Always leaves at least
    // as many as health left says.
    /** @param {number} count */
    hurt(count) {
      const lost = ORDER.filter((i) => this.present[i] && !this.white[i]).slice(0, Math.max(0, count));
      const boxes = lost.map((i) => ({ i, bone: boxAtIndex(i).bone, color: this.colorOf(i) }));
      for (const i of lost) {
        if (boxAtIndex(i).bone) {
          this.white[i] = 1;
          this.paint(i);
        } else this.present[i] = 0;
        this.gone.push(i);
      }
      this.count -= lost.length;
      return boxes;
    },
    // A kill: every box still there flies off, bones and shades too. Returns them, as indices.
    shatter() {
      const left = [];
      for (let i = 0; i < BOXES; i++) if (this.present[i]) left.push(i);
      this.present.fill(0);
      this.count = 0;
      return left;
    },
    // Back up to this many boxes with their colour on (health coming back), the last lost first.
    /** @param {number} count */
    restore(count) {
      while (this.count < count && this.gone.length) {
        const i = this.gone.pop();
        if (i === undefined) break;
        this.present[i] = 1;
        if (this.white[i]) {
          this.white[i] = 0;
          this.paint(i);
        }
        this.count++;
      }
    },
    whole() {
      this.present.fill(1);
      for (let i = 0; i < BOXES; i++) {
        if (!this.white[i]) continue;
        this.white[i] = 0;
        this.paint(i);
      }
      this.gone = [];
      this.count = HEALTH_BOXES;
    },
    // Where a box is right now, in the body's own space (legs and arm swing as they run).
    /** @param {number} i @returns {import('./contracts.js').Vec3} */
    boxAt(i) {
      const { part, at } = boxAtIndex(i);
      const swing = this.swingOf(part);
      if (!swing) return at;
      const pivot = part.includes('leg') ? HIP : SHOULDER;
      const [x, y, z] = at;
      return [
        x,
        pivot + (y - pivot) * Math.cos(swing) - z * Math.sin(swing),
        (y - pivot) * Math.sin(swing) + z * Math.cos(swing),
      ];
    },
    /** @param {BodyPart} part */
    swingOf(part) {
      const swing = Math.sin(this.stride) * this.reach;
      if (part === 'left leg') return swing;
      if (part === 'right leg') return -swing;
      if (part === 'left arm') return -swing * 0.8;
      return 0; // the right arm holds the gun
    },
    reach: 0, // how far the legs swing: more the faster they run
    // Moves the legs and arm along (speed in m/s) and puts every box where it should be.
    /** @param {number} dt @param {number} speed */
    pose(dt, speed) {
      this.reach += ((speed > 1 ? Math.min(0.7, speed / 14) : 0) - this.reach) * Math.min(1, dt * 10);
      this.stride += dt * speed * 2.4;
      for (let i = 0; i < BOXES; i++) {
        const shown = this.present[i] ?? 0;
        place.position.fromArray(this.boxAt(i));
        place.rotation.set(this.swingOf(boxAtIndex(i).part), 0, 0);
        place.scale.setScalar(shown);
        place.updateMatrix();
        mesh.setMatrixAt(i, place.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    /** @param {number} i */
    colorOf(i) {
      return mesh.getColorAt(i, new THREE.Color());
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
  body.setColor(playerColor);
  return body;
}
