import type { GeometryPart, Layouts, Pieces, Prefabs, Vector3 } from './contracts.ts';

export type Matrix3 = [number, number, number, number, number, number, number, number, number];
export interface Transform {
  m: Matrix3;
  t: Vector3;
}
export interface Placement {
  at?: Vector3;
  turn?: 0 | 90 | 180 | 270;
  flip?: 'x' | 'z' | 'xz' | null;
  scale?: Vector3 | null;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: Vector3 };
}
export interface LayoutLibrary {
  pieces: Map<string, Pieces['pieces'][number]>;
  prefabs: Map<string, Prefabs['prefabs'][number]>;
}
export interface LayoutBox {
  min: Vector3;
  max: Vector3;
  m: string;
}
export interface ExpandedLayout {
  id: string;
  name: string;
  about: string;
  floor: string;
  roof: { at: number; m: string; skylights: [number, number, number, number][] };
  look: NonNullable<Layouts['layouts'][number]['look']>;
  boxes: LayoutBox[];
  spawns: Vector3[];
  items: { piece: string; at: Vector3 }[];
  pads: { piece: string; at: Vector3; to: Vector3; clear: number | null; launch: Vector3 }[];
  flags: Partial<Record<'red' | 'blue', Vector3>>;
  pool: { name: string; min: Vector3; max: Vector3; basin: { min: Vector3; max: Vector3 } } | null;
  pedestal: Vector3 | null;
}
export type PrimitivePart = Exclude<GeometryPart, { type: 'group' | 'piece' | 'prefab' }>;
export interface Pickup {
  piece: string;
  kind: 'health' | 'armor' | 'weapon';
  weapon: string | undefined;
  amount: number | undefined;
  cap: number | undefined;
  respawnMs: number;
  warnMs: number;
  name: string;
  color: string | undefined;
  asset: string | undefined;
  sound: string | undefined;
  at: Vector3;
}
export interface GameMap extends Omit<ExpandedLayout, 'floor' | 'roof' | 'boxes' | 'items'> {
  floor: number;
  roof: { at: number; m: number; skylights: [number, number, number, number][] };
  boxes: { min: Vector3; max: Vector3; m: number }[];
  items: Pickup[];
}
