import type { Vector3 } from '../shared/contracts.ts';
export interface FlyingProjectile {
  id: number;
  owner: number;
  kind: string;
  pos: Vector3;
  vel: Vector3;
  born: number;
  fuseAt: number;
  aim?: Vector3;
}
export interface Crate {
  id: number;
  item: string;
  at: Vector3;
  landed: boolean;
  until: number;
}
export interface Woolly {
  id: number;
  owner: number;
  pos: Vector3;
  dir: Vector3;
  vy: number;
  onGround: boolean;
  bumps: number;
  until: number;
}
export interface Missile {
  at: Vector3;
  dueAt: number;
  owner: number;
}
export interface BreakCause {
  at?: Vector3 | null;
  owner?: number | null;
  harmless?: boolean;
}
export type CellMaterial = [number, number, number, number];
export interface FallingPiece {
  id: number;
  cells: CellMaterial[];
  shape: CellMaterial[];
  owner: number | null;
  harmless: boolean;
  landAt: number;
}
export interface Topple {
  axis: 'x' | 'z';
  sign: number;
  pivot: Vector3;
}
export interface FallingPlan {
  topple: Topple | null;
  shape: CellMaterial[];
  dy: number;
}
export interface DropResult {
  dy: number;
  columns: number;
  contacts: [number, number][];
}
export interface HitClaim {
  id: number;
  head?: unknown;
  count?: unknown;
}
