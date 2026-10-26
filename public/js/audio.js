// Original synthesized game effects (MIT); no recordings are fetched or bundled.
/** @type {AudioContext | null} */
let context = null;
/** @type {AudioBuffer | null} */
let noise = null;
/** @type {DynamicsCompressorNode | null} */
let master = null;
// Browsers only allow sound after a click, so the Play button calls this.
export function unlock() {
  if (!context) {
    const AudioContextClass =
      window.AudioContext ??
      ('webkitAudioContext' in window
        ? /** @type {typeof AudioContext | undefined} */ (window.webkitAudioContext)
        : undefined);
    if (!AudioContextClass) return;
    context = new AudioContextClass();
    master = context.createDynamicsCompressor();
    master.threshold.value = -8;
    master.knee.value = 8;
    master.ratio.value = 6;
    master.attack.value = 0.003;
    master.release.value = 0.1;
    master.connect(context.destination);
    noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.25), context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  if (context.state === 'suspended') context.resume();
}

// Where you hear from: the camera, facing the way it looks. Call it every frame.
/** @param {import('./contracts.d.ts').Vec3} position @param {import('./contracts.d.ts').Vec3} forward */
export function listen(position, forward) {
  if (!context) return;
  const listener = context.listener;
  if (listener.positionX) {
    listener.positionX.value = position[0];
    listener.positionY.value = position[1];
    listener.positionZ.value = position[2];
    listener.forwardX.value = forward[0];
    listener.forwardY.value = forward[1];
    listener.forwardZ.value = forward[2];
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
  } else {
    listener.setPosition(...position);
    listener.setOrientation(...forward, 0, 1, 0);
  }
}

// Where a sound goes: out of a point in the world, or straight to your ears.
/** @param {import('./contracts.d.ts').Vec3 | null} at @param {number} [volume] */
function out(at, volume = 1) {
  if (!context || !master) throw new Error('Audio output requires unlock');
  const gain = context.createGain();
  gain.gain.value = volume;
  if (!at) {
    gain.connect(master);
    return gain;
  }
  const panner = new PannerNode(context, {
    panningModel: 'HRTF',
    distanceModel: 'inverse',
    refDistance: 4,
    maxDistance: 120,
    rolloffFactor: 1.1,
    positionX: at[0],
    positionY: at[1],
    positionZ: at[2],
  });
  gain.connect(panner).connect(master);
  return gain;
}

/** @param {number} start @param {number} peak @param {number} duration */
function envelope(start, peak, duration) {
  if (!context) throw new Error('Audio envelope requires unlock');
  const gain = context.createGain();
  gain.gain.setValueAtTime(peak, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  return gain;
}

// A burst of filtered noise: the basis of shots, blasts and footsteps.
/** @param {import('./contracts.d.ts').Vec3 | null} at
 * @param {{type?: BiquadFilterType, from: number, to?: number, peak: number, duration: number, loop?: boolean}} options */
function burst(at, { type = 'lowpass', from, to = from, peak, duration, loop = false }) {
  if (!context) throw new Error('Audio burst requires unlock');
  const now = context.currentTime;
  const source = context.createBufferSource();
  source.buffer = noise;
  source.loop = loop;
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(from, now);
  if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, now + duration);
  source
    .connect(filter)
    .connect(envelope(now, peak, duration))
    .connect(out(at));
  source.start(now);
  source.stop(now + duration + 0.05);
}

// A sweeping note: the basis of thumps, zips and hums.
/** @param {import('./contracts.d.ts').Vec3 | null} at
 * @param {{type?: OscillatorType, from: number, to?: number, peak: number, duration: number}} options */
function sweep(at, { type = 'sine', from, to = from, peak, duration }) {
  if (!context) throw new Error('Audio sweep requires unlock');
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, now);
  if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, now + duration * 0.8);
  oscillator.connect(envelope(now, peak, duration)).connect(out(at));
  oscillator.start(now);
  oscillator.stop(now + duration + 0.05);
}

/** @param {number} frequency @param {number} duration @param {number} volume @param {OscillatorType} [type] @param {import('./contracts.d.ts').Vec3 | null} [at] */
function tone(frequency, duration, volume, type = 'square', at = null) {
  if (!context) return;
  sweep(at, { type, from: frequency, peak: volume, duration });
}

