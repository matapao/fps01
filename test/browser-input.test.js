import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import './fixtures/data.js';

registerHooks({
  resolve: (specifier, context, next) =>
    specifier.startsWith('/shared/')
      ? next(new URL(`..${specifier}`, import.meta.url).href, context)
      : next(specifier, context),
});
const { createGamepad, BUTTON } = await import('../public/js/gamepad.js');
const { createTouch } = await import('../public/js/touch.js');

class Element extends EventTarget {
  style = {};
  classes = new Set();
  classList = { add: (v) => this.classes.add(v), remove: (v) => this.classes.delete(v) };
  children = new Map();
  captures = new Set();
  querySelector(selector) {
    return this.children.get(selector);
  }
  setPointerCapture(id) {
    this.captures.add(id);
  }
}
const priorHTMLElement = globalThis.HTMLElement;
globalThis.HTMLElement = Element;
after(() => {
  if (priorHTMLElement === undefined) delete globalThis.HTMLElement;
  else globalThis.HTMLElement = priorHTMLElement;
});

function pointer(element, type, pointerId, clientX = 0, clientY = 0) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId, clientX, clientY });
  element.dispatchEvent(event);
}
function touchscreen() {
  const root = new Element();
  const base = new Element();
  base.children.set('i', new Element());
  root.children.set('.stick', base);
  const held = { fire: false, jump: false, hook: false };
  const look = [];
  const on = { look: (x, y) => look.push([x, y]), next() {}, pause() {} };
  for (const name of ['fire', 'jump', 'hook', 'next', 'pause']) {
    root.children.set(`[data-touch="${name}"]`, new Element());
    if (name in held)
      on[name] = (down) => {
        held[name] = down;
      };
  }
  const controls = createTouch(root, on);
  return { root, held, look, controls, button: (name) => root.querySelector(`[data-touch="${name}"]`) };
}

test('touch captures the movement finger and cancels only the lost pointer', () => {
  globalThis.innerWidth = 844;
  const f = touchscreen();
  pointer(f.root, 'pointerdown', 11, 60, 220);
  pointer(f.root, 'pointermove', 11, 60, 160);
  pointer(f.button('jump'), 'pointerdown', 12, 650, 320);
  pointer(f.button('fire'), 'pointerdown', 13, 760, 270);
  assert.equal(f.controls.stick.forward, 1);
  assert.deepEqual(f.held, { fire: true, jump: true, hook: false });
  assert.ok(f.root.captures.has(11), 'movement stays attached when a finger leaves the surface');
  pointer(f.root, 'lostpointercapture', 11);
  assert.deepEqual(f.controls.stick, { forward: 0, strafe: 0 });
  assert.equal(f.held.fire, true, 'another finger remains held');
  pointer(f.button('fire'), 'pointercancel', 13);
  assert.equal(f.held.fire, false);
  assert.equal(f.held.jump, true);
  f.controls.show(false);
  assert.deepEqual(f.held, { fire: false, jump: false, hook: false });
  f.controls.show(true);
  pointer(f.button('fire'), 'pointerdown', 14);
  assert.equal(f.held.fire, true, 'play resumes with fresh fingers');
});

test('touch can aim while holding hook and stops tracking a cancelled look finger', () => {
  globalThis.innerWidth = 844;
  const f = touchscreen();
  pointer(f.root, 'pointerdown', 20, 430, 180);
  pointer(f.button('hook'), 'pointerdown', 21, 760, 170);
  pointer(f.root, 'pointermove', 20, 450, 160);
  assert.deepEqual(f.look, [[20, -20]]);
  pointer(f.root, 'pointercancel', 20);
  pointer(f.root, 'pointermove', 20, 600, 100);
  assert.equal(f.look.length, 1);
  assert.equal(f.held.hook, true);
  pointer(f.button('hook'), 'lostpointercapture', 21);
  assert.equal(f.held.hook, false);
});

function pad(...buttons) {
  return {
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, (_, i) => ({
      pressed: buttons.includes(i),
      value: buttons.includes(i) ? 1 : 0,
    })),
  };
}

test('gamepad preserves simultaneous jump/fire and hook edges, with neutral disconnect recovery', () => {
  let samples = [pad()];
  const gamepad = createGamepad(() => samples);
  gamepad.poll();
  samples = [pad(BUTTON.a, BUTTON.rt, BUTTON.x)];
  assert.deepEqual([...gamepad.poll().pressed], [BUTTON.a, BUTTON.x, BUTTON.rt]);
  assert.equal(gamepad.poll().pressed.size, 0, 'holding does not repeat a hook press');
  samples[0].axes = [0.5, -1, 0.03, -0.04];
  const moving = gamepad.poll();
  assert.ok(moving.move.forward > 0.8 && moving.move.strafe > 0);
  assert.deepEqual(moving.look, [0, 0], 'resting right-stick drift cannot spoil a downwards shot');
  samples = [];
  const disconnected = gamepad.poll();
  assert.equal(disconnected.connected, false);
  assert.deepEqual(disconnected.move, { forward: 0, strafe: 0 });
  assert.deepEqual([...disconnected.released], [BUTTON.a, BUTTON.x, BUTTON.rt]);
  samples = [pad(BUTTON.x)];
  assert.ok(gamepad.poll().pressed.has(BUTTON.x), 'reconnected hook responds to its first press');
});

