// The public zirbel-net capabilities used by this game, matching @zirbel/net's published API.
export interface Reader {
  text(): string;
  left(): number;
  rest(): Uint8Array;
}
export interface Revision {
  readonly id: string;
  readonly base: string;
  readonly engine: boolean;
}
export interface RoomInfo {
  readonly game: string;
  readonly room: string;
}
export interface OpenInfo {
  readonly id: number;
  readonly hostId: number;
  readonly peers: ReadonlyMap<number, string>;
}
export interface GameEvents {
  open: (info: OpenInfo) => void;
  message: (from: number, type: number, reader: Reader, reliable: boolean) => void;
  peer: (id: number, label: string) => void;
  label: (id: number, label: string) => void;
  leave: (id: number) => void;
  away: (id: number) => void;
  back: (id: number) => void;
  host: (id: number) => void;
  close: (code: number, message: string) => void;
  revision: (revision: Revision) => void;
}
export interface ClientEvents extends GameEvents {
  disconnect: () => void;
  resume: () => void;
  lane: (lane: 'ws' | 'none') => void;
}
export interface GameNet {
  readonly id: number;
  readonly name: string;
  readonly hostId: number;
  readonly peers: ReadonlyMap<number, string>;
  readonly local: boolean;
  readonly connected: boolean;
  readonly revision: Revision | null;
  isHost(): boolean;
  now(): number;
  send(to: number, type: number, data?: string | Uint8Array): void;
  stream(to: number, type: number, data?: string | Uint8Array): void;
  data(file: string, revision?: string): Promise<unknown>;
  metric(name: string, value?: number, labels?: Readonly<Record<string, string>>): void;
  on<K extends keyof GameEvents>(name: K, fn: GameEvents[K]): this;
  off<K extends keyof GameEvents>(name: K, fn: GameEvents[K]): this;
}
export interface Connection extends GameNet {
  readonly stats: Readonly<{
    framesIn: number;
    framesOut: number;
    bytesIn: number;
    bytesOut: number;
    dropped: number;
  }>;
  readonly url: string;
  readonly game: string;
  readonly room: string;
  readonly closed: boolean;
  close(): void;
  on<K extends keyof ClientEvents>(name: K, fn: ClientEvents[K]): this;
  off<K extends keyof ClientEvents>(name: K, fn: ClientEvents[K]): this;
}
export interface ConnectOptions {
  url?: string;
  game?: string;
  room?: string;
  key?: string;
  storage?: null;
  loopback?: boolean;
  metrics?: boolean;
}
export function connect(options?: ConnectOptions): Connection;
export function launchParams(): ConnectOptions;
export function playerName(id: number): string;
export const HOST: number;
export const SERVER: number;
