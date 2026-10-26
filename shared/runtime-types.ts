import type { GameData, Vector3 } from './contracts.ts';

export type Mode = 'dm' | 'ctf';
export type Team = 'red' | 'blue';
export interface MovementState {
  feet: Vector3;
  velocity: Vector3;
  onGround: boolean;
  dodgeAt: number;
  airDodged: boolean;
  padAt: number;
}
export interface MovementInput {
  forward: number;
  strafe: number;
  yaw: number;
  jump: boolean;
  dodge: boolean;
}
export interface Grapple {
  anchor: Vector3;
  ledge: Vector3 | null;
  goal: Vector3;
  mantle: boolean;
}
export interface Mantle {
  y: number;
  to: [number, number];
  until: number;
}
export interface Flag {
  state: 'home' | 'carried' | 'dropped';
  at: Vector3;
  carrier: number | null;
  returnAt: number;
}
export interface PlayerSnapshot {
  id: number;
  seat?: number | undefined;
  name: string;
  color: string;
  feet: Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  armor: number;
  alive: boolean;
  kills: number;
  deaths: number;
  hook: Vector3 | null;
  held: string | null;
  team: Team | null;
  carrying: Team | null;
  shielded: boolean;
  cloaked: boolean;
  powerup: string | null;
}
export interface RoundSnapshot {
  mode: Mode;
  map: string;
  over: boolean;
  captures: Record<Team, number>;
  ms: number;
  sudden: boolean;
  flags?: Partial<Record<Team, { state: Flag['state']; at: Vector3 | null }>>;
}
export type ProjectileSnapshot = [number, string | null, number, number, number];
export interface Snapshot {
  type: 'snapshot';
  players: PlayerSnapshot[];
  projectiles: ProjectileSnapshot[];
  items?: number[];
  round?: RoundSnapshot;
  water?: number;
  powerups?: {
    pedestal: string | null;
    soon: { kind: string | null; ms: number } | null;
    loose: ProjectileSnapshot[];
  };
  crates?: [number, 'health' | 'special', number, number, number, number][];
  woollies?: [number, number, number, number, number, number][];
}
export interface SelfMessage {
  type: 'self';
  weapons: string[];
  ammo: Record<string, number | null>;
  special: string | null;
  powerup: { kind: string; ms: number } | null;
}
export interface StateMessage {
  type?: 'state';
  feet: Vector3;
  yaw: number;
  pitch: number;
  held: string | null;
}
export interface DataRevision {
  data: GameData;
  hash: string;
  revision: string;
}
export interface GameSocket {
  readyState: number;
  OPEN: number;
  bufferedAmount: number;
  dataHash?: string | undefined;
  seat?: number | undefined;
  send(text: string): void;
  terminate(): void;
  snapshot?(snapshot: Snapshot, text: () => string): void;
  self?(message: SelfMessage): void;
}
export interface Player {
  id: number;
  socket: GameSocket;
  token: string | null;
  name: string;
  color: string;
  feet: Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  armor: number;
  alive: boolean;
  kills: number;
  deaths: number;
  weapons: Set<string>;
  ammo: Record<string, number>;
  lastFire: Record<string, number>;
  team: Team | null;
  carrying: Team | null;
  spree: number;
  multi: number;
  lastKillAt: number;
  lastKick: number;
  powerup: { kind: string; until: number } | null;
  special: string | null;
  guiding: number | null;
  hook: Vector3 | null;
  held: string;
  lastHitBy: number | null;
  lastHitAt: number;
  damagedBy: Map<number, number>;
  decayAt: number;
  protectedUntil: number;
  railHits?: number;
  mendAt?: number;
}
export interface ScoreRecord {
  token: string | null;
  name: string;
  color: string;
  kills: number;
  deaths: number;
  leftAt?: number;
}
export interface IncomingMessage {
  type?: unknown;
  feet?: unknown;
  yaw?: unknown;
  pitch?: unknown;
  held?: unknown;
  weapon?: unknown;
  alt?: unknown;
  dir?: unknown;
  velocity?: unknown;
  hits?: unknown;
  at?: unknown;
  normal?: unknown;
  id?: unknown;
  release?: unknown;
  target?: unknown;
  hit?: unknown;
}

export interface RestoreInput {
  mode?: unknown;
  map?: unknown;
  players?: unknown;
  history?: unknown;
  water?: unknown;
  planets?: unknown;
}
export type Winner = { team: Team } | { id: number; name: string } | null;
export interface GameOptions {
  respawnMs?: number | undefined;
  protectionMs?: number | undefined;
  now?: (() => number) | undefined;
  restore?: RestoreInput | null | undefined;
  data?: DataRevision | null | undefined;
  reportMetric?:
    ((name: string, value: number, labels: Readonly<Record<string, string>>) => void) | undefined;
}

export interface GameListing {
  code: string;
  name: string;
  map: string;
  mode: Mode;
  players: string[];
}
