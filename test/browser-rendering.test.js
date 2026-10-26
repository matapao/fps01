import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOXES, HEALTH_BOXES, createBody } from '../public/js/body.js';

test('avatar damage, healing and respawn keep every body instance finite and reusable', () => {
  const body = createBody('#e8524a');
  try {
    assert.equal(body.count, HEALTH_BOXES);
    const removed = body.hurt(37);
    assert.equal(removed.length, 37);
    assert.equal(body.count, HEALTH_BOXES - 37);
    body.restore(80);
    assert.equal(body.count, 80);
    body.pose(1 / 60, 9);
    assert.ok(Array.from(body.mesh.instanceMatrix.array).every(Number.isFinite));
    assert.ok(Array.from(body.mesh.instanceColor.array).every(Number.isFinite));
    body.shatter();
    assert.equal(body.count, 0);
    assert.ok(Array.from(body.present).every((value) => value === 0));
    body.whole();
    body.setColor('#3d8bfd');
    body.pose(1 / 60, 0);
    assert.equal(body.count, HEALTH_BOXES);
    assert.equal(body.present.length, BOXES);
    assert.ok(Array.from(body.present).every((value) => value === 1));
    assert.ok(Array.from(body.mesh.instanceMatrix.array).every(Number.isFinite));
    assert.throws(() => body.boxAt(-1), RangeError);
    assert.throws(() => body.boxAt(BOXES), RangeError);
  } finally {
    body.dispose();
  }
});
