// The radar in the corner: what's round you, out to its range (not the whole map), as the room's
// authority says it is. Pickups show in their piece's colour, there or dimmed with a ring that fills
// as they come back; a crate on its way down pings where it will land before it gets there, and
// stays a blip until someone takes it; a powerup shows on the pedestal, coming soon, or dropped.
// How it looks and what it shows is data/radar.json.

import { DATA } from '/shared/data.js';
import { POWERUPS } from '/shared/loot.js';
import { ITEMS, PEDESTAL } from '/shared/map.js';

import { context2d } from './dom.js';

const TAU = Math.PI * 2;

export class Radar {
  // canvas: the radar's own, in the HUD.
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.context = context2d(canvas);
    /** @type {number[]} */
    this.items = []; // per pickup spot: 0 when it's there, or the seconds until it's back
    /** @type {NonNullable<import('../../shared/runtime-types.ts').Snapshot['crates']>} */
    this.crates = []; // [[id, look, x, y, z, landed]]
    /** @type {import('../../shared/runtime-types.ts').Snapshot['powerups'] | null} */
    this.powerups = null; // { pedestal, soon, loose }
    /** @type {import('./browser-context.d.ts').Ping[]} */
    this.pings = []; // drops on their way: { at, start }
    this.size = 0;
    this.touch = false;
    this.drawnAt = -Infinity;
  }

  // Whether it's laid out for thumbs: smaller, clear of the buttons.
  /** @param {boolean} touch */
  setTouch(touch) {
    this.touch = touch;
    this.size = 0;
  }

  // What the latest snapshot says.
  /** @param {import('./browser-context.d.ts').RadarView} snapshot */
  sync({ items = [], crates = [], powerups = null }) {
    this.items = items;
    this.crates = crates;
    this.powerups = powerups;
  }

  // A crate is coming down: it pings where it will land.
  /** @param {import('./contracts.d.ts').Vec3} at @param {number} now */
  drop(at, now) {
    this.pings.push({ at, start: now });
  }

  // A new map, or a new round: nothing pinging.
  clear() {
    this.pings = [];
  }

  // Draws it, as often as the data says. me: { feet, yaw, alive }.
  /** @param {number} now @param {Pick<import('./browser-context.d.ts').ClientPlayer, 'feet' | 'yaw' | 'alive'>} me */
  update(now, me) {
    const radar = DATA.radar;
    this.canvas.hidden = !radar.show;
    if (!radar.show || now - this.drawnAt < 1000 / radar.refreshHz) return;
    this.drawnAt = now;
    this /** @param {import('../../shared/contracts.ts').Radar} radar */.layout(radar);
    const { context: c, size } = this;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.clearRect(0, 0, size, size);
    const r = size / 2 - 2;
    const unit = r / radar.range; // pixels per metre
    const blip = Math.max(3, size / 34); // a blip's radius, in pixels
    const colors = radar.colors;

    // The disc, its rings and its rim.
    c.save();
    c.translate(size / 2, size / 2);
    c.globalAlpha = 0.62;
    c.fillStyle = colors.disc;
    circle(c, 0, 0, r);
    c.fill();
    c.globalAlpha = 0.14;
    c.strokeStyle = colors.rings;
    c.lineWidth = 1;
    for (let k = 1; k <= radar.rings; k++) {
      circle(c, 0, 0, (r * k) / (radar.rings + 1));
      c.stroke();
    }
    c.globalAlpha = 0.5;
    c.strokeStyle = colors.rim;
    c.lineWidth = 1.5;
    circle(c, 0, 0, r);
    c.stroke();
    c.globalAlpha = 1;

    // Where something is on the radar: [x, y] in pixels from its middle, or null out of range.
    const turn = radar.turn === 'view';
    const [sin, cos] = [Math.sin(me.yaw), Math.cos(me.yaw)];
    /** @param {import('./contracts.d.ts').Vec3} point @param {boolean} [edge] @returns {import('./contracts.d.ts').Vec2 | null} */
    const place = ([x, , z], edge = false) => {
      const dx = x - me.feet[0];
      const dz = z - me.feet[2];
      let [px, py] = turn ? [dx * cos - dz * sin, dx * sin + dz * cos] : [dx, dz];
      const distance = Math.hypot(px, py);
      if (distance > radar.range) {
        if (!edge) return null;
        [px, py] = [(px / distance) * radar.range, (py / distance) * radar.range];
      }
      return [px * unit, py * unit];
    };
    /** @param {import('./contracts.d.ts').Vec3} point */
    const height = ([, y]) => (y - me.feet[1] > 3 ? 1 : y - me.feet[1] < -3 ? -1 : 0); // well above or below you

    // Pickups: there, or gone with a ring that fills as they come back.
    const shown = radar.pickups === 'all' ? null : new Set(radar.pickups);
    ITEMS.forEach((item, i) => {
      if (shown && !shown.has(item.piece)) return;
      const at = place(item.at);
      if (!at) return;
      const left = this.items[i] ?? 0;
      c.globalAlpha = left > 0 ? 0.35 : 1;
      c.fillStyle = item.color ?? '#ffffff';
      mark(
        c,
        item.kind === 'armor' ? 'diamond' : item.kind === 'weapon' ? 'square' : 'plus',
        at,
        blip * ((item.amount ?? 0) >= 100 ? 1.35 : 1),
      );
      c.globalAlpha = 1;
      if (left > 0) {
        const share = 1 - Math.min(1, (left * 1000) / item.respawnMs);
        c.strokeStyle = item.color ?? '#ffffff';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(at[0], at[1], blip * 1.7, -Math.PI / 2, -Math.PI / 2 + share * TAU);
        c.stroke();
        if (radar.countdown && !this.touch) label(c, String(left), at[0], at[1] + blip * 1.7 + 9, item.color);
      }
      tick(c, at, blip, height(item.at), item.color);
    });

    // Powerups: on the pedestal, or coming soon (a pulsing ring and its seconds), or dropped.
    if (radar.powerups && this.powerups && PEDESTAL) {
      const at = place(PEDESTAL);
      const { pedestal: kind, soon, loose = [] } = this.powerups;
      if (at && kind) {
        c.fillStyle = POWERUPS[kind]?.color ?? '#ffffff';
        mark(c, 'circle', at, blip * 1.25);
      } else if (at && soon) {
        c.strokeStyle = (soon.kind ? POWERUPS[soon.kind]?.color : undefined) ?? '#ffffff';
        c.globalAlpha = 0.5 + 0.5 * Math.sin(now / 120);
        c.lineWidth = 2;
        circle(c, at[0], at[1], blip * 1.4);
        c.stroke();
        c.globalAlpha = 1;
        if (radar.countdown && !this.touch)
          label(c, String(Math.ceil(soon.ms / 1000)), at[0], at[1] + blip * 1.4 + 9, c.strokeStyle);
      }
      for (const [, what, x, y, z] of loose) {
        const there = place([x, y, z]);
        if (!there) continue;
        c.fillStyle = (what ? POWERUPS[what]?.color : undefined) ?? '#ffffff';
        mark(c, 'circle', there, blip);
      }
    }

    // Crates: a blip (pulsing while it falls), and before that the ping where it will land.
    if (radar.drops) {
      for (const [, look, x, y, z, landed] of this.crates) {
        const at = place([x, y, z]);
        if (!at) continue;
        c.globalAlpha = landed ? 1 : 0.55 + 0.45 * Math.sin(now / 90);
        c.fillStyle = look === 'health' ? colors.healthCrate : colors.crate;
        mark(c, 'square', at, blip * 1.15);
        c.globalAlpha = 1;
      }
      const { style, ms, pulses, edge } = radar.ping;
      this.pings = this.pings.filter((ping) => now - ping.start < ms);
      for (const ping of this.pings) {
        const at = place(ping.at, edge);
        if (!at) continue;
        const t = (now - ping.start) / ms; // 0 … 1 over the whole ping
        c.strokeStyle = colors.drop;
        c.fillStyle = colors.drop;
        if (style !== 'flash') {
          for (let k = 0; k < pulses; k++) {
            const u = t * pulses - k; // this ring's own 0 … 1
            if (u < 0 || u > 1) continue;
            c.globalAlpha = 1 - u;
            c.lineWidth = 2;
            circle(c, at[0], at[1], blip + u * r * 0.32);
            c.stroke();
          }
        }
        if (style !== 'pulse') c.globalAlpha = Math.floor(t * pulses * 2) % 2 ? 0.25 : 1;
        else c.globalAlpha = 1;
        mark(c, 'circle', at, blip * 0.9);
        c.globalAlpha = 1;
      }
    }

    // You, in the middle: an arrow the way you look (up, when the radar turns with you).
    c.rotate(turn ? 0 : -me.yaw);
    c.globalAlpha = me.alive ? 1 : 0.4;
    c.fillStyle = colors.you;
    c.beginPath();
    c.moveTo(0, -blip * 1.8);
    c.lineTo(blip * 1.2, blip * 1.3);
    c.lineTo(0, blip * 0.6);
    c.lineTo(-blip * 1.2, blip * 1.3);
    c.closePath();
    c.fill();
    c.restore();
  }

  // The canvas's size, from the data: smaller for thumbs.
  /** @param {import('../../shared/contracts.ts').Radar} radar */
  layout(radar) {
    const size = this.touch ? Math.min(radar.touchSize, Math.round(window.innerHeight * 0.27)) : radar.size;
    if (size === this.size) return;
    this.size = size;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(size * scale);
    this.canvas.height = Math.round(size * scale);
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    document.documentElement.style.setProperty('--radar', `${size}px`);
  }
}

