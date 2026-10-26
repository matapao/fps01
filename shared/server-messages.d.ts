import type { Vector3, GameData } from './contracts.ts';
import type { Mode, Team, Snapshot, SelfMessage, PlayerSnapshot } from './runtime-types.ts';
import type { HistoryEntry } from './voxels.js';
import type { GameListing } from './runtime-types.ts';
export interface ServerMessages {
  hello: {
    type: 'hello';
    addresses: string[];
    version?: string | null;
    update?: boolean;
    games?: GameListing[];
    data?: string;
    back?: boolean;
    wire?: number;
  };
  world: {
    type: 'world';
    mode?: Mode;
    map?: string;
    history: HistoryEntry[];
    water?: number | null;
    planets?: number[];
  };
  update: { type: 'update'; ready: boolean };
  updating: { type: 'updating'; by?: string | null };
  welcome: { type: 'welcome'; id: number };
  games: { type: 'games'; games: GameListing[] };
  joined: { type: 'joined'; code: string; name: string; map: string; mode: Mode };
  nogame: { type: 'nogame'; code: string | null };
  full: { type: 'full'; scope?: string };
  snapshot: Snapshot;
  self: SelfMessage;
  round:
    | {
        type: 'round';
        state: 'over';
        mode: Mode;
        winner: { team?: Team; id?: number; name?: string } | null;
        ms: number;
      }
    | { type: 'round'; state: 'start' | 'sudden'; mode: Mode; winner?: never; ms?: number };
  flag: { type: 'flag'; team: Team; event: string; by?: number | null; captures?: Record<Team, number> };
  spawn: { type: 'spawn'; id: number; feet: Vector3; yaw: number };
  shot: { type: 'shot'; id: number; weapon: string; from: Vector3; to: Vector3 };
  chip: { type: 'chip'; cell: Vector3; wear: number; broke: boolean };
  launch: { type: 'launch'; id: number; shot?: number; kind: string; from: Vector3; velocity: Vector3 };
  pressure: { type: 'pressure'; id: number; from: Vector3; at: Vector3 };
  boom: {
    type: 'boom';
    kind?: string;
    at: Vector3;
    hole?: number;
    radius?: number;
    push?: number;
    on?: number | null;
  };
  arc: { type: 'arc'; id: number; points: Vector3[] };
  rubble: { type: 'rubble'; pieces: [number, number, number, number, number][]; ms?: number };
  fall: {
    type: 'fall';
    id: number;
    entry: HistoryEntry;
    cells: number[];
    drop: number;
    topple: { axis: 'x' | 'z'; sign: number; pivot: Vector3 } | null;
    ms: number;
  };
  landed: { type: 'landed'; id: number; entry: HistoryEntry; at: Vector3 | null; size: number };
  crack: { type: 'crack'; at: Vector3 };
  planet: { type: 'planet'; planet: number; by: number; strikes: [number, number, number, number][] };
  build: { type: 'build'; entry: HistoryEntry };
  push: { type: 'push'; velocity: Vector3 };
  kick: { type: 'kick'; id: number };
  item: { type: 'item'; spot: number; event: string; by?: number };
  medal: { type: 'medal'; id: number; medal?: string };
  powerup: { type: 'powerup'; event: string; kind: string; by?: number };
  crate:
    | { type: 'crate'; event: 'dropping'; item?: string; by?: number; at: Vector3 }
    | { type: 'crate'; event: 'taken'; item: string; by: number; at?: Vector3 };
  special: { type: 'special'; kind: string; id: number };
  teleport: { type: 'teleport'; id: number; from: Vector3; to: Vector3 };
  guiding: { type: 'guiding'; kind: string | null; id?: number };
  moved: { type: 'moved'; feet: Vector3 };
  killcam: { type: 'killcam'; killer: number; hp: number; armor: number };
  hit: {
    type: 'hit';
    from: number | null;
    to: number;
    hp: number;
    armor?: number;
    head?: boolean;
    weapon: string;
  };
  kill: { type: 'kill'; killer: number | null; victim: number; weapon: string };
  data: { type: 'data'; hash: string; blocks: GameData };
  pong: { type: 'pong'; t: number };
}
export type ServerMessage = ServerMessages[keyof ServerMessages];
export type ServerHandlers = { [K in keyof ServerMessages]: (message: ServerMessages[K]) => void };
export type { PlayerSnapshot };

export function readServerMessage(value: unknown): ServerMessage | null;
export function dispatchServerMessage(handlers: ServerHandlers, value: unknown): void;
