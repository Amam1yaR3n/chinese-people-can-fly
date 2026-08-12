export interface Vec2 {
  x: number;
  y: number;
}

export type GamePhase =
  | "ready"
  | "falling"
  | "airborne"
  | "landingGrace"
  | "sliding"
  | "ended";

export type SwingState = "idle" | "downswing" | "followThrough" | "done";

export interface PlayerState {
  pos: Vec2;
  vel: Vec2;
  width: number;
  height: number;
}

export interface MineState {
  id: number;
  distance: number;
  pos: Vec2;
  exploded: boolean;
}

export interface CameraState {
  x: number;
  shakeTime: number;
  shakeStrength: number;
}

export type AudioEvent = "swing" | "hit" | "land" | "skip" | "explosion";

export interface ParticleState {
  pos: Vec2;
  vel: Vec2;
  rotation: number;
  spin: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface ExplosionState {
  pos: Vec2;
  life: number;
  maxLife: number;
}

export interface GameSnapshot {
  phase: GamePhase;
  distance: number;
  ended: boolean;
}
