// The other players: drawn where the server last saw them, eased so 30 updates a second look smooth.
// Each is made of 100 boxes, one for each point of health, round a white skeleton (body.js): hits
// knock the flesh off and leave bare bone, and a kill sends every box flying. Armor glows gold on them, health above 100 glows blue, and a powerup
// in its own colour. With their juggling balls out instead of a gun, they juggle as they go.

import * as THREE from 'three';
import { HEAD_HEIGHT, MAX_HEALTH, PLAYER_HEIGHT, PLAYER_RADIUS } from '/shared/constants.js';
import { onData } from '/shared/data.js';
import { THROW } from '/shared/tricks.js';
import { POWERUPS } from '/shared/loot.js';
import { playerBox, rayBox } from '/shared/physics.js';
import { HEALTH_BOXES, createBody } from './body.js';

const gunGeometry = new THREE.BoxGeometry(0.1, 0.12, 0.6);
const gunMaterial = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.5 });
/** @type {Record<string,string>} */
export let TEAM_COLORS = {}; // capture the flag's two teams' colours (data/characters.json)
// How many of the 100 boxes have their colour on at so much health: all of them at the most
// health pickups give, one at 1.
/** @param {number} hp */
const boxesFor = (hp) => Math.min(HEALTH_BOXES, Math.ceil((Math.max(0, hp) * HEALTH_BOXES) / MAX_HEALTH));
const shieldGeometry = new THREE.CapsuleGeometry(
  PLAYER_RADIUS + 0.12,
  PLAYER_HEIGHT - PLAYER_RADIUS * 2,
  4,
  14,
);

// The leader's crown: a gold band with five points.
const gold = new THREE.MeshStandardMaterial({
  color: 0xffd04a,
  metalness: 0.6,
  roughness: 0.25,
  emissive: 0x8a5e00,
});
function crown() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.1, 20, 1, true), gold));
  for (let i = 0; i < 5; i++) {
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 6), gold);
    const angle = (i / 5) * Math.PI * 2;
    point.position.set(Math.sin(angle) * 0.16, 0.1, Math.cos(angle) * 0.16);
    group.add(point);
  }
  group.position.y = PLAYER_HEIGHT + 0.14;
  group.scale.setScalar(1.35);
  group.visible = false;
  return group;
}

// A flag on the back of whoever carries one, in capture the flag.
const poleGeometry = new THREE.CylinderGeometry(0.02, 0.02, 1, 6);
const bannerGeometry = new THREE.PlaneGeometry(0.5, 0.32).translate(0.25, 0, 0);
const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.4, metalness: 0.5 });
/** @type {Record<string,THREE.MeshStandardMaterial>} */
const bannerMaterials = Object.fromEntries(
  ['red', 'blue'].map((team) => [
    team,
    new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, emissiveIntensity: 0.25 }),
  ]),
);
onData(({ characters }) => {
  TEAM_COLORS = {
    red: characters.teams?.red.color ?? '#e8524a',
    blue: characters.teams?.blue.color ?? '#3d8bfd',
  };
  for (const [team, material] of Object.entries(bannerMaterials)) {
    material.color.set(TEAM_COLORS[team] ?? '#ffffff');
    material.emissive.set(TEAM_COLORS[team] ?? '#ffffff');
  }
});
function backFlag() {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(poleGeometry, poleMaterial);
  const banner = new THREE.Mesh(bannerGeometry, bannerMaterials['red']);
  banner.position.set(0, 0.32, 0);
  group.add(pole, banner);
  group.position.set(0.12, 1.65, 0.32); // over the shoulder, at their back
  group.rotation.z = -0.25;
  group.visible = false;
  return { group, banner };
}

// ---- Juggling, as everyone else sees it ----

/** @param {number} a @param {number} b @param {number} k */
const lerp = (a, b, k) => a + (b - a) * k;
/** @param {number} v @param {number} n */
const mod = (v, n) => ((v % n) + n) % n;
const BALL_COLORS = [0xe8524a, 0xf2c14e, 0x3d8bfd];
const ballGeometry = new THREE.SphereGeometry(0.065, 12, 8);

// Someone's juggling balls, in front of them.
function juggling() {
  const group = new THREE.Group();
  group.position.set(0, 1.05, -0.42);
  const balls = BALL_COLORS.map(
    (color) => new THREE.Mesh(ballGeometry, new THREE.MeshStandardMaterial({ color, roughness: 0.4 })),
  );
  group.add(...balls);
  return { group, balls, gone: -1, back: 0 }; // gone: the ball they threw, out of it until back
}

