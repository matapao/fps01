// Exercise the browser's actual weapon and projectile code with three.js, without a renderer.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import * as THREE from 'three';
import './fixtures/data.js';
import { Voxels } from '../shared/voxels.js';

registerHooks({
  resolve: (specifier, context, next) =>
    specifier.startsWith('/shared/')
      ? next(new URL(`..${specifier}`, import.meta.url).href, context)
      : next(specifier, context),
});
const previousDocument = globalThis.document;
globalThis.document = {
  createElement: () => ({
    getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
  }),
};
after(() => {
  globalThis.document = previousDocument;
});
const { Projectiles, Effects } = await import('../public/js/effects.js');
const { Arsenal } = await import('../public/js/arsenal.js');

test('rockets point along their flight from launch, with the nose ahead and exhaust behind', () => {
  for (const direction of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [1, 2, -3],
  ]) {
    const heading = new THREE.Vector3(...direction).normalize();
    const scene = new THREE.Scene();
    const puffs = [];
    const projectiles = new Projectiles(scene, { puff: (at) => puffs.push(at) });
    const start = [3, 2, 4];
    projectiles.launch(1, 'rocket', start, heading.clone().multiplyScalar(30).toArray());
    const shot = projectiles.byId.get(1);
    const forward = () => new THREE.Vector3(0, 0, -1).applyQuaternion(shot.mesh.quaternion);
    assert.ok(forward().dot(heading) > 0.999999, `initial heading ${direction}`);
    projectiles.update(1000);
    assert.ok(forward().dot(heading) > 0.999999, 'no sideways first frame');
    shot.mesh.updateMatrixWorld(true);
    const nose = shot.mesh.children[1];
    nose.geometry.computeBoundingBox();
    const tip = nose.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(nose.matrixWorld);
    assert.ok(tip.sub(shot.mesh.position).dot(heading) > 0.2, 'nose is ahead');
    assert.ok(
      new THREE.Vector3(...puffs[0]).sub(shot.mesh.position).dot(heading) < -0.2,
      'smoke leaves the tail',
    );
    const next = new THREE.Vector3(...start).addScaledVector(heading, 1.5).toArray();
    projectiles.sync([[1, 'rocket', ...next]], 1050);
    projectiles.update(1075);
    assert.ok(forward().dot(heading) > 0.999999, 'keeps pointing along the interpolated flight');
    projectiles.sync([[1, 'rocket', ...next]], 1100);
    projectiles.update(1125);
    assert.ok(forward().dot(heading) > 0.999999, 'a stationary update preserves the heading');
    projectiles.sync([], 1150);
    assert.equal(scene.children.length, 0, 'removed after impact');
  }
});

test('running and airborne rockets follow the crosshair, while a nearby floor selects pressure', () => {
  const sent = [],
    flashes = [];
  let aim = [1, 0, 0];
  const game = {
    me: { feet: [-12, 0, 13], velocity: [9, 7.5, 4], spread: 0.2 },
    voxels: new Voxels('dm', 'fort'),
    gun: { kick: (pressure) => flashes.push(pressure) },
    send: (message) => sent.push(message),
    sound: { play() {} },
    look: () => aim,
    rush: () => 1,
  };
  const arsenal = new Arsenal(game);
  arsenal.ammo.rocket = 50;
  for (let i = 0; i < 30; i++) arsenal.fire('rocket', false, 1000 + i * 800);
  assert.equal(sent.length, 30);
  assert.ok(
    sent.every((shot) => shot.dir.every((v, i) => v === aim[i])),
    'movement never sends rockets sideways',
  );
  assert.ok(
    flashes.every((pressure) => !pressure),
    'forward shots use the rocket flash',
  );
  aim = [0, -1, 0];
  arsenal.fire('rocket', false, 25_000);
  assert.equal(flashes.at(-1), true, 'downward primary fire has an air burst flash');
  arsenal.fire('rocket', true, 27_000);
  assert.equal(flashes.at(-1), false, 'mortar alt-fire stays explosive');
  arsenal.weapon = 'rocket';
  arsenal.owned.add('rocket');
  assert.equal(arsenal.pressureReady(), true, 'aiming feedback predicts the pressure shot');
  arsenal.ammo.rocket = 0;
  assert.equal(arsenal.pressureReady(), false, 'an empty launcher does not promise a jump');
});