/** @param {CanvasRenderingContext2D} c @param {number} x @param {number} y @param {number} r */
function circle(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
}

// A blip: what shape says what it is (a cross for health, a diamond for armor, a square for a weapon or a crate).
/** @param {CanvasRenderingContext2D} c @param {string} shape @param {import('./contracts.d.ts').Vec2} point @param {number} r */
function mark(c, shape, [x, y], r) {
  c.beginPath();
  if (shape === 'plus') {
    const t = r * 0.42;
    c.rect(x - r, y - t, r * 2, t * 2);
    c.rect(x - t, y - r, t * 2, r * 2);
  } else if (shape === 'diamond') {
    c.moveTo(x, y - r * 1.15);
    c.lineTo(x + r, y);
    c.lineTo(x, y + r * 1.15);
    c.lineTo(x - r, y);
    c.closePath();
  } else if (shape === 'square') c.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  else c.arc(x, y, r, 0, TAU);
  c.fill();
  c.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  c.lineWidth = 1;
  c.stroke();
}

// Well above you, a tick over the blip; well below, under it.
/** @param {CanvasRenderingContext2D} c @param {import('./contracts.d.ts').Vec2} point @param {number} r @param {number} way @param {string | undefined} color */
function tick(c, [x, y], r, way, color) {
  if (!way) return;
  c.fillStyle = color ?? '#ffffff';
  c.beginPath();
  const top = y - way * (r + 3);
  c.moveTo(x - r * 0.7, top);
  c.lineTo(x + r * 0.7, top);
  c.lineTo(x, top - way * r * 0.8);
  c.closePath();
  c.fill();
}

/** @param {CanvasRenderingContext2D} c @param {string} text @param {number} x @param {number} y @param {string | CanvasGradient | CanvasPattern | undefined} color */
function label(c, text, x, y, color) {
  c.font = '600 10px system-ui, sans-serif';
  c.textAlign = 'center';
  c.lineWidth = 3;
  c.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  c.strokeText(text, x, y);
  c.fillStyle = color ?? '#ffffff';
  c.fillText(text, x, y);
}
