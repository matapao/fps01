// The weapons in your hands, and your juggling balls (tricks.js). They have their own scene and camera:
// drawn after the world with the depth buffer cleared, so they never poke into walls, and with a
// narrower field of view. Each model is an asset (weapons/rifle … in assets/assets.json); a weapon
// says which it shows, how hard it kicks back and how long its muzzle flashes (data/weapons.json).

import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { createTricks } from './tricks.js';

const SWITCH = 0.3; // seconds to lower one weapon and raise the next
// The model in your hands for what you hold: a weapon's, a special's, or your juggling balls.
/** @param {string} held */
const lookOf = (held) =>
  held === 'special' || held === 'trick' ? held : (WEAPONS[held]?.model ?? '').replace(/^weapons\//, '');
/** @type {Record<string,number>} */
const SPECIAL_COLORS = {
  woolly: 0xf4f1e8,
  splitter: 0xffe14d,
  choir: 0xffc933,
  airstrike: 0xff4d3d,
  pilot: 0x5dff7a,
  teleport: 0xc77dff,
};

export function createGun() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10); // sits at the origin, looking down -z
  camera.updateMatrixWorld();
  const ambient = new THREE.HemisphereLight(0xe4eef8, 0x4a4136, 2.2);
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(-1, 2, 2);
  scene.add(ambient, light);

  /** @type {THREE.MeshStandardMaterial[]} */
  const materials = []; // every material, so Shimmer can make them all see-through
  /** @param {THREE.MeshStandardMaterialParameters} options */
  const material = (options) => {
    const made = new THREE.MeshStandardMaterial(options);
    materials.push(made);
    return made;
  };
  const metal = material({ color: 0x4a525e, roughness: 0.45, metalness: 0.4 });
  const dark = material({ color: 0x2b3038, roughness: 0.6 });
  const accent = material({ color: 0xff8a2a, roughness: 0.5 });
  const olive = material({ color: 0x55663a, roughness: 0.6 });
  const wood = material({ color: 0x7a4a2a, roughness: 0.75 });
  const red = material({ color: 0xc8392b, roughness: 0.5 });
  const coil = material({ color: 0x6fd3ff, emissive: 0x2a9bd6, emissiveIntensity: 1.2, roughness: 0.3 });
  const strip = material({ color: 0x3f8f30, emissive: 0x2fd12f, emissiveIntensity: 0.25, roughness: 0.3 });
  /** @param {import('./contracts.js').Vec3} size @param {THREE.Material} look @param {import('./contracts.js').Vec3} position */
  const part = (size, look, position, tilt = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), look);
    mesh.position.set(...position);
    mesh.rotation.x = tilt;
    return mesh;
  };
  // A cylinder along z.
  /** @param {number} radius @param {number} length @param {THREE.Material} look @param {import('./contracts.js').Vec3} at */
  const tube = (radius, length, look, [x, y, z], segments = 16) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), look);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    return mesh;
  };

  /** @type {Record<string,THREE.Group>} */
  const models = {};
  /** @type {Record<string,THREE.Object3D>} */
  const flashes = {};
  /** @param {string} name @param {number} flashSize @param {number} flashZ @param {THREE.Object3D[]} parts */
  const model = (name, flashSize, flashZ, ...parts) => {
    const group = new THREE.Group();
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(flashSize, 8, 6),
      new THREE.MeshBasicMaterial({ color: name === 'spark' ? 0x9fe6ff : 0xffd27a }),
    );
    flash.position.set(0, 0.008, flashZ);
    flash.visible = false;
    group.add(...parts, flash);
    group.visible = false;
    models[name] = group;
    flashes[name] = flash;
  };

  model(
    'rifle',
    0.025,
    -0.3,
    part([0.045, 0.06, 0.28], metal, [0, 0, 0]), // body
    part([0.02, 0.02, 0.16], dark, [0, 0.008, -0.21]), // barrel
    part([0.015, 0.02, 0.05], accent, [0, 0.04, -0.03]), // sight
    part([0.03, 0.07, 0.05], dark, [0, -0.06, -0.05]), // magazine
    part([0.032, 0.08, 0.045], dark, [0, -0.065, 0.075], 0.3), // grip
  );
  model(
    'shotgun',
    0.05,
    -0.33,
    tube(0.015, 0.3, dark, [-0.016, 0.012, -0.16]), // two barrels
    tube(0.015, 0.3, dark, [0.016, 0.012, -0.16]),
    part([0.06, 0.055, 0.14], metal, [0, -0.005, 0.03]), // receiver
    part([0.05, 0.035, 0.12], wood, [0, -0.025, -0.13]), // pump
    part([0.045, 0.07, 0.13], wood, [0, -0.04, 0.15], -0.25), // stock
    part([0.012, 0.012, 0.012], accent, [0, 0.032, -0.29]), // bead sight
  );
  const band = material({ color: 0xff8a2a, roughness: 0.5 });
  model(
    'launcher',
    0.045,
    -0.31,
    tube(0.04, 0.34, dark, [0, 0.012, -0.12]), // barrel
    tube(0.043, 0.035, band, [0, 0.012, -0.27]), // muzzle band
    tube(0.043, 0.02, band, [0, 0.012, 0.02]), // rear band
    part([0.065, 0.075, 0.17], olive, [0, -0.02, 0.03]), // body
    part([0.03, 0.06, 0.04], dark, [0, -0.06, -0.16]), // front grip
    part([0.012, 0.035, 0.012], accent, [0, 0.07, -0.2]), // sight post
    part([0.032, 0.09, 0.045], dark, [0, -0.08, 0.06], 0.3), // grip
  );
  model(
    'rocket',
    0.06,
    -0.36,
    tube(0.045, 0.4, olive, [0, 0.02, -0.1], 18), // tube
    tube(0.05, 0.045, red, [0, 0.02, -0.3], 18), // muzzle ring
    tube(0.05, 0.035, dark, [0, 0.02, 0.09], 18), // back ring
    part([0.025, 0.04, 0.07], accent, [0.05, 0.05, -0.06]), // sight box
    part([0.032, 0.09, 0.045], dark, [0, -0.07, 0], 0.3), // grip
  );
  model(
    'spark',
    0.03,
    -0.31,
    tube(0.01, 0.3, metal, [0, 0.012, -0.16]), // rod
    tube(0.02, 0.014, coil, [0, 0.012, -0.27]), // coils
    tube(0.022, 0.014, coil, [0, 0.012, -0.22]),
    tube(0.024, 0.014, coil, [0, 0.012, -0.17]),
    part([0.055, 0.06, 0.15], dark, [0, -0.01, 0]), // body
    part([0.006, 0.025, 0.025], metal, [0.016, 0.03, -0.3]), // prongs
    part([0.006, 0.025, 0.025], metal, [-0.016, 0.03, -0.3]),
    part([0.032, 0.08, 0.045], dark, [0, -0.065, 0.05], 0.3), // grip
  );
  model(
    'rail',
    0.03,
    -0.38,
    part([0.04, 0.05, 0.34], metal, [0, 0, -0.12]), // body
    part([0.008, 0.006, 0.28], strip, [0, 0.028, -0.13]), // glowing strip, brighter as it charges
    tube(0.012, 0.1, dark, [0, 0.005, -0.33]), // muzzle
    part([0.03, 0.04, 0.1], dark, [0, -0.04, 0]), // battery
    part([0.032, 0.08, 0.045], dark, [0, -0.065, 0.04], 0.3), // grip
  );

  // A special from a crate: a little device with a big light in the colour of what it is.
  const specialLight = new THREE.MeshBasicMaterial({ color: 0xffffff });
  model(
    'special',
    0.03,
    -0.12,
    part([0.07, 0.11, 0.05], dark, [0, -0.02, -0.04]), // body
    part([0.008, 0.08, 0.008], metal, [0.02, 0.07, -0.04]), // aerial
    new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), specialLight), // the light
    part([0.032, 0.08, 0.045], dark, [0, -0.09, 0.0], 0.3), // grip
  );
  const specialBulb = models['special']?.children[2];
  if (!specialBulb) throw new Error('Special weapon model has no light');
  specialBulb.position.set(-0.012, 0.042, -0.05);

  const holder = new THREE.Group();
  holder.add(...Object.values(models));
  const rest = new THREE.Vector3(0.14, -0.13, -0.34);
  holder.position.copy(rest);
  scene.add(holder);

  // The juggling balls: both hands, in the middle, not off to the right like a gun.
  const tricks = createTricks();
  tricks.group.position.set(-rest.x, -rest.y, -rest.z);
  tricks.group.visible = false;
  models['trick'] = tricks.group;
  flashes['trick'] = new THREE.Object3D(); // nothing comes out of it
  tricks.group.add(flashes['trick']);
  holder.add(tricks.group);
  let motion = 0; // how fast you're running, 0 to 1

  let weapon = 'rifle'; // the model in your hands
  let next = 'rifle';
  let held = 'rifle'; // what you hold: a weapon's id, special or trick
  const firstModel = models['rifle'];
  if (!firstModel) throw new Error('Rifle weapon model is missing');
  firstModel.visible = true;
  let switching = 0; // seconds left of lowering one weapon and raising the other
  let recoil = 0;
  let flashTime = 0;
  let melee = 0; // a kick: the gun swings out of the way of your boot
  let cloaked = false;
  const tip = new THREE.Vector3();

  return {
    scene,
    camera,
    /** @param {string} name */
    setWeapon(name) {
      const look = lookOf(name);
      held = name;
      if (look === next || !models[look]) return;
      next = look;
      switching = SWITCH;
    },
    // You can fire once the weapon is all the way up.
    ready: () => switching <= 0,
    // The gun is only as lit as where you are (0 to 1).
    /** @param {number} level */
    setLight(level) {
      ambient.intensity = 2.2 * Math.max(level, 0.04);
      light.intensity = Math.max(2 * level, 0.05);
    },
    // What the grenade launcher is loaded with: its bands show it.
    /** @param {THREE.ColorRepresentation} color */
    setBand(color) {
      band.color.set(color);
    },
    kick(pressure = false) {
      recoil = WEAPONS[held]?.recoil ?? 1;
      flashTime = WEAPONS[held]?.flash ?? 0;
      const flash = flashes[weapon];
      if (flash instanceof THREE.Mesh && flash.material instanceof THREE.MeshBasicMaterial)
        flash.material.color.set(pressure ? 0xc6efff : weapon === 'spark' ? 0x9fe6ff : 0xffd27a);
    },
    // The kick (V): the gun swings down and aside for a moment.
    swing() {
      melee = 0.35;
    },
    // Which special is in your hands: its light shows it.
    /** @param {string|null} kind */
    setSpecial(kind) {
      specialLight.color.set((kind ? SPECIAL_COLORS[kind] : undefined) ?? 0xffffff);
    },
    // A railgun's charge, 0 to 1: its strip glows brighter.
    /** @param {number} amount */
    setCharge(amount) {
      strip.emissiveIntensity = 0.25 + amount * 2.5;
    },
    // On to the next juggling trick (returns its name).
    nextTrick: () => tricks.next(),
    // A juggling ball thrown: it leaves your hand, and is back in ms.
    /** @param {number} ms */
    tossTrick(ms) {
      tricks.toss(ms);
    },
    // How fast you're running, 0 to 1: the juggling gets livelier.
    /** @param {number} amount */
    setMotion(amount) {
      motion += (amount - motion) * 0.15;
    },
    // While you're invisible, your own gun is see-through too.
    /** @param {boolean} on */
    setCloak(on) {
      if (on === cloaked) return;
      cloaked = on;
      for (const look of materials) {
        look.transparent = on;
        look.opacity = on ? 0.22 : 1;
        look.needsUpdate = true;
      }
    },
    /** @param {number} dt @param {boolean} visible */
    update(dt, visible) {
      holder.visible = visible;
      if (switching > 0) {
        switching = Math.max(0, switching - dt);
        if (switching <= SWITCH / 2 && weapon !== next) {
          const previousModel = models[weapon],
            nextModel = models[next];
          if (!previousModel || !nextModel) throw new Error('Unknown weapon model during switch');
          previousModel.visible = false;
          weapon = next;
          nextModel.visible = true;
        }
      }
      const lowered = switching > 0 ? Math.sin((1 - switching / SWITCH) * Math.PI) : 0;
      const swung = melee > 0 ? Math.sin((1 - melee / 0.35) * Math.PI) : 0;
      melee = Math.max(0, melee - dt);
      recoil = Math.max(0, recoil - dt * 8);
      holder.position.set(
        rest.x + swung * 0.08,
        rest.y - lowered * 0.22 - swung * 0.12,
        rest.z + recoil * 0.04,
      );
      holder.rotation.x = recoil * 0.1 - lowered * 0.5 - swung * 0.6;
      holder.rotation.z = swung * 0.5;
      flashTime -= dt;
      for (const [name, flash] of Object.entries(flashes))
        flash.visible = name === weapon && flashTime > 0 && name !== 'trick';
      if (weapon === 'trick' && visible) tricks.update(dt, performance.now(), motion);
    },
    // A point in the world that shows up where the drawn barrel ends, for the start of a tracer.
    /** @param {THREE.Camera} worldCamera */
    muzzle(worldCamera) {
      holder.updateMatrixWorld(true);
      const flash = flashes[weapon];
      if (!flash) throw new Error('Unknown weapon muzzle');
      flash.getWorldPosition(tip).project(camera);
      tip.z = 0.5;
      tip.unproject(worldCamera).sub(worldCamera.position).setLength(0.6).add(worldCamera.position);
      return tip.toArray();
    },
  };
}
