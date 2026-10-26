import type { Vector3 } from '../../shared/contracts.ts';
import type {
  MovementState,
  Team,
  PlayerSnapshot,
  RoundSnapshot,
  Snapshot,
} from '../../shared/runtime-types.ts';
export interface ClientPlayer extends MovementState {
  id: number | null;
  alive: boolean;
  yaw: number;
  pitch: number;
  powerup: { kind: string; until: number } | null;
  team: Team | null;
  carrying: Team | null;
  spread: number;
  respawnAt: number;
}
export type { GameListing } from '../../shared/runtime-types.ts';
export interface WeaponTip {
  name: string;
  primary: string;
  secondary: string;
  extra: string;
  opacity: number;
}
export type MatchView = Omit<RoundSnapshot, 'ms' | 'sudden' | 'flags'> &
  Partial<Pick<RoundSnapshot, 'ms' | 'sudden'>> & { flags: RoundSnapshot['flags'] | null };
export type ScorePlayer = Pick<PlayerSnapshot, 'id' | 'name' | 'color' | 'team' | 'kills' | 'deaths'>;
export interface RadarView {
  items?: number[];
  crates?: Snapshot['crates'];
  powerups?: Snapshot['powerups'] | null;
}
export interface Ping {
  at: Vector3;
  start: number;
}