// Moves someone's juggling along: a cascade above their hands, missing the ball they just threw.
/** @param {ReturnType<typeof juggling>} showoff @param {number} t @param {number} now */
function juggle(showoff, t, now) {
  showoff.balls.forEach((ball, i) => {
    ball.visible = !(i === showoff.gone && now < showoff.back);
    const b = mod(t / 0.25 - i, 6);
    const from = i % 2 === 0 ? 1 : -1;
    const u = b < 2 ? b / 2 : b < 3 ? b - 2 : b < 5 ? (b - 3) / 2 : b - 5;
    if (b < 2 || (b >= 3 && b < 5)) {
      const side = b < 2 ? from : -from;
      ball.position.set(lerp(side * 0.12, -side * 0.32, u), 4 * 0.5 * u * (1 - u), 0);
    } else {
      const side = b < 3 ? -from : from;
      ball.position.set(side * lerp(0.32, 0.12, u), -Math.sin(Math.PI * u) * 0.06, 0);
    }
  });
}

export class Avatars {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<number,ReturnType<typeof createAvatar>>} */
    this.byId = new Map();
  }

  /** @param {import('./render-contracts.js').AvatarPlayer[]} players @param {number|null} selfId */
  sync(players, selfId) {
    const present = new Set();
    for (const player of players) {
      if (player.id === selfId) continue;
      present.add(player.id);
      let avatar = this.byId.get(player.id);
      if (!avatar) {
        avatar = createAvatar(player);
        avatar.group.position.fromArray(player.feet);
        avatar.yaw = player.yaw;
        this.byId.set(player.id, avatar);
        this.scene.add(avatar.group);
      }
      avatar.target.fromArray(player.feet);
      avatar.targetYaw = player.yaw;
      avatar.group.visible = player.alive;
      avatar.body.setColor(player.team ? (TEAM_COLORS[player.team] ?? player.color) : player.color);
      // As many boxes with their colour on as they have health: back it comes as they heal (none
      // above 100: that glows).
      if (player.alive) avatar.body.restore(boxesFor(player.hp));
      avatar.armor = player.armor ?? 0;
      avatar.overheal = Math.max(0, Math.min(1, (player.hp - MAX_HEALTH) / MAX_HEALTH));
      avatar.shield.visible = Boolean(player.shielded) && player.alive;
      avatar.flag.group.visible = Boolean(player.carrying);
      const flagMaterial = player.carrying ? bannerMaterials[player.carrying] : null;
      if (flagMaterial) avatar.flag.banner.material = flagMaterial;
      avatar.setCloak(Boolean(player.cloaked));
      avatar.setHeld(player.held);
      // A powerup shows as a glow in its colour around them (Shimmer shows as a cloak).
      const glow = player.powerup && player.powerup !== 'shimmer' ? POWERUPS[player.powerup]?.color : null;
      avatar.aura.visible = Boolean(glow) && player.alive && !player.cloaked;
      if (glow) avatar.aura.material.color.set(glow);
    }
    for (const [id, avatar] of this.byId) {
      if (present.has(id)) continue;
      this.scene.remove(avatar.group);
      avatar.dispose();
      this.byId.delete(id);
    }
  }

  // Someone threw one of their juggling balls: it's out of their juggling for a moment.
  /** @param {number} id */
  tossed(id) {
    const showoff = this.byId.get(id)?.showoff;
    if (!showoff) return;
    showoff.gone = (showoff.gone + 1) % 3;
    showoff.back = performance.now() + THROW.cooldownMs;
  }

  // Jumps straight to a new spawn point instead of sliding across the map.
  /** @param {number} id @param {import('./contracts.js').Vec3} feet @param {number} yaw */
  teleport(id, feet, yaw) {
    const avatar = this.byId.get(id);
    if (!avatar) return;
    avatar.group.position.fromArray(feet);
    avatar.target.fromArray(feet);
    avatar.yaw = avatar.targetYaw = yaw;
    avatar.body.whole(); // a new life, a whole body
  }

  // Someone was hit, down to hp: takes the colour off a box for every point of health they lost,
  // from the feet up (body.js): flesh comes off, bone goes white. Returns what comes off, as
  // [{ at, color, chip }] in the world, for throwing about: a box of flesh, or a chip of colour off
  // a bone. A kill sends every box flying, bones and all.
  /** @param {number} id @param {number} hp */
  hurt(id, hp) {
    const avatar = this.byId.get(id);
    if (!avatar) return [];
    const { body, group } = avatar;
    group.updateMatrixWorld();
    /** @param {number} i */
    const where = (i) => group.localToWorld(new THREE.Vector3().fromArray(body.boxAt(i))).toArray();
    if (hp <= 0) return body.shatter().map((i) => ({ at: where(i), color: body.colorOf(i), chip: false }));
    const lost = body.count - boxesFor(hp);
    if (lost <= 0) return [];
    return body.hurt(lost).map(({ i, bone, color }) => ({ at: where(i), color, chip: bone }));
  }

  // onStep(at) is called for each footstep someone takes, so it can play where they are.
  /** @param {number} dt @param {((at:import('./contracts.js').Vec3)=>void)} [onStep] */
  update(dt, onStep) {
    const blend = 1 - Math.exp(-dt * 18);
    const now = performance.now();
    for (const avatar of this.byId.values()) {
      const before = avatar.group.position.clone();
      avatar.group.position.lerp(avatar.target, blend);
      // Footsteps: one every 2.6 m covered while running along a floor.
      const moved = before.distanceTo(avatar.group.position);
      const level = Math.abs(before.y - avatar.group.position.y) < 0.02;
      if (avatar.group.visible)
        avatar.body.pose(
          dt,
          level
            ? Math.hypot(avatar.group.position.x - before.x, avatar.group.position.z - before.z) /
                Math.max(dt, 1e-3)
            : 0,
        );
      // Armor glows gold on them, and health above 100 glows blue around them.
      const glint = 0.85 + Math.sin(now / 160) * 0.15;
      const armored = Math.min(1, avatar.armor / 150);
      avatar.body.material.emissiveIntensity = armored * 0.12 * glint;
      avatar.armorShell.visible = avatar.armor > 0 && !avatar.cloaked;
      avatar.armorShell.material.opacity = (0.1 + armored * 0.25) * (0.75 + Math.sin(now / 110) * 0.25);
      avatar.overhealShell.visible = avatar.overheal > 0 && !avatar.cloaked;
      avatar.overhealShell.material.opacity = (0.08 + avatar.overheal * 0.22) * glint;
      avatar.stepClock =
        level && moved / Math.max(dt, 1e-3) > 2 && avatar.group.visible ? (avatar.stepClock ?? 0) + moved : 0;
      if (avatar.stepClock > 2.6) {
        avatar.stepClock = 0;
        onStep?.(avatar.group.position.toArray());
      }
      avatar.shield.material.opacity = 0.18 + Math.sin(now / 90) * 0.08;
      avatar.aura.material.opacity = 0.22 + Math.sin(now / 140) * 0.1;
      // Someone invisible is a faint shimmer.
      if (avatar.cloaked) avatar.body.material.opacity = 0.05 + Math.max(0, Math.sin(now / 70)) * 0.05;
      avatar.yaw += shortestAngle(avatar.targetYaw - avatar.yaw) * blend;
      avatar.group.rotation.y = avatar.yaw;
      avatar.crown.rotation.y = now / 900;
      avatar.flag.banner.rotation.y = Math.sin(now / 160) * 0.25; // flapping
      if (avatar.showoff?.group.visible) juggle(avatar.showoff, now / 1000, now);
    }
  }

  // The nearest visible player along a ray, as { id, distance, head }, if one is closer than maxDistance.
  /** @param {import('./contracts.js').Vec3} origin @param {import('./contracts.js').Vec3} dir @param {number} maxDistance */
  raycast(origin, dir, maxDistance) {
    let best = null;
    for (const [id, avatar] of this.byId) {
      if (!avatar.group.visible) continue;
      const feet = avatar.group.position.toArray();
      const distance = rayBox(origin, dir, playerBox(feet));
      if (distance >= maxDistance || (best && distance >= best.distance)) continue;
      const hitHeight = origin[1] + dir[1] * distance - feet[1];
      best = { id, distance, head: hitHeight >= HEAD_HEIGHT };
    }
    return best;
  }

  // Every visible player along a ray, nearest first, up to maxDistance: what a railgun goes through.
  /** @param {import('./contracts.js').Vec3} origin @param {import('./contracts.js').Vec3} dir @param {number} maxDistance */
  raycastAll(origin, dir, maxDistance) {
    const hits = [];
    for (const [id, avatar] of this.byId) {
      if (!avatar.group.visible) continue;
      const feet = avatar.group.position.toArray();
      const distance = rayBox(origin, dir, playerBox(feet));
      if (distance >= maxDistance) continue;
      hits.push({ id, distance, head: origin[1] + dir[1] * distance - feet[1] >= HEAD_HEIGHT });
    }
    return hits.sort((a, b) => a.distance - b.distance);
  }

  // Where another player's gun is, so their tracers start at the barrel instead of their eyes.
  /** @param {number} id */
  muzzle(id) {
    const avatar = this.byId.get(id);
    return avatar?.group.visible ? avatar.muzzle.getWorldPosition(new THREE.Vector3()).toArray() : null;
  }

  // Where another player's eyes are and which way they look, smoothed like the rest of them.
  /** @param {number} id @param {number} pitch @returns {{head:import('./contracts.js').Vec3,dir:import('./contracts.js').Vec3}|null} */
  pose(id, pitch) {
    const avatar = this.byId.get(id);
    if (!avatar?.group.visible) return null;
    const { x, y, z } = avatar.group.position;
    const dir = /** @type {import('./contracts.js').Vec3} */ ([
      -Math.sin(avatar.yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(avatar.yaw) * Math.cos(pitch),
    ]);
    return { head: [x, y + 1.62, z], dir };
  }

  // The leader wears a crown (null: nobody, or you).
  /** @param {number|null} id */
  setLeader(id) {
    for (const [avatarId, avatar] of this.byId) avatar.crown.visible = avatarId === id;
  }

  // Where another player's free hand is, which holds their grappling hook's rope.
  /** @param {number} id */
  hand(id) {
    const avatar = this.byId.get(id);
    return avatar?.group.visible ? avatar.hand.getWorldPosition(new THREE.Vector3()).toArray() : null;
  }
}

