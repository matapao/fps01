import { indexed } from './indexed.js';
import { AXES, mapVector } from './vector.js';
// Hook movement is shared, renderer-free physics so real map approaches can be regression-tested.
import { GRAVITY, HOOK_ARRIVE, HOOK_HOP, HOOK_PULL, HOOK_SPEED } from './constants.js';
import { moveAndCollide } from './physics.js';

const CHEST = 1.2;

/** @param {import('./contracts.ts').Vector3} anchor @param {import('./contracts.ts').Vector3 | null} ledge  @returns {import('./runtime-types.ts').Grapple} */
export function startGrapple(anchor, ledge) {
  // Pull the body above a ledge rather than into its face or an intervening stair.
  const mantle = ledge !== null && ledge[1] >= anchor[1] - 0.05;
  /** @type {import('./contracts.ts').Vector3} */
  const goal = mantle && ledge ? [ledge[0], ledge[1] + CHEST, ledge[2]] : [...anchor];
  return { anchor, ledge, goal, mantle };
}

/** @param {Pick<import('./runtime-types.ts').MovementState, 'feet' | 'velocity' | 'onGround'>} player @param {import('./runtime-types.ts').Grapple} hook @param {number} dt @param {number} now @param {import('./voxels.js').Voxels} world */
export function stepGrapple(player, hook, dt, now, world) {
  const { feet, velocity } = player;
  /** @type {import('./contracts.ts').Vector3} */
  const chest = [feet[0], feet[1] + CHEST, feet[2]];
  const offset = mapVector(hook.goal, (value, i) => value - chest[i]);
  const distance = Math.hypot(...offset);
  const released = distance < HOOK_ARRIVE;
  /** @type {import('./runtime-types.ts').Mantle | null} */
  let climb = null;
  if (released) {
    const ledge = hook.ledge;
    const rise = ledge ? ledge[1] - feet[1] : 0;
    const hop = Math.max(HOOK_HOP, rise > 0 ? Math.sqrt(2 * GRAVITY * (rise + 0.4)) : 0);
    // An automatic catch settles at the configured hop height above the landing,
    // including when the player has already risen past its surface.
    velocity[1] = hook.mantle
      ? Math.sqrt(Math.max(0, HOOK_HOP ** 2 + 2 * GRAVITY * rise))
      : Math.max(velocity[1], hop);
    const flat = ledge ? Math.hypot(ledge[0] - feet[0], ledge[2] - feet[2]) : 0;
    if (ledge && (hook.mantle || (rise > 0 && flat > 0.01))) {
      climb = {
        y: ledge[1],
        to: hook.mantle
          ? [ledge[0], ledge[2]]
          : [ledge[0] + ((ledge[0] - feet[0]) / flat) * 0.5, ledge[2] + ((ledge[2] - feet[2]) / flat) * 0.5],
        until: now + 900,
      };
    }
  } else {
    const dir = mapVector(offset, (value) => value / distance);
    for (const i of AXES) velocity[i] += dir[i] * HOOK_PULL * dt;
    // A landing pull must reach the surface: gravity otherwise leaves a shallow approach
    // hanging below the lip, even though there is an unobstructed path over it.
    if (!hook.mantle) velocity[1] -= GRAVITY * 0.3 * dt;
    const along = velocity.reduce((sum, value, i) => sum + value * indexed(dir, i), 0);
    const damp = Math.exp(-dt * 4);
    for (const i of AXES) velocity[i] = dir[i] * along + (velocity[i] - dir[i] * along) * damp;
    const speed = Math.hypot(...velocity);
    if (speed > HOOK_SPEED) for (const i of AXES) velocity[i] *= HOOK_SPEED / speed;
  }
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  for (let i = 0; i < steps; i++) player.onGround = moveAndCollide(world, feet, velocity, dt / steps);
  return { released, climb };
}

/** @param {Pick<import('./runtime-types.ts').MovementState, 'feet' | 'velocity' | 'onGround'>} player @param {import('./runtime-types.ts').Mantle | null} climb @param {number} now */
export function stepMantle(player, climb, now) {
  if (!climb || now > climb.until || player.onGround) return null;
  if (player.feet[1] > climb.y) {
    // Settle just inside the ledge rather than pushing all the way off a narrow roof.
    /** @type {[number, number]} */
    const offset = [climb.to[0] - player.feet[0], climb.to[1] - player.feet[2]];
    const distance = Math.hypot(...offset);
    const speed = Math.min(4, distance * 8);
    player.velocity[0] = distance > 0.02 ? (offset[0] / distance) * speed : 0;
    player.velocity[2] = distance > 0.02 ? (offset[1] / distance) * speed : 0;
  }
  return climb;
}
