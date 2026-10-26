// How this page reaches the game's server. Run with npm start (at a LAN party): a WebSocket to the
// server it came from. Served by a zirbel host (at /<game>/@<version>/): the host's hub, through
// zirbel-net (/zirbel-net.js), with the room in the address (?room=CODE). Either way main.js gets something
// that behaves like a WebSocket: readyState, send(), and open, message and close events.
//
// On zirbel the room's authority (zirbel/room.js) runs headless on the host, or, when a player is
// the room's host (a hub without dedicated rooms, or one whose headless authority failed), in that
// player's page: in this one, for as long as zirbel-net says this page is host. There, from an
// authority that says in its hello that it can, snapshots come as bytes with only what changed
// (shared/wire.js), read back into what the JSON one would be, and the page's state goes as bytes
// (state()); this page says it reads them ({ type: 'wire' }).

import { SNAPSHOT, STATE, SnapshotReader, writeState } from '/shared/wire.js';

const ZIRBEL = /^\/[a-z0-9][a-z0-9-]{1,31}\/@[^/]+\//.test(location.pathname);
// The zirbel-net message types the game's JSON travels in (see zirbel/room.js), one for each way, so
// a page that is host can tell its own messages to its authority from its authority's to it.
const UP = 1; // a page to the authority
const DOWN = 2; // the authority to a page
const SEED = 'langame:seed'; // sessionStorage: what a host page had seen, for the page after its reload

// On a zirbel host: the room this page plays in, and where to send others to it.
/** @type {{room: string, lobby: string, shareUrl: (code: string) => string, view: () => unknown} | null} */
export const zirbel = ZIRBEL
  ? {
      room: (new URLSearchParams(location.search).get('room') ?? '').toUpperCase(),
      // The host's lobby, for leaving the game.
      lobby: '/',
      shareUrl: (code) =>
        `${location.origin}${location.pathname.replace(/@[^/]*\/$/, '')}?room=${encodeURIComponent(code)}`,
      // What this page has seen of the game (main.js says): what an authority started here goes on from.
      view: () => null,
    }
  : null;

/** @param {string} [url] */
export function openSocket(url) {
  if (ZIRBEL) return new ZirbelSocket();
  if (!url) throw new TypeError('A LAN socket requires its URL');
  return new WebSocket(url);
}

class ZirbelSocket extends EventTarget {
  constructor() {
    super();
    /** @type {number} */
    this.readyState = WebSocket.CONNECTING;
    /** @type {import('/zirbel-net.js').Connection | null} */
    this.net = null;
    this.seated = false; // this page has had its first open, or the resume of a reload
    /** @type {ReturnType<typeof import('../../zirbel/room.js').default> | null} */
    this.authority = null; // the room's authority, while this page is host
    this.host = 0;
    /** @type {typeof import('../../zirbel/room.js').default | null} */
    this.startRoom = null;
    /** @type {(() => void) | null} */
    this.onPageHide = null;
    this.wire = false; // the room's authority takes states as bytes, and sends snapshots so
    Promise.all([import('/zirbel-net.js'), import('../../zirbel/room.js')]).then(
      ([net, room]) => this.attach(net, room.default),
      () => this.end(),
    );
  }