// A rifle shot; at is where it came from, or nothing for yours.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function shot(at = null) {
  if (!context) return;
  burst(at, { from: 4000, to: 400, peak: 0.35, duration: 0.16 });
}

// The grenade launcher's hollow thump.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function launch(at = null) {
  if (!context) return;
  sweep(at, { from: 190, to: 55, peak: 0.5, duration: 0.22 });
}

// Something going off: a rumble of noise over a deep thump.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function boom(at = null) {
  if (!context) return;
  burst(at, { from: 1800, to: 120, peak: 0.8, duration: 0.8, loop: true });
  sweep(at, { from: 90, to: 35, peak: 0.7, duration: 0.45 });
}

// Clicking with nothing to fire.
export function empty() {
  tone(1300, 0.03, 0.06);
}

/** @param {boolean} head */
export function hit(head) {
  tone(head ? 1500 : 1000, 0.07, 0.12);
}

export function hurt() {
  tone(160, 0.18, 0.3, 'sawtooth');
}

// The grappling hook firing: a quick rising zip, with a clank if it catches.
/** @param {boolean} caught */
export function hook(caught) {
  if (!context) return;
  sweep(null, { type: 'triangle', from: 320, to: 1400, peak: 0.12, duration: 0.1 });
  if (caught) setTimeout(() => tone(900, 0.05, 0.12), 70);
}

// A flourish with your juggling balls: a quick whoosh.
export function flourish() {
  if (!context) return;
  burst(null, { type: 'bandpass', from: 700, to: 2600, peak: 0.12, duration: 0.25 });
}

// A grenade bouncing off something: a hard little clink.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function clink(at = null) {
  if (!context) return;
  tone(2400 + Math.random() * 600, 0.03, 0.08, 'triangle', at);
  burst(at, { type: 'highpass', from: 3000, peak: 0.08, duration: 0.05 });
}

// A click: picking the next kind of grenade.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function click(at = null) {
  tone(2600, 0.015, 0.08, 'square', at);
}

// A footstep: yours (quiet), or someone else's from where they are.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function step(at = null, volume = 1) {
  if (!context) return;
  burst(at, { from: at ? 700 : 500, to: 150, peak: (at ? 0.5 : 0.12) * volume, duration: 0.07 });
}

// A jump pad throwing someone up: a rising whoomp.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function pad(at = null) {
  if (!context) return;
  sweep(at, { from: 140, to: 620, peak: 0.35, duration: 0.35 });
  burst(at, { type: 'bandpass', from: 600, to: 2400, peak: 0.15, duration: 0.3 });
}

// A dodge: a short whoosh.
export function dodge() {
  if (!context) return;
  burst(null, { type: 'bandpass', from: 1800, to: 500, peak: 0.18, duration: 0.18 });
}

// The shotgun: a heavy blast with a deep thump under it.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function shotgun(at = null) {
  if (!context) return;
  burst(at, { from: 2600, to: 180, peak: 0.6, duration: 0.32 });
  sweep(at, { from: 120, to: 45, peak: 0.45, duration: 0.2 });
}

// A rocket leaving the tube: a rushing whoosh.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function rocket(at = null) {
  if (!context) return;
  burst(at, { type: 'bandpass', from: 500, to: 1600, peak: 0.45, duration: 0.45, loop: true });
  sweep(at, { from: 160, to: 70, peak: 0.35, duration: 0.3 });
}

// One tick of the spark gun: a short electric crackle. Quiet, since it fires 20 times a second.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function zap(at = null) {
  if (!context) return;
  sweep(at, { type: 'sawtooth', from: 95 + Math.random() * 20, peak: at ? 0.1 : 0.06, duration: 0.06 });
  burst(at, { type: 'highpass', from: 3000, peak: at ? 0.08 : 0.05, duration: 0.04 });
}

// The overload: a loud crack of electricity.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function overload(at = null) {
  if (!context) return;
  burst(at, { type: 'highpass', from: 1500, peak: 0.6, duration: 0.3 });
  sweep(at, { type: 'sawtooth', from: 220, to: 60, peak: 0.3, duration: 0.3 });
}

