import type * as THREE from 'three';
import type { Vec2, Vec3 } from './contracts.js';
export type AvatarPlayer = import('../../shared/runtime-types.ts').PlayerSnapshot;
export interface Flash {
  at: Vec3;
  color: THREE.Color;
  peak: number;
  life: number;
  total: number;
  range: number;
}
export interface Spark {
  at: Vec3;
  velocity: Vec3;
  color: THREE.Color;
  life: number;
  total: number;
  gravity: number;
  drag: number;
  bounce: boolean;
}
export type EffectMesh =
  | THREE.Mesh<THREE.BufferGeometry, THREE.Material>
  | THREE.Sprite
  | THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
export interface Effect {
  mesh: EffectMesh;
  life: number;
  total: number;
  animate: ((mesh: EffectMesh, left: number, dt: number) => void) | null;
  ownGeometry: boolean;
  peak: number;
}
export interface Meteor {
  ball: THREE.Sprite;
  from: Vec3;
  to: Vec3;
  landAt: number;
  puffAt: number;
}
export interface Chunk {
  at: Vec3;
  velocity: Vec3;
  spin: Vec3;
  turn: Vec3;
  color: THREE.Color;
  size: number;
  life: number;
  total: number;
  resting?: boolean;
}
export interface DustFall {
  lo: Vec2;
  hi: Vec2;
  top: number;
  bottom: number;
  color: THREE.Color;
  until: number;
}
export interface Flake {
  fall: DustFall;
  at: Vec3;
  speed: number;
  phase: number;
}
export interface WaterDrop {
  at: Vec3;
  velocity: Vec3;
  floor: number;
}
export interface Opening {
  at: Vec3;
  floor: Vec3 | null;
}
export interface Puddle {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshLambertMaterial>;
  size: number;
  grownUntil: number;
}
export interface Topple {
  pivot: Vec3;
  axis: 'x' | 'z';
  sign: number;
}
export interface FallingMessage {
  id: number;
  cells: number[];
  topple: Topple | null;
  drop: number;
  ms: number;
}
export interface FallingPiece extends Omit<FallingMessage, 'id'> {
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  pivot: Vec3;
  start: number;
}
export interface ProjectileShot {
  mesh: THREE.Object3D;
  blink: THREE.Object3D | null;
  trail: string | null;
  id: number;
  kind: string | null;
  from: Vec3;
  to: Vec3;
  heading: Vec3;
  authoritative: Vec3 | null;
  moved: Vec3 | null;
  puffAt: number;
}

export type ProjectileLook =
  | { type: 'thrown'; thrown: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> }
  | {
      type: 'rocket';
      body: THREE.CylinderGeometry;
      nose: THREE.ConeGeometry;
      bodyMaterial: THREE.MeshLambertMaterial;
      noseMaterial: THREE.MeshLambertMaterial;
      glow: THREE.SpriteMaterial;
      trail: 'smoke';
    }
  | {
      type: 'ball';
      size: number;
      color: number;
      light: number;
      geometry: THREE.SphereGeometry;
      material: THREE.MeshStandardMaterial;
      blinkGeometry: THREE.SphereGeometry;
      blinkMaterial: THREE.MeshBasicMaterial;
      glow: THREE.SpriteMaterial | null;
    };
