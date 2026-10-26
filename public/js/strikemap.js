// The air strike's map: the arena seen from above. The floor is light, what stands on
// it is dark (lighter the higher it is), holes are black; players are dots in their colours. Moving
// the mouse moves the target, and the five red circles show where the missiles will land, in a line
// across your view.

import { AIRSTRIKE } from '/shared/loot.js';
import { AIR, ARENA_HALF, BEAM, CELL, GRID_MIN, GRID_SIZE, MAP } from '/shared/map.js';
import { PROJECTILES } from '/shared/weapons.js';

import { lookup } from '/shared/indexed.js';
import { element, context2d } from './dom.js';

const [NX, NY, NZ] = GRID_SIZE;

export class StrikeMap {
  constructor() {
    this.overlay = element('strike', HTMLElement);
    this.canvas = element('strike-map', HTMLCanvasElement);
    this.title = element('strike-floor', HTMLElement);
    this.ctx = context2d(this.canvas);
    this.background = document.createElement('canvas');
    this.background.width = this.canvas.width;
    this.background.height = this.canvas.height;
    this.scale = this.canvas.width / NX; // pixels per cell
    this.open = false;
    /** @type {[number, number]} */
    this.cursor = [0, 0]; // where the strike is aimed, as world x and z
    /** @type {[number, number]} */
    this.across = [1, 0]; // which way the line of missiles runs
  }

  // Opens aimed where you are, the line across your view.
  /** @param {import('../../shared/voxels.js').Voxels} voxels @param {import('./contracts.d.ts').Vec3} feet @param {import('./contracts.d.ts').Vec3} look */
  show(voxels, feet, look) {
    this.open = true;
    this.cursor = [feet[0], feet[2]];
    const flat = Math.hypot(look[0], look[2]) || 1;
    this.across = [look[0] / flat, look[2] / flat];
    this.title.textContent = MAP.name;
    this /** @param {import('../../shared/voxels.js').Voxels} voxels */.drawBackground(voxels);
    this.overlay.hidden = false;
  }

  hide() {
    this.open = false;
    this.overlay.hidden = true;
  }

  // The mouse moves the target: the whole map is about a hand's sweep across.
  /** @param {number} dx @param {number} dy */
  move(dx, dy) {
    const metres = (ARENA_HALF * 2) / 500;
    this.cursor = [
      Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.cursor[0] + dx * metres)),
      Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.cursor[1] + dy * metres)),
    ];
  }

  // Where the strike goes: the missiles come down out of the sky onto whatever is there.
  /** @returns {import('./contracts.d.ts').Vec3} */
  target() {
    return [this.cursor[0], 0, this.cursor[1]];
  }

  /** @param {import('../../shared/voxels.js').Voxels} voxels */
  drawBackground(voxels) {
    const ctx = context2d(this.background);
    const under = Math.min(NY, Math.floor((MAP.roof.at - BEAM - GRID_MIN[1]) / CELL)) - 1; // the layer just under the roof's beam
    for (let iz = 0; iz < NZ; iz++) {
      for (let ix = 0; ix < NX; ix++) {
        let top = -1; // the highest solid cell under the roof
        for (let iy = under; iy >= 0 && top < 0; iy--) if (voxels.get(ix, iy, iz) !== AIR) top = iy;
        if (top < 0) ctx.fillStyle = '#05070a';
        else if (top === 0) ctx.fillStyle = ((ix >> 1) + (iz >> 1)) % 2 ? '#8d96a3' : '#97a0ad';
        else ctx.fillStyle = `hsl(215, 14%, ${Math.min(52, 16 + top * 1.6)}%)`;
        ctx.fillRect(ix * this.scale, iz * this.scale, this.scale, this.scale);
      }
    }
  }

  // Every frame while it's open: the arena, everyone in it, and where the missiles would land.
  /** @param {import('../../shared/runtime-types.ts').PlayerSnapshot[]} players @param {number | null} selfId @param {(id: number) => string} colorOf */
  draw(players, selfId, colorOf) {
    if (!this.open) return;
    const { ctx, scale } = this;
    /** @param {number} x */
    const px = (x) => ((x - GRID_MIN[0]) / CELL) * scale;
    /** @param {number} z */
    const pz = (z) => ((z - GRID_MIN[2]) / CELL) * scale;
    ctx.drawImage(this.background, 0, 0);
    for (const player of players) {
      if (!player.alive) continue;
      ctx.fillStyle = colorOf(player.id);
      ctx.beginPath();
      ctx.arc(px(player.feet[0]), pz(player.feet[2]), player.id === selfId ? 6 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (player.id === selfId) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    if (!AIRSTRIKE) throw new Error('Air strike data is missing');
    const { missiles, spacing } = AIRSTRIKE;
    const missile = lookup(PROJECTILES, 'missile');
    if (!missile.blast) throw new Error('Air strike missile requires blast data');
    const radius = (missile.blast.radius / CELL) * scale;
    ctx.strokeStyle = 'rgba(255, 70, 50, 0.95)';
    ctx.fillStyle = 'rgba(255, 70, 50, 0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i < missiles; i++) {
      const offset = (i - (missiles - 1) / 2) * spacing;
      ctx.beginPath();
      ctx.arc(
        px(this.cursor[0] + this.across[0] * offset),
        pz(this.cursor[1] + this.across[1] * offset),
        radius,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    }
    // The target's crosshair.
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px(this.cursor[0]) - 10, pz(this.cursor[1]));
    ctx.lineTo(px(this.cursor[0]) + 10, pz(this.cursor[1]));
    ctx.moveTo(px(this.cursor[0]), pz(this.cursor[1]) - 10);
    ctx.lineTo(px(this.cursor[0]), pz(this.cursor[1]) + 10);
    ctx.stroke();
  }
}