// The railgun: a sharp crack and a falling ring.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function rail(at = null) {
  if (!context) return;
  burst(at, { type: 'highpass', from: 1200, peak: 0.5, duration: 0.15 });
  sweep(at, { type: 'sawtooth', from: 2200, to: 260, peak: 0.22, duration: 0.6 });
}

// A railgun charging: a hum that rises over ms.
/** @param {number} ms */
export function charge(ms) {
  if (!context) return;
  sweep(null, { type: 'triangle', from: 180, to: 900, peak: 0.08, duration: ms / 1000 });
}

// A kick: a whoosh, and a thud if it landed.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function kick(at = null, landed = false) {
  if (!context) return;
  burst(at, { type: 'bandpass', from: 1200, to: 400, peak: 0.2, duration: 0.15 });
  if (landed) sweep(at, { from: 140, to: 50, peak: 0.6, duration: 0.15 });
}

// Picking something up: a weapon clacks, health chimes, armor clinks, a Health Orb rings out.
/** @param {string} kind */
export function item(kind) {
  if (kind === 'weapon') {
    tone(330, 0.05, 0.12);
    setTimeout(() => tone(220, 0.08, 0.12), 60);
  } else if (kind === 'armor') {
    tone(1700, 0.05, 0.08, 'triangle');
    setTimeout(() => tone(2300, 0.1, 0.08, 'triangle'), 50);
  } else if (kind === 'orb') {
    for (const [i, note] of [523, 659, 784, 1047].entries())
      setTimeout(() => tone(note, 0.25, 0.08, 'triangle'), i * 70);
  } else {
    tone(660, 0.06, 0.1, 'triangle');
    setTimeout(() => tone(990, 0.12, 0.1, 'triangle'), 70);
  }
}

// A medal: a short fanfare.
export function medal() {
  for (const [i, note] of [784, 988, 1175].entries())
    setTimeout(() => tone(note, 0.12, 0.07, 'triangle'), i * 90);
}

// An air strike called in: a falling whistle.
export function strike() {
  if (!context) return;
  sweep(null, { type: 'sine', from: 1800, to: 500, peak: 0.12, duration: 1.1 });
}

// A powerup: soon (a rising chime), or taken (a fanfare).
export function powerup(taken = true) {
  if (taken)
    for (const [i, note] of [392, 523, 659, 784, 1047].entries())
      setTimeout(() => tone(note, 0.3, 0.08, 'sawtooth'), i * 55);
  else
    for (const [i, note] of [660, 880].entries())
      setTimeout(() => tone(note, 0.2, 0.06, 'triangle'), i * 140);
}

// A crate on its way down: a falling whistle.
export function crate() {
  if (!context) return;
  sweep(null, { type: 'sine', from: 1400, to: 700, peak: 0.06, duration: 1.2 });
}

// A woolly: baa.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function baa(at = null) {
  if (!context) return;
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(420, now);
  oscillator.frequency.linearRampToValueAtTime(380, now + 0.45);
  const wobble = context.createOscillator();
  wobble.frequency.value = 22;
  const depth = context.createGain();
  depth.gain.value = 25;
  wobble.connect(depth).connect(oscillator.frequency);
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 900;
  filter.Q.value = 2;
  oscillator
    .connect(filter)
    .connect(envelope(now, 0.35, 0.5))
    .connect(out(at));
  for (const node of [oscillator, wobble]) {
    node.start(now);
    node.stop(now + 0.55);
  }
}

// The choir grenade: a choir's chord, a moment before it goes off.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function choir(at = null) {
  if (!context) return;
  for (const note of [262, 330, 392, 523])
    sweep(at, { type: 'triangle', from: note, peak: 0.07, duration: 1.1 });
}

// A teleport: a sweep up where you left, and down where you arrive.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function teleport(at = null, arriving = false) {
  if (!context) return;
  sweep(at, {
    type: 'triangle',
    from: arriving ? 1800 : 300,
    to: arriving ? 300 : 1800,
    peak: 0.15,
    duration: 0.35,
  });
}

// A bit of floor giving way: a short crunch.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function chew(at = null) {
  if (!context) return;
  burst(at, { type: 'bandpass', from: 1400, to: 600, peak: 0.25, duration: 0.12 });
}

