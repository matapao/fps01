import { BUNDLED } from '../shared/data.js';

// Where a page or an authority reads a revision's data: through zirbel-net's net.data() when the
// host has it (zirbel-net's revisions: the same in a page and in the headless authority), from the
// game's own folder over HTTP where there's a fetch, and else the data bundled in. rev: the revision
// (net.data's default is the one the room plays).
/** @param {{data?: (path: string, revision?: string) => unknown | Promise<unknown>} | null | undefined} net @param {string | URL | null | undefined} base @param {string | undefined} rev */
export function reader(net, base, rev) {
  /** @param {keyof import('../shared/contracts.ts').GameData} id */
  return async (id) => {
    if (typeof net?.data === 'function') return net.data(`${id}.json`, rev);
    if (typeof fetch === 'function' && base && /^https?:/.test(String(base))) {
      const response = await fetch(new URL(`data/${id}.json`, base), { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${response.status} for data/${id}.json`);
      return response.json();
    }
    return BUNDLED[id];
  };
}
