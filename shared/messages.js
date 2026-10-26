// The same input budget applies to LAN connections and zirbel seats. Keep this browser-safe:
// the authority also runs in a player's page. Gameplay normally sends at most 60 states/second.
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_PLAYERS = 16;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EXPENSIVE = new Set(['hello', 'data', 'create', 'join']);

/** @param {unknown} data @returns {(Record<string, unknown> & { type: string }) | null} */
export function parseMessage(data) {
  let message = data;
  if (typeof data === 'string') {
    try {
      message = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const record = /** @type {Record<string, unknown>} */ (message);
  return typeof record['type'] === 'string'
    ? /** @type {Record<string, unknown> & { type: string }} */ (record)
    : null;
}

export class MessageBudget {
  constructor(now = Date.now) {
    this.now = now;
    this.at = now();
    this.tokens = 240;
  }

  take(cost = 1) {
    const now = this.now();
    this.tokens = Math.min(240, this.tokens + Math.max(0, now - this.at) * 0.12);
    this.at = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** @param {unknown} data */
  read(data) {
    if (!this.take()) return null;
    let text;
    if (typeof data === 'string') text = data;
    else if (ArrayBuffer.isView(data)) {
      if (data.byteLength > MAX_MESSAGE_BYTES) return null;
      text = decoder.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } else if (data instanceof ArrayBuffer) {
      if (data.byteLength > MAX_MESSAGE_BYTES) return null;
      text = decoder.decode(data);
    } else return null;
    if (text.length > MAX_MESSAGE_BYTES || encoder.encode(text).length > MAX_MESSAGE_BYTES) return null;
    const message = parseMessage(text);
    if (!message) return null;
    return !EXPENSIVE.has(message.type) || this.take(29) ? message : null;
  }
}