test('the first position snapshot does not tilt a rocket from the offset weapon muzzle', () => {
  const scene = new THREE.Scene();
  const projectiles = new Projectiles(scene, { puff() {} });
  const muzzle = [0.3, 1.3, -0.45];
  projectiles.launch(1, 'rocket', muzzle, [0, 0, -40]);
  for (const [time, z] of [
    [50, -1.5],
    [100, -3],
    [150, -4.5],
  ]) {
    projectiles.sync([[1, 'rocket', 0, 1.6, z]], time);
    projectiles.update(time + 16);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(projectiles.byId.get(1).mesh.quaternion);
    assert.ok(forward.dot(new THREE.Vector3(0, 0, -1)) > 0.999999);
  }
});

test('joining mid-flight waits for a known heading before drawing a rocket', () => {
  const scene = new THREE.Scene(),
    projectiles = new Projectiles(scene, { puff() {} });
  projectiles.sync([[7, 'rocket', 10, 2, 0]], 100);
  projectiles.update(110);
  assert.equal(projectiles.byId.get(7).mesh.visible, false, 'no invented sideways heading');
  projectiles.sync([[7, 'rocket', 12, 2, 0]], 150);
  projectiles.update(166);
  const shot = projectiles.byId.get(7);
  assert.equal(shot.mesh.visible, true);
  assert.ok(new THREE.Vector3(0, 0, -1).applyQuaternion(shot.mesh.quaternion).x > 0.999999);
});

test('a quick press while raising a weapon fires once when ready, and dead players do not queue shots', () => {
  let ready = false;
  const game = { me: { alive: true }, gun: { ready: () => ready, setCharge() {} } };
  const arsenal = new Arsenal(game),
    shots = [];
  arsenal.fire = (name, alt) => shots.push({ name, alt });
  arsenal.setPrimary(true);
  arsenal.update(1000);
  arsenal.setPrimary(false);
  ready = true;
  arsenal.update(1100);
  arsenal.update(1200);
  assert.deepEqual(shots, [{ name: 'rifle', alt: false }]);
  game.me.alive = false;
  arsenal.setPrimary(true);
  arsenal.update(1300);
  arsenal.setPrimary(false);
  game.me.alive = true;
  arsenal.update(1400);
  assert.equal(shots.length, 1);
});

test('pressure draws fading air rings from the muzzle to the floor', () => {
  const scene = new THREE.Scene();
  const effects = new Effects(scene, { get: () => 0 });
  const from = [0.2, 1.4, 0],
    at = [0, 0, -1];
  effects.pressure(from, at);
  assert.equal(effects.items.length, 5);
  effects.update(0.1, [0, 1.6, 0]);
  for (const item of effects.items) assert.ok(item.mesh.scale.x > 0 && item.mesh.material.opacity > 0);
  effects.update(0.4, [0, 1.6, 0]);
  assert.equal(effects.items.length, 0, 'rings fade and are disposed');
});

test('pausing or losing a device cancels pending shots and charging without firing on release', () => {
  let ready = false;
  const game = { me: { alive: true }, gun: { ready: () => ready, setCharge() {} } };
  const arsenal = new Arsenal(game);
  const shots = [];
  arsenal.fire = (name, alt) => shots.push({ name, alt });
  arsenal.setPrimary(true);
  arsenal.setSecondary(true, 1000);
  arsenal.update(1000);
  arsenal.cancelInput();
  ready = true;
  arsenal.update(1100);
  assert.deepEqual(shots, [], 'raising a weapon after pausing cannot fire a queued tap');
  arsenal.weapon = 'rail';
  arsenal.secondary = true;
  arsenal.chargeStart = 1100;
  arsenal.cancelInput();
  arsenal.setSecondary(false, 5000);
  arsenal.update(5000);
  assert.deepEqual(shots, [], 'cancelling a charge is not a trigger release shot');
  assert.equal(arsenal.charge(5000), 0);
  arsenal.setPrimary(true);
  arsenal.update(5100);
  assert.deepEqual(shots, [{ name: 'rail', alt: false }], 'fresh input after resume still fires');
});

test('unknown or stale weapon selection is rejected without throwing or changing the held weapon', () => {
  const arsenal = new Arsenal({});
  const before = arsenal.weapon;
  assert.equal(arsenal.select('retired-weapon'), false);
  assert.equal(arsenal.weapon, before);
});
