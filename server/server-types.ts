import type { Game } from './game.js';
import type { GameOptions, RestoreInput } from '../shared/runtime-types.ts';

export interface Release {
  version: string;
  files: Map<string, Buffer>;
}
export interface Lobby {
  code: string;
  name: string;
  game: Game;
  emptySince: number;
}
export type ServerMetric = (
  code: string,
  name: string,
  value: number,
  labels: Readonly<Record<string, string>>,
) => void;
export interface LobbiesOptions {
  addresses?: string[] | undefined;
  version?: string | null | undefined;
  now?: (() => number) | undefined;
  game?: GameOptions | undefined;
  restore?: unknown;
  reportMetric?: ServerMetric | undefined;
}
export interface ServerOptions {
  port?: number | undefined;
  host?: string | undefined;
  respawnMs?: number | undefined;
  protectionMs?: number | undefined;
  reportMetric?: ServerMetric | undefined;
  restore?: unknown;
  update?: ((change: { state: LobbyState; by: string | null }) => void) | undefined;
}
export interface LobbyState {
  lobbies: ({ code: string; name: string } & ReturnType<Game['saveState']>)[];
}
export type LobbyRestore = RestoreInput & { code: string; name: string };