  /** @param {typeof import('/zirbel-net.js')} module @param {typeof import('../../zirbel/room.js').default} startRoom */
  attach({ connect, launchParams, HOST }, startRoom) {
    if (this.readyState === WebSocket.CLOSED) return;
    const net = connect({ ...launchParams(), loopback: true });
    this.net = net;
    this.host = HOST;
    this.startRoom = startRoom;
    // A page is seated on its first open, or on a resume when it is a reload of a page that had the
    // seat: zirbel-net keeps the seat across a reload, and says resume, not open.
    const seated = () => {
      if (this.readyState === WebSocket.CLOSED) return;
      this.sync();
      if (this.seated) return;
      this.seated = true;
      this.readyState = WebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
      // A page that has just started asks the authority what there is, and it answers with hello.
      this.send(JSON.stringify({ type: 'hello' }));
    };
    net.on('open', () => {
      // A second open is a new seat: the old one ran out while the link was down. The page
      // reconnects as it would to a restarted server, and comes back into its game.
      if (this.seated) return this.end();
      seated();
    });
    net.on('resume', seated);
    net.on('host', () => {
      this.wire = false; // until the new host says
      this.sync();
    });
    const snapshots = new SnapshotReader();
    net.on('message', (from, type, r) => {
      if (this.readyState === WebSocket.CLOSED || from !== net.hostId) return;
      if (type === DOWN) {
        const text = r.text();
        if (text.startsWith('{"type":"hello"') && wired(text)) {
          this.wire = true;
          this.send(JSON.stringify({ type: 'wire' }));
        }
        this.dispatchEvent(new MessageEvent('message', { data: text }));
      } else if (type === SNAPSHOT) {
        let snapshot;
        try {
          snapshot = snapshots.read(r.rest()); // null until a whole one has come
        } catch {
          this.end(); // A corrupt stream needs a fresh connection and keyframe.
          return;
        }
        if (snapshot) this.dispatchEvent(new MessageEvent('message', { data: snapshot }));
      }
    });
    net.on('close', () => this.end());
    this.onPageHide = () => this.keep();
    addEventListener('pagehide', this.onPageHide);
  }

  // Runs the room's authority in this page exactly while this page is host. It goes on from what
  // this page saw of the game (or, after a reload, what the page before it saw), and then greets
  // everyone, so they all come back into the game.
  sync() {
    if (this.readyState === WebSocket.CLOSED) return;
    const net = this.net;
    if (!net || !this.startRoom || !zirbel) return;
    if (net.isHost() && !this.authority) {
      this.authority = this.startRoom(
        net,
        { game: net.game, room: net.room },
        { seed: zirbel.view() ?? kept(net.room) },
      );
    } else if (!net.isHost() && this.authority) {
      this.authority.stop();
      this.authority = null;
    }
    forget();
  }

  // Leaving while host: what this page saw, for the page after a reload to go on from.
  keep() {
    if (!this.authority || !this.net || !zirbel) return;
    try {
      sessionStorage.setItem(
        SEED,
        JSON.stringify({ room: this.net.room, at: Date.now(), view: zirbel.view() }),
      );
    } catch {
      // Storage full or blocked: the next page starts the game afresh.
    }
  }

  /** @param {unknown} data */
  send(data) {
    if (this.readyState === WebSocket.OPEN && this.net) this.net.send(this.host, UP, String(data));
  }

  // Where this page's player is, which way they look and what's in their hands: as bytes to an
  // authority that takes them.
  /** @param {import('../../shared/runtime-types.ts').StateMessage} message */
  state(message) {
    if (this.readyState !== WebSocket.OPEN || !this.net) return;
    if (this.wire) this.net.send(this.host, STATE, writeState(message));
    else this.send(JSON.stringify(message));
  }

  close() {
    this.end();
  }

  end() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    if (this.onPageHide) removeEventListener('pagehide', this.onPageHide);
    this.authority?.stop();
    this.authority = null;
    this.net?.close();
    this.dispatchEvent(new Event('close'));
  }
}

// What the page before this reload saw, if it was this room's host a moment ago.
/** @param {string} room @returns {unknown} */
function kept(room) {
  try {
    const was = /** @type {unknown} */ (JSON.parse(sessionStorage.getItem(SEED) ?? 'null'));
    if (
      !was ||
      typeof was !== 'object' ||
      !('room' in was) ||
      was.room !== room ||
      !('at' in was) ||
      typeof was.at !== 'number'
    )
      return null;
    return Date.now() - was.at < 60_000 && 'view' in was ? was.view : null;
  } catch {
    return null;
  }
}

function forget() {
  try {
    sessionStorage.removeItem(SEED);
  } catch {
    // blocked
  }
}

// Whether an authority's hello says it takes states as bytes and sends snapshots so.
/** @param {string} text */
function wired(text) {
  try {
    const message = /** @type {unknown} */ (JSON.parse(text));
    return !!message && typeof message === 'object' && 'wire' in message && message.wire === 1;
  } catch {
    return false;
  }
}
