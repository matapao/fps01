// Gamepads, in the standard layout browsers map every pad to: two sticks, two triggers, two bumpers,
// four face buttons (A, B, X, Y), Back, Start, the sticks' clicks and the d-pad. A pad is only read
// when the page asks, so poll() reads it every frame: where its sticks are, past a dead zone, and
// which buttons went down or came up since the last frame. How fast the right stick turns the view
// and how far a resting stick may drift are the data's (data/hud.json: pad); what each button does
// is main.js's.

import { DATA } from '/shared/data.js';

// The standard layout's buttons, by name.
export const BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  ls: 10,
  rs: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
};
const PULLED = 0.4; // how far a trigger must go down to count

// The pad's numbers: radians a second the view turns at full tilt, the dead zone, and how the stick's
// tilt curves into turning speed (above 1: fine aim near the middle). The data's, where it says.
export const padOf = () => ({ look: 3.2, dead: 0.15, curve: 1.6, ...DATA.hud.pad });

/** @param {() => (Gamepad | null)[]} [readPads] Browser sampling, injectable for input regressions. */
export function createGamepad(readPads = () => [...(navigator.getGamepads?.() ?? [])]) {
  /** @type {{connected: boolean, move: {forward: number, strafe: number}, look: [number,number], down: Set<number>, pressed: Set<number>, released: Set<number>}} */
  const state = {
    connected: false,
    move: { forward: 0, strafe: 0 }, // the left stick: -1 … 1
    look: [0, 0], // the right stick, curved: -1 … 1
    down: new Set(), // the buttons held
    pressed: new Set(), // …that went down since the last poll
    released: new Set(), // …and those that came up
  };
  // Past the dead zone, from nothing to the full tilt; curved by power.
  /** @param {number} x @param {number} y @param {number} dead @param {number} [power] @returns {[number,number]} */
  const tilt = (x, y, dead, power = 1) => {
    const length = Math.hypot(x, y);
    if (length <= dead) return [0, 0];
    const k = Math.min(1, (length - dead) / (1 - dead)) ** power / length;
    return [x * k, y * k];
  };
  return {
    state,
    /** @param {boolean} [active] Inactive pages sample held buttons without exposing actions. */
    poll(active = true) {
      state.pressed.clear();
      state.released.clear();
      /** @type {(Gamepad | null)[]} */
      let pads;
      try {
        pads = readPads();
      } catch (error) {
        // Embedded browsers can deny this API. Treat denial as a disconnect and release held input.
        if (!error || typeof error !== 'object' || !('name' in error) || error.name !== 'SecurityError')
          throw error;
        pads = [];
      }
      const pad = pads.find((p) => p?.connected) ?? null;
      state.connected = Boolean(pad);
      const down = new Set(/** @type {number[]} */ ([]));
      if (pad && active) {
        const { dead, curve } = padOf();
        const [strafe, back] = tilt(pad.axes[0] ?? 0, pad.axes[1] ?? 0, dead);
        state.move.forward = -back;
        state.move.strafe = strafe;
        state.look = tilt(pad.axes[2] ?? 0, pad.axes[3] ?? 0, dead, curve);
      } else {
        state.move.forward = state.move.strafe = 0;
        state.look = [0, 0];
      }
      pad?.buttons.forEach((button, i) => {
        if (button.pressed || button.value > PULLED) down.add(i);
      });
      // Consume background edges so returning focus with A/Start held cannot resume play.
      if (active) {
        for (const i of down) if (!state.down.has(i)) state.pressed.add(i);
        for (const i of state.down) if (!down.has(i)) state.released.add(i);
      }
      state.down = down;
      return state;
    },
  };
}