// Something coming loose: a crack, then a groan as it goes.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function creak(at = null) {
  if (!context) return;
  burst(at, { type: 'bandpass', from: 2400, to: 900, peak: 0.45, duration: 0.18 });
  sweep(at, { type: 'sawtooth', from: 70, to: 45, peak: 0.12, duration: 0.6 });
}

// A piece of the arena landing: a heavy thud and crumbling, louder the bigger it is (in cells).
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function crash(at = null, size = 10) {
  if (!context) return;
  const weight = Math.min(1, 0.3 + size / 150);
  sweep(at, { from: 120, to: 30, peak: 0.9 * weight, duration: 0.5 });
  burst(at, { from: 2200, to: 150, peak: 0.7 * weight, duration: 0.6 + weight, loop: true });
}

// Water pouring out of the pool, for a second or so (played again for as long as it lasts).
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function pour(at = null) {
  if (!context) return;
  burst(at, { type: 'lowpass', from: 900, to: 600, peak: 0.35, duration: 1.2, loop: true });
}

// Something falling into water.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function splash(at = null) {
  if (!context) return;
  burst(at, { type: 'bandpass', from: 1800, to: 500, peak: 0.4, duration: 0.35 });
}

// A planet blowing up, far off: a huge, slow bang, rumbling on.
export function planet() {
  if (!context) return;
  sweep(null, { from: 80, to: 18, peak: 1, duration: 2.8 });
  burst(null, { from: 1400, to: 50, peak: 0.9, duration: 3.5, loop: true });
  burst(null, { type: 'bandpass', from: 300, to: 80, peak: 0.5, duration: 5, loop: true });
}

// A juggling ball thrown: a whoosh.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function toss(at = null) {
  if (!context) return;
  burst(at, { type: 'bandpass', from: 900, to: 500, peak: 0.25, duration: 0.22 });
}

// A thrown juggling ball coming down: a bonk, louder on someone.
/** @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function thrown(at = null, onSomeone = false) {
  if (!context) return;
  sweep(at, { from: 420, to: 170, peak: onSomeone ? 0.55 : 0.25, duration: 0.13 });
}

// The ground shaking: a long low rumble.
/** @param {number} ms */
export function rumble(ms) {
  if (!context) return;
  burst(null, { from: 160, to: 60, peak: 0.6, duration: ms / 1000, loop: true });
}

// The sounds by their ids in the asset catalogue (assets/assets.json), for what the data names:
// a weapon's shot, a pickup taken.
/** @type {Record<string, (at?: import('./contracts.d.ts').Vec3 | null) => void>} */
const SOUNDS = {
  'sounds/shot': shot,
  'sounds/shotgun': shotgun,
  'sounds/launch': launch,
  'sounds/rocket': rocket,
  'sounds/zap': zap,
  'sounds/overload': overload,
  'sounds/rail': rail,
  'sounds/boom': boom,
  'sounds/empty': empty,
  'sounds/click': click,
  'sounds/clink': clink,
  'sounds/step': step,
  'sounds/pad': pad,
  'sounds/dodge': dodge,
  'sounds/kick': kick,
  'sounds/pickup-weapon': () => item('weapon'),
  'sounds/pickup-armor': () => item('armor'),
  'sounds/pickup-orb': () => item('orb'),
  'sounds/pickup-health': () => item('health'),
  'sounds/medal': medal,
  'sounds/strike': strike,
  'sounds/powerup': () => powerup(true),
  'sounds/crate': crate,
  'sounds/baa': baa,
  'sounds/teleport': teleport,
  'sounds/chew': chew,
  'sounds/creak': creak,
  'sounds/crash': crash,
  'sounds/pour': pour,
  'sounds/splash': splash,
  'sounds/planet': planet,
  'sounds/toss': toss,
  'sounds/thrown': thrown,
  'sounds/charge': () => charge(1000),
  'sounds/hit': () => hit(false),
  'sounds/hurt': hurt,
  'sounds/hook': () => hook(true),
  'sounds/flourish': flourish,
  'sounds/choir': choir,
  'sounds/rumble': () => rumble(1000),
};

// Plays a sound by its id: at a point in the world, or in your ears.
/** @param {string | undefined} id @param {import('./contracts.d.ts').Vec3 | null} [at] */
export function play(id, at = null) {
  if (context && id !== undefined) SOUNDS[id]?.(at);
}
