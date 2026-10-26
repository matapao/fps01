import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { scatter, spreadFor } from '../shared/aim.js';
import { MOVE_SPEED, SPREAD_AIR, SPREAD_MOVING, SPREAD_STILL } from '../shared/constants.js';

test('standing still is accurate; running and jumping spread your shots', () => {
  const still = spreadFor([0, 0, 0], true);
  const walking = spreadFor([MOVE_SPEED / 2, 0, 0], true);
  const running = spreadFor([0, 0, MOVE_SPEED], true);
  const jumping = spreadFor([0, 5, MOVE_SPEED], false);
  assert.equal(still, SPREAD_STILL);
  assert.ok(still < walking && walking < running && running < jumping);
  assert.ok(Math.abs(running - (SPREAD_STILL + SPREAD_MOVING)) < 1e-12);
  assert.ok(Math.abs(jumping - (SPREAD_STILL + SPREAD_MOVING + SPREAD_AIR)) < 1e-12);
  assert.equal(spreadFor([0, -20, 0], true), SPREAD_STILL, 'falling speed does not count, only running');
});

test('scattered shots stay inside the cone and fill it', () => {
  const dir = [0.2, 0.3, -0.932].map((v, _, a) => v / Math.hypot(...a));
  const spread = 0.08;
  let widest = 0;
  for (let i = 0; i < 2000; i++) {
    const shot = scatter(dir, spread);
    assert.ok(Math.abs(Math.hypot(...shot) - 1) < 1e-9, 'unit length');
    const angle = Math.acos(
      Math.min(
        1,
        shot.reduce((sum, v, j) => sum + v * dir[j], 0),
      ),
    );
    assert.ok(angle <= spread + 1e-9, `angle ${angle}`);
    widest = Math.max(widest, angle);
  }
  assert.ok(widest > spread * 0.9, 'reaches the edge of the cone');
  assert.deepEqual(
    scatter([0, 1, 0], 0).map((v) => Math.round(v * 1e9) / 1e9),
    [0, 1, 0],
    'no spread, no change (even straight up)',
  );
});
