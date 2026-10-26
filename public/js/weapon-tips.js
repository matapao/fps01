// First-use lessons follow the weapon in hand. Pausing never consumes reading time.
import { WEAPONS } from '/shared/weapons.js';

const HOLD = 6;
const FADE = 0.8;
const READ = 2;

export class WeaponTips {
  /** @param {{read: () => string | null, write: (ids: string[]) => void, show: (tip: import('./browser-context.d.ts').WeaponTip | null) => void}} options */
  constructor({ read, write, show }) {
    this.write = write;
    this.show = show;
    /** @type {string | null} */
    this.selected = null;
    /** @type {{weapon: string, name: string, tips: NonNullable<import('../../shared/contracts.ts').Weapons['weapons'][number]['tips']>, elapsed: number} | null} */
    this.lesson = null;
    this.seen = new Set(/** @type {string[]} */ ([]));
    try {
      const saved = JSON.parse(read() ?? '[]');
      if (Array.isArray(saved))
        this.seen = new Set(saved.filter((id) => typeof id === 'string' && id.length <= 40).slice(0, 64));
    } catch {
      /* Unavailable or invalid storage: lessons still work for this visit. */
    }
  }

  /** @param {string} weapon @param {boolean} active @param {number} dt @param {string} [device] */
  update(weapon, active, dt, device = 'mouse') {
    if (!active) {
      this.show(null);
      return;
    }
    if (weapon !== this.selected) {
      this.selected = weapon;
      const spec = Object.hasOwn(WEAPONS, weapon) ? WEAPONS[weapon] : null;
      this.lesson =
        !this.seen.has(weapon) && spec?.tips
          ? { weapon, name: spec.name, tips: spec.tips, elapsed: 0 }
          : null;
    }
    const lesson = this.lesson;
    if (!lesson) {
      this.show(null);
      return;
    }
    lesson.elapsed += Math.max(0, dt);
    if (lesson.elapsed >= READ && !this.seen.has(weapon)) {
      this.seen.add(weapon);
      try {
        this.write([...this.seen]);
      } catch {
        /* Keep the in-memory history when storage is blocked. */
      }
    }
    if (lesson.elapsed >= HOLD + FADE) {
      this.lesson = null;
      this.show(null);
      return;
    }
    const primary = device === 'pad' ? 'RT' : device === 'touch' ? 'Fire' : 'Left click';
    const secondary = device === 'pad' ? 'LT' : 'Right click';
    const jump = device === 'pad' ? 'A' : device === 'touch' ? 'Jump' : 'Space';
    this.show({
      name: lesson.name,
      primary: `${primary}: ${lesson.tips.primary}`,
      secondary: device === 'touch' ? '' : `${secondary}: ${lesson.tips.secondary}`,
      extra: (lesson.tips.extra ?? '')
        .replaceAll('{primary}', primary)
        .replaceAll('{boost}', device === 'touch' ? `${jump}, then ${primary}` : `${jump} + ${primary}`),
      opacity: Math.min(1, (HOLD + FADE - lesson.elapsed) / FADE),
    });
  }
}
