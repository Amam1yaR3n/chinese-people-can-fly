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

export type PickupType = "redPacket" | "skyLantern" | "sixthGenJet";

export type PickupStatus = "available" | "attracting" | "collected";

export type PlayerMode = "normal" | "lantern" | "jet";

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

export interface PickupState {
  id: number;
  type: PickupType;
  distance: number;
  pos: Vec2;
  status: PickupStatus;
}

export interface CameraState {
  x: number;
  y: number;
  shakeTime: number;
  shakeStrength: number;
}

export type AudioEvent =
  | "swing"
  | "hit"
  | "land"
  | "skip"
  | "explosion"
  | "pickupRedPacket"
  | "pickupLantern"
  | "pickupJet";

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
  score: number;
  ended: boolean;
}
