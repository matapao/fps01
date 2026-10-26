// Collision and ray tests, shared so the browser and the server agree on what blocks a shot.
// Positions are [x, y, z] arrays; a player's position is their feet. world is the Voxels grid.

import { EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS } from './constants.js';
import { AIR, CELL, GRID_MIN } from './map.js';
import { cellOf } from './voxels.js';
import { AXES, mapVector } from './vector.js';
/** @type {import('./contracts.ts').Axis[]} */
const COLLISION_AXES = [1, 0, 2];

const EPSILON = 1e-6;

// The box a player takes up, optionally grown on every side.
/** @param {import('./contracts.ts').Vector3} feet @param {number} grow  @returns {{min: import('./contracts.ts').Vector3, max: import('./contracts.ts').Vector3}} */
export function playerBox(feet, grow = 0) {
  return {
    min: [feet[0] - PLAYER_RADIUS - grow, feet[1] - grow, feet[2] - PLAYER_RADIUS - grow],
    max: [feet[0] + PLAYER_RADIUS + grow, feet[1] + PLAYER_HEIGHT + grow, feet[2] + PLAYER_RADIUS + grow],
  };
}

/** @param {import('./contracts.ts').Vector3} feet  @returns {import('./contracts.ts').Vector3} */
export function eyePosition(feet) {
  return [feet[0], feet[1] + EYE_HEIGHT, feet[2]];
}

// Distance along a ray (dir must be a unit vector) to where it enters the box, or Infinity if it misses.
/** @param {import('./contracts.ts').Vector3} origin @param {import('./contracts.ts').Vector3} dir @param {{min: import('./contracts.ts').Vector3, max: import('./contracts.ts').Vector3}} box */
export function rayBox(origin, dir, { min, max }) {
  let near = 0;
  let far = Infinity;
  for (const i of AXES) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (origin[i] < min[i] || origin[i] > max[i]) return Infinity;
      continue;
    }
    let t1 = (min[i] - origin[i]) / dir[i];
    let t2 = (max[i] - origin[i]) / dir[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return Infinity;
  }
  return near;
}

// Distance to the first floor, wall or crate along a ray, capped at maxDistance.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} origin @param {import('./contracts.ts').Vector3} dir @param {number} maxDistance */
export function rayWorld(world, origin, dir, maxDistance) {
  return world.raycast(origin, dir, maxDistance)?.distance ?? maxDistance;
}

// Whether any solid cell overlaps the box (whose faces may touch cells without overlapping them).
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} min @param {import('./contracts.ts').Vector3} max */
export function boxHitsWorld(world, min, max) {
  const lo = mapVector(min, (v, a) => cellOf(v, a));
  const hi = mapVector(max, (v, a) => Math.ceil((v - GRID_MIN[a]) / CELL) - 1);
  for (let iy = lo[1]; iy <= hi[1]; iy++) {
    for (let iz = lo[2]; iz <= hi[2]; iz++) {
      for (let ix = lo[0]; ix <= hi[0]; ix++) if (world.get(ix, iy, iz) !== AIR) return true;
    }
  }
  return false;
}

// Moves a player by velocity × dt one axis at a time, stopping against cells. Changes feet and
// velocity in place, and returns true when the player is standing on something. With stairs, a
// player on the ground walks up onto anything one cell high instead of stopping against it.
// Steps must stay under a cell (0.5 m) per call; callers split long frames into small steps.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} feet @param {import('./contracts.ts').Vector3} velocity @param {number} dt @param {boolean} stairs */
export function moveAndCollide(world, feet, velocity, dt, stairs = false) {
  let onGround = false;
  const standing = stairs && velocity[1] <= 0 && resting(world, feet); // on the ground already, as this step starts
  for (const axis of COLLISION_AXES) {
    const step = velocity[axis] * dt;
    if (step === 0) continue;
    feet[axis] += step;
    const { min, max } = playerBox(feet);
    if (!boxHitsWorld(world, min, max)) continue;
    if (axis !== 1 && stairs && (standing || onGround) && stepUp(world, feet)) continue;
    // Back out to the face of the cell that was hit.
    const size = axis === 1 ? PLAYER_HEIGHT : PLAYER_RADIUS;
    if (step > 0) {
      const face = GRID_MIN[axis] + cellOf(max[axis], axis) * CELL;
      feet[axis] = face - size - EPSILON;
    } else {
      const face = GRID_MIN[axis] + (cellOf(min[axis], axis) + 1) * CELL;
      feet[axis] = face + (axis === 1 ? 0 : size) + EPSILON;
      if (axis === 1) onGround = true;
    }
    velocity[axis] = 0;
  }
  // Resting on something is standing, even in a step that didn't move down.
  if (!onGround && velocity[1] <= 0) onGround = resting(world, feet);
  return onGround;
}

// Whether someone standing at feet has something solid right under them.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} feet */
function resting(world, feet) {
  const { min, max } = playerBox(feet);
  return boxHitsWorld(world, [min[0], feet[1] - 0.02, min[2]], [max[0], feet[1], max[2]]);
}

// Up onto what's in front of you, if it's one cell high and there's room on top: puts your feet
// there and returns true.
/** @param {import('./voxels.js').Voxels} world @param {import('./contracts.ts').Vector3} feet */
function stepUp(world, feet) {
  const y = feet[1];
  feet[1] = GRID_MIN[1] + (cellOf(y + 0.01, 1) + 1) * CELL + EPSILON;
  const { min, max } = playerBox(feet);
  if (!boxHitsWorld(world, min, max)) return true;
  feet[1] = y;
  return false;
}