/** @param {import('./render-contracts.js').AvatarPlayer} player */
function createAvatar(player) {
  const group = new THREE.Group();
  const body = createBody(player.color);
  const bodyMaterial = body.material;
  bodyMaterial.emissive.set(0xffc84a); // armor's glow, when they have some
  bodyMaterial.emissiveIntensity = 0;
  const gun = new THREE.Mesh(gunGeometry, gunMaterial);
  gun.position.set(0.32, 1.15, -0.4);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.3);
  gun.add(muzzle);
  const hand = new THREE.Object3D();
  hand.position.set(-0.36, 1.2, -0.3);
  const leader = crown();
  const flag = backFlag();
  // Spawn protection: a shimmering shell, for the second after someone spawns.
  const shield = new THREE.Mesh(
    shieldGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x7fe9ff,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  shield.position.y = PLAYER_HEIGHT / 2;
  shield.visible = false;
  const aura = new THREE.Mesh(
    shieldGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  aura.position.y = PLAYER_HEIGHT / 2;
  aura.scale.setScalar(1.08);
  aura.visible = false;
  // Health above 100 (a Health Orb): a blue glow around them, as strong as how much more they have.
  const overhealShell = new THREE.Mesh(
    shieldGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x5fa8ff,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  overhealShell.position.y = PLAYER_HEIGHT / 2;
  overhealShell.scale.setScalar(1.16);
  overhealShell.visible = false;
  // Armor: a gold shimmer, close round them.
  const armorShell = new THREE.Mesh(
    shieldGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xffc23a,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  armorShell.position.y = PLAYER_HEIGHT / 2;
  armorShell.scale.set(0.98, 1.02, 0.98);
  armorShell.visible = false;
  group.add(body.mesh, gun, hand, leader, flag.group, shield, aura, overhealShell, armorShell);

  return {
    group,
    body,
    cloaked: false,
    // Invisible (a powerup): their body all but invisible, and nothing else of them showing.
    /** @param {boolean} on */
    setCloak(on) {
      if (on === this.cloaked) return;
      this.cloaked = on;
      bodyMaterial.transparent = on;
      bodyMaterial.opacity = 1;
      bodyMaterial.needsUpdate = true;
      this.setHeld(this.held);
    },
    armor: 0,
    overheal: 0, // health above 100, as a share of the most there can be (0 … 1)
    overhealShell,
    armorShell,
    showoff: /** @type {ReturnType<typeof juggling>|null} */ (null), // their juggling balls, once they've had them out
    held: /** @type {string|null} */ (null),
    stepClock: 0,
    // What's in their hands: a gun, or their juggling balls ('trick').
    /** @param {string|null} held */
    setHeld(held) {
      this.held = held;
      const tricking = held === 'trick';
      if (tricking && !this.showoff) {
        this.showoff = juggling();
        group.add(this.showoff.group);
      }
      if (this.showoff) this.showoff.group.visible = tricking && !this.cloaked;
      gun.visible = !tricking && !this.cloaked;
    },
    crown: leader,
    flag,
    shield,
    aura,
    muzzle,
    hand,
    target: new THREE.Vector3(),
    yaw: 0,
    targetYaw: 0,
    dispose() {
      body.dispose();
      aura.material.dispose();
      overhealShell.material.dispose();
      armorShell.material.dispose();
    },
  };
}

/** @param {number} angle */
function shortestAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
