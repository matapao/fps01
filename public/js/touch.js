// Touch controls, for phones and tablets: the left thumb moves, the right thumb looks, and the
// buttons do the rest. Only where the main pointer is a finger; with a mouse it plays as ever.

import { child } from './dom.js';
import { DATA } from '/shared/data.js';

export const touchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// The stick (data/hud.json): how far its knob goes (px), how much of that a resting thumb can move
// without walking, and how much of the width, from the left, a touch takes it in.
const stickOf = () => DATA.hud.touch;

// root: #touch in index.html. on: look(dx, dy), fire(down), jump(down), hook(down), next(), pause().
// The stick is read every frame: stick.forward and stick.strafe, a direction (both 0 at rest).
/**
 * @param {HTMLElement} root
 * @param {{look: (dx: number, dy: number) => void, fire: (down: boolean) => void,
 *   jump: (down: boolean) => void, hook: (down: boolean) => void, next: () => void, pause: () => void}} on
 */
export function createTouch(root, on) {
  const stick = { forward: 0, strafe: 0 };
  const base = child(root, '.stick', HTMLElement);
  const knob = child(base, 'i', HTMLElement);
  /** @type {number | null} */
  let stickId = null;
  /** @type {[number, number]} */
  let origin = [0, 0];
  /** @type {Map<number, [number, number]>} */
  const looks = new Map(); // pointer id → where it was last: those fingers turn the view

  /** @param {number} dx @param {number} dy */
  function moveStick(dx, dy) {
    const length = Math.hypot(dx, dy);
    const { reach, dead } = stickOf();
    const k = length > reach ? reach / length : 1;
    knob.style.translate = `${dx * k}px ${dy * k}px`;
    if (length < reach * dead) {
      stick.forward = 0;
      stick.strafe = 0;
    } else {
      stick.forward = -dy / length;
      stick.strafe = dx / length;
    }
  }

  function dropStick() {
    stickId = null;
    stick.forward = 0;
    stick.strafe = 0;
    knob.style.translate = '';
    base.classList.remove('on');
    base.style.left = '';
    base.style.top = '';
  }

  // Anywhere but a button: on the left the stick comes to your thumb, elsewhere you look.
  root.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    root.setPointerCapture(event.pointerId);
    if (stickId === null && event.clientX < innerWidth * stickOf().side) {
      stickId = event.pointerId;
      origin = [event.clientX, event.clientY];
      base.classList.add('on');
      base.style.left = `${event.clientX}px`;
      base.style.top = `${event.clientY}px`;
      moveStick(0, 0);
    } else {
      looks.set(event.pointerId, [event.clientX, event.clientY]);
    }
  });
  root.addEventListener('pointermove', (event) => {
    if (event.pointerId === stickId) {
      moveStick(event.clientX - origin[0], event.clientY - origin[1]);
      return;
    }
    const last = looks.get(event.pointerId);
    if (!last) return;
    on.look(event.clientX - last[0], event.clientY - last[1]);
    looks.set(event.pointerId, [event.clientX, event.clientY]);
  });
  /** @param {PointerEvent} event */
  const lift = (event) => {
    if (event.pointerId === stickId) dropStick();
    looks.delete(event.pointerId);
  };
  root.addEventListener('pointerup', lift);
  root.addEventListener('pointercancel', lift);
  root.addEventListener('lostpointercapture', lift);
  // No scrolling, zooming or the mouse events a browser makes up after a tap.
  root.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });

  // Held buttons: down while a finger is on them, and a finger on them turns the view as it slides,
  // so you aim while you shoot.
  /** @type {(() => void)[]} */
  const held = [];
  /** @param {string} name @param {(down: boolean) => void} act */
  function hold(name, act) {
    const button = root.querySelector(`[data-touch="${name}"]`);
    if (!(button instanceof HTMLElement)) throw new Error(`Touch button ${name} is missing`);
    /** @type {number | null} */
    let id = null;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (id !== null) return;
      id = event.pointerId;
      button.setPointerCapture(event.pointerId);
      button.classList.add('on');
      looks.set(event.pointerId, [event.clientX, event.clientY]);
      act(true);
    });
    /** @param {PointerEvent} event */
    const release = (event) => {
      if (event.pointerId !== id) return;
      id = null;
      button.classList.remove('on');
      looks.delete(event.pointerId);
      act(false);
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    held.push(() => {
      if (id === null) return;
      id = null;
      button.classList.remove('on');
      act(false);
    });
  }
  /** @param {string} name @param {() => void} act */
  function tap(name, act) {
    const button = root.querySelector(`[data-touch="${name}"]`);
    if (!(button instanceof HTMLElement)) throw new Error(`Touch button ${name} is missing`);
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      act();
    });
  }
  hold('fire', on.fire);
  hold('jump', on.jump);
  hold('hook', on.hook);
  tap('next', on.next);
  tap('pause', on.pause);

  return {
    stick,
    /** @param {boolean} visible */
    show(visible) {
      root.hidden = !visible;
      if (visible) return;
      dropStick();
      looks.clear();
      for (const letGo of held) letGo();
    },
  };
}
