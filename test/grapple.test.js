import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js';
import { useMap } from '../shared/map.js';
import { startGrapple, stepGrapple, stepMantle } from '../shared/grapple.js';
import { moveState, stepMovement } from '../shared/movement.js';
import { boxHitsWorld, eyePosition, playerBox } from '../shared/physics.js';
import { canHook, hookSpot } from '../shared/reach.js';
import { Voxels } from '../shared/voxels.js';

for (const [name, map, feet, target, height] of [
  ['wagon roof', 'depot', [6.5, 0, 14.5], [6.5, 3.4, 11], 3.5],
  ['crate top approached in midair', 'depot', [18, 1.033, 4.5], [22.8, 2, 3.9], 2],
  ['crates behind a lower step', 'depot', [18, 0, 4.5], [22, 1.9, 4], 2],
  ['bridge with an approach stair', 'canal', [12, 0, 0], [0, 2.5, 0], 2.5],
  ['high bridge edge', 'fort', [12, 0, 6], [12, 7.8, 1.5], 8],
  ['turret cap', 'fort', [16, 0, 13], [21.5, 9.8, 15], 10],
]) {
  test(`the hook lifts onto the ${name} without stalling or clipping`, () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      useMap(map);
      const world = new Voxels('dm', map),
        player = moveState(feet);
      const eye = eyePosition(feet),
        offset = target.map((v, i) => v - eye[i]);
      const dir = offset.map((v) => v / Math.hypot(...offset));
      const hit = world.raycast(eye, dir, 40);
      const at = eye.map((v, i) => v + dir[i] * hit.distance);
      assert.ok(canHook(world, feet, at, hit.normal));
      const hook = startGrapple(at, hookSpot(world, at, hit.normal));
      let highest = feet[1];
      let released = false,
        climb = null;
      for (let t = 0; t < 3; t += dt) {
        if (!released) {
          const result = stepGrapple(player, hook, dt, t * 1000, world);
          released = result.released;
          climb = result.climb;
        } else {
          climb = stepMantle(player, climb, t * 1000);
          stepMovement(player, { forward: 0, strafe: 0, yaw: 0, jump: false }, dt, world, t * 1000);
        }
        const { min, max } = playerBox(player.feet);
        highest = Math.max(highest, player.feet[1]);
        assert.equal(boxHitsWorld(world, min, max), false, `inside a block at ${player.feet}`);
      }
      assert.ok(released, 'releases onto the ledge instead of hanging at the step');
      assert.ok(highest < height + 1.05, `automatic landing should not catapult above the ledge: ${highest}`);
      assert.ok(player.onGround, `landed at ${player.feet}`);
      assert.ok(
        Math.abs(player.feet[1] - height) < 0.01,
        `landed at ${player.feet}, expected height ${height}`,
      );
    }
  });
}

test('an overhead hook respects the underside of a solid roof', () => {
  useMap('depot');
  const world = new Voxels('dm', 'depot'),
    player = moveState([-10, 0, 14]);
  const eye = eyePosition(player.feet),
    hit = world.raycast(eye, [0, 1, 0], 40);
  const at = [eye[0], eye[1] + hit.distance, eye[2]];
  const hook = startGrapple(at, hookSpot(world, at, hit.normal));
  let released = false;
  for (let t = 0; t < 2; t += 1 / 60) {
    if (!released) released = stepGrapple(player, hook, 1 / 60, t * 1000, world).released;
    else stepMovement(player, { forward: 0, strafe: 0, yaw: 0, jump: false }, 1 / 60, world, t * 1000);
    assert.ok(player.feet[1] + 1.8 <= at[1] + 0.001, 'cannot pass through the roof');
  }
  assert.ok(released);
});