test('a browser denying gamepad access releases inputs and polling can recover', () => {
  let denied = false;
  const gamepad = createGamepad(() => {
    if (denied) throw new DOMException('Not allowed', 'SecurityError');
    return [pad(BUTTON.rt)];
  });
  gamepad.poll();
  denied = true;
  assert.equal(gamepad.poll().connected, false);
  assert.ok(gamepad.state.released.has(BUTTON.rt));
  denied = false;
  assert.ok(gamepad.poll().pressed.has(BUTTON.rt));
});

test('inactive gamepad sampling consumes actions without moving or replaying presses on focus', () => {
  let sample = pad(BUTTON.x);
  const gamepad = createGamepad(() => [sample]);
  gamepad.poll();
  sample = pad(BUTTON.a, BUTTON.start, BUTTON.rt);
  sample.axes = [0.5, -1, 0.8, -0.7];
  const inactive = gamepad.poll(false);
  assert.equal(inactive.connected, true, 'the controller remains available while unfocused');
  assert.deepEqual([...inactive.down], [BUTTON.a, BUTTON.rt, BUTTON.start]);
  assert.deepEqual(inactive.move, { forward: 0, strafe: 0 });
  assert.deepEqual(inactive.look, [0, 0]);
  assert.equal(inactive.pressed.size, 0, 'background presses cannot start play or fire');
  assert.equal(inactive.released.size, 0, 'background releases cannot fire a charged shot');
  const focused = gamepad.poll();
  assert.equal(focused.pressed.size, 0, 'returning with A or Start held does not resume play');
  assert.equal(focused.released.size, 0);
  assert.ok(focused.move.forward > 0.8 && focused.look[0] > 0, 'active sticks work again');
  sample = pad();
  gamepad.poll();
  sample = pad(BUTTON.a, BUTTON.rt);
  assert.deepEqual([...gamepad.poll().pressed], [BUTTON.a, BUTTON.rt], 'a fresh press still works');
});

const { createMouse } = await import('../public/js/mouse.js');

function mouseMove(target, movementX, movementY) {
  const event = new Event('mousemove');
  Object.assign(event, { movementX, movementY });
  target.dispatchEvent(event);
}

test('mouse look reports numeric movement with the default vertical direction', () => {
  const target = new EventTarget();
  const canvas = {};
  const movements = [];
  target.pointerLockElement = canvas;
  const stop = createMouse(
    canvas,
    { look: (dx, dy) => movements.push([dx, dy]), press() {}, release() {} },
    target,
  );
  mouseMove(target, 12, -7);
  mouseMove(target, -5, 9);
  assert.deepEqual(movements, [
    [12, -7],
    [-5, 9],
  ]);
  stop();
});

test('mouse inversion changes only vertical look and follows live settings while captured', () => {
  const target = new EventTarget();
  const canvas = {};
  const movements = [];
  let inverted = false;
  let reads = 0;
  const stop = createMouse(
    canvas,
    {
      look: (dx, dy) => movements.push([dx, dy]),
      getInvertY: () => {
        reads++;
        return inverted;
      },
      press() {},
      release() {},
    },
    target,
  );
  mouseMove(target, 12, -7);
  assert.equal(reads, 0, 'uncaptured movement does not read or apply the setting');
  assert.deepEqual(movements, []);
  target.pointerLockElement = canvas;
  mouseMove(target, 12, -7);
  inverted = true;
  mouseMove(target, 12, -7);
  mouseMove(target, -5, 9);
  inverted = false;
  mouseMove(target, -5, 9);
  assert.deepEqual(movements, [
    [12, -7],
    [12, 7],
    [-5, -9],
    [-5, 9],
  ]);
  assert.equal(reads, 4, 'every captured movement uses the current setting');
  target.pointerLockElement = null;
  mouseMove(target, 20, 20);
  assert.equal(movements.length, 4);
  stop();
  target.pointerLockElement = canvas;
  mouseMove(target, 20, 20);
  assert.equal(movements.length, 4, 'disposed input cannot resume looking');
});

test('uncaptured mouse events cannot turn, fire or release a touch/gamepad action', () => {
  const target = new EventTarget();
  const canvas = {};
  const actions = [];
  const stop = createMouse(
    canvas,
    {
      look: () => actions.push('aim'),
      press: () => actions.push('fire'),
      release: () => actions.push('release'),
    },
    target,
  );
  for (const type of ['mousemove', 'mousedown', 'mouseup']) target.dispatchEvent(new Event(type));
  assert.deepEqual(actions, []);
  target.pointerLockElement = canvas;
  for (const type of ['mousemove', 'mousedown', 'mouseup']) target.dispatchEvent(new Event(type));
  assert.deepEqual(actions, ['aim', 'fire', 'release']);
  stop();
  target.dispatchEvent(new Event('mousedown'));
  assert.equal(actions.length, 3, 'disposed listeners stay stopped');
});
