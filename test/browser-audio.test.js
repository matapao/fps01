import assert from 'node:assert/strict';
import test from 'node:test';
test('original game sounds remain available after unlock without requesting recordings', async () => {
  const started = [],
    requests = [];
  let oscillators = 0;
  const node = () => ({
    connect() {
      return this;
    },
    disconnect() {},
    gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    playbackRate: { value: 1 },
  });
  class Context {
    currentTime = 0;
    state = 'running';
    destination = {};
    createGain() {
      return node();
    }
    createDynamicsCompressor() {
      const n = node();
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = { value: 0 };
      return n;
    }
    createBuffer() {
      return { getChannelData: () => new Float32Array(12000) };
    }
    createBufferSource() {
      const n = node();
      n.start = () => started.push(n);
      n.stop = () => {};
      return n;
    }
    createBiquadFilter() {
      return node();
    }
    createOscillator() {
      oscillators++;
      const n = node();
      n.start = () => {};
      n.stop = () => {};
      return n;
    }
    decodeAudioData() {
      return Promise.resolve({ sample: true });
    }
    sampleRate = 48000;
  }
  globalThis.window = { AudioContext: Context };
  globalThis.PannerNode = class {
    constructor() {
      return node();
    }
  };
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return { ok: !String(url).endsWith('launch.wav'), arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const audio = await import('../public/js/audio.js');
  audio.shot();
  assert.equal(started.length, 0, 'locked audio stays silent');
  audio.unlock();
  for (const fn of [audio.shot, audio.shotgun, audio.rail, audio.boom, audio.launch]) fn();
  audio.step([2, 0, 3], 0.6);
  assert(started.length >= 5, 'weapon, explosion and step noise is synthesized');
  assert(
    started.every((n) => !n.buffer.sample),
    'no recording reaches a voice',
  );
  assert(oscillators >= 4, 'thump and ring cues remain audible');
  audio.unlock();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests, [], 'unlock and gameplay never request removed recordings');
});
