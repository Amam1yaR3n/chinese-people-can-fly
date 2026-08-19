import { GameConfig } from "./config";
import type { LauncherId } from "./launchers";
import {
  BackgroundPoses,
  BatterFrames,
  drawAtlasPose,
  drawOutlinedSpritePose,
  drawSpritePose,
  FlyerPoses,
  MinePose,
  PickupPoses,
  type BackgroundSprites,
  type CharacterSprites,
  type EffectSprites,
  type HumanCannonSprites,
  type MissileTruckSprites,
  type SlingshotSprites,
} from "./sprites";
import type {
  AudioEvent,
  CameraState,
  ExplosionState,
  GamePhase,
  GameSnapshot,
  MineState,
  ParticleState,
  PickupState,
  PickupType,
  PlayerMode,
  PlayerState,
  SwingState,
  Vec2,
} from "./types";

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;

const wrap = (value: number, period: number): number =>
  ((value % period) + period) % period;

const DISTANCE_EPSILON = 1e-7;
const TIME_EPSILON = 1e-7;

const randomBetween = (
  random: () => number,
  minimum: number,
  maximum: number,
): number => minimum + (maximum - minimum) * random();

const stableNoise = (index: number, channel: number): number => {
  const value = Math.sin(index * 12.9898 + channel * 78.233) * 43_758.5453;
  return value - Math.floor(value);
};

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const pointToSegmentDistance = (
  point: Vec2,
  start: Vec2,
  end: Vec2,
): number => {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const projection = clamp(
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) /
      lengthSquared,
    0,
    1,
  );
  const closestX = start.x + segmentX * projection;
  const closestY = start.y + segmentY * projection;
  return Math.hypot(point.x - closestX, point.y - closestY);
};

interface SwingRuntime {
  state: SwingState;
  elapsed: number;
}

interface ImpactFlashRuntime {
  pos: Vec2;
  life: number;
  maxLife: number;
}

interface JetTrailRuntime {
  startX: number;
  endX: number;
  y: number;
}

interface PowerUpRuntime {
  mode: PlayerMode;
  remainingDistance: number;
  remainingDuration: number;
  exitSpeed: number;
}

interface UfoBeamGeometry {
  centerX: number;
  topY: number;
  groundY: number;
  topWidth: number;
  groundWidth: number;
  topCapHeight: number;
  groundCapHeight: number;
}

type SlingshotState =
  | "idle"
  | "dragging"
  | "returning"
  | "recoil"
  | "settled";

interface SlingshotRuntime {
  state: SlingshotState;
  offset: Vec2;
  animationStart: Vec2;
  elapsed: number;
  atLimit: boolean;
  limitPulseRemaining: number;
  pointerGrabOffset: Vec2;
}

type HumanCannonState = "idle" | "lit" | "fired";

interface HumanCannonRuntime {
  state: HumanCannonState;
  elapsed: number;
}

export class Game {
  private phase: GamePhase = "ready";
  private player: PlayerState;
  private swing: SwingRuntime;
  private camera: CameraState = { x: 0, y: 0, shakeTime: 0, shakeStrength: 0 };
  private powerUp: PowerUpRuntime = {
    mode: "normal",
    remainingDistance: 0,
    remainingDuration: 0,
    exitSpeed: GameConfig.powerUp.jet.exitSpeed,
  };
  private verticalTrackingActive = false;
  private mines: MineState[] = [];
  private pickups: PickupState[] = [];
  private particles: ParticleState[] = [];
  private explosions: ExplosionState[] = [];
  private impactFlash: ImpactFlashRuntime | null = null;
  private jetTrails: JetTrailRuntime[] = [];
  private maxDistance = 0;
  private landingElapsed = 0;
  private landingWasAirborne = false;
  private impactVelocity: Vec2 = { x: 0, y: 0 };
  private approachAttempted = false;
  private skipQueued = false;
  private random: () => number = Math.random;
  private nextMineDistance: number = GameConfig.mine.firstMin;
  private mineId = 0;
  private nextPickupDistance: number = GameConfig.pickup.safeDistance;
  private pickupId = 0;
  private elapsedTime = 0;
  private missileTailFlameRemaining = 0;
  private slingshot: SlingshotRuntime = this.createSlingshotRuntime();
  private humanCannon: HumanCannonRuntime = this.createHumanCannonRuntime();

  constructor(
    private readonly emitAudio: (event: AudioEvent) => void,
    private readonly sprites: CharacterSprites | null,
    private readonly slingshotSprites: SlingshotSprites | null,
    private readonly humanCannonSprites: HumanCannonSprites | null,
    private readonly missileTruckSprites: MissileTruckSprites | null,
    private launcherId: LauncherId,
    private readonly effectSprites: EffectSprites | null = null,
    private readonly backgroundSprites: BackgroundSprites | null = null,
  ) {
    this.player = this.createPlayer();
    this.swing = this.createSwing();
    this.resetRound(false);
  }

  getSnapshot(): GameSnapshot {
    const distance = Math.max(0, Math.floor(this.maxDistance));
    return {
      phase: this.phase,
      distance,
      ended: this.phase === "ended",
      launcherId: this.launcherId,
    };
  }

  setLauncher(launcherId: LauncherId): void {
    if (launcherId === this.launcherId) return;
    this.launcherId = launcherId;
    this.resetRound(false);
  }

  pointerDown(position: Vec2): boolean {
    if (this.launcherId === "slingshot" && this.phase === "ready") {
      return this.beginSlingshotDrag(position);
    }
    this.action();
    return false;
  }

  pointerMove(position: Vec2): void {
    if (this.launcherId !== "slingshot") return;
    if (this.slingshot.state !== "dragging") return;
    this.updateSlingshotDrag(position);
  }

  pointerUp(position: Vec2): void {
    if (this.launcherId !== "slingshot") return;
    if (this.slingshot.state !== "dragging") return;
    this.updateSlingshotDrag(position);
    this.releaseSlingshot();
  }

  cancelLauncherGesture(): void {
    if (
      this.launcherId === "slingshot" &&
      this.phase === "ready" &&
      this.slingshot.state === "dragging"
    ) {
      this.startSlingshotReturn();
    }
  }

  action(): void {
    switch (this.phase) {
      case "ready":
        if (this.launcherId === "blackEagle") {
          this.phase = "falling";
        } else if (this.launcherId === "humanCannon") {
          this.advanceHumanCannon();
        } else if (this.launcherId === "missileTruck") {
          this.launchMissileTruck();
        }
        break;
      case "ended":
        this.resetRound(false);
        break;
      case "falling":
        if (this.swing.state === "idle") {
          this.swing.state = "downswing";
          this.swing.elapsed = 0;
          this.emitAudio("swing");
          this.tryInitialLaunch();
        }
        break;
      case "airborne":
        if (this.powerUp.mode === "normal") {
          this.handleAirborneAction();
        }
        break;
      case "landingGrace":
        this.handleLandingAction();
        break;
      case "sliding":
        break;
    }
  }

  update(deltaTime: number): void {
    this.elapsedTime += deltaTime;
    const previousPlayerPosition = { ...this.player.pos };
    this.updateSwing(deltaTime);
    this.updateSlingshot(deltaTime);
    this.updateHumanCannon(deltaTime);
    this.updateMissileTailFlame(deltaTime);

    switch (this.phase) {
      case "falling":
        this.updateInitialFall(deltaTime);
        break;
      case "airborne":
        this.updateAirborne(deltaTime);
        break;
      case "landingGrace":
        this.updateLandingGrace(deltaTime);
        break;
      case "sliding":
        this.updateSliding(deltaTime);
        break;
      case "ready":
      case "ended":
        break;
    }

    this.maxDistance = Math.max(this.maxDistance, this.player.pos.x);
    this.ensureMines(this.maxDistance + GameConfig.mine.generationAhead);
    this.ensurePickups(this.maxDistance + GameConfig.pickup.generationAhead);
    this.updateCamera(deltaTime);
    this.updatePickups(deltaTime, previousPlayerPosition);
    this.updateEffects(deltaTime);
  }

  render(context: CanvasRenderingContext2D): void {
    const { logicalWidth, logicalHeight } = GameConfig;
    context.fillStyle = GameConfig.background.skyColor;
    context.fillRect(0, 0, logicalWidth, logicalHeight);

    this.drawSky(context);

    const shake = this.getShakeOffset();
    context.save();
    context.translate(shake.x, shake.y);
    this.drawMidground(context);
    this.drawWorld(context);
    context.restore();
  }

  private createPlayer(): PlayerState {
    return {
      pos: { x: GameConfig.player.startX, y: GameConfig.player.startY },
      vel: { x: 0, y: 0 },
      width: GameConfig.player.width,
      height: GameConfig.player.height,
    };
  }

  private createSwing(): SwingRuntime {
    return {
      state: "idle",
      elapsed: 0,
    };
  }

  private createSlingshotRuntime(): SlingshotRuntime {
    return {
      state: "idle",
      offset: { x: 0, y: 0 },
      animationStart: { x: 0, y: 0 },
      elapsed: 0,
      atLimit: false,
      limitPulseRemaining: 0,
      pointerGrabOffset: { x: 0, y: 0 },
    };
  }

  private createHumanCannonRuntime(): HumanCannonRuntime {
    return {
      state: "idle",
      elapsed: 0,
    };
  }

  private resetRound(startImmediately: boolean): void {
    this.phase =
      this.launcherId === "blackEagle" && startImmediately
        ? "falling"
        : "ready";
    this.player = this.createPlayer();
    this.swing = this.createSwing();
    this.slingshot = this.createSlingshotRuntime();
    this.humanCannon = this.createHumanCannonRuntime();
    this.camera = { x: 0, y: 0, shakeTime: 0, shakeStrength: 0 };
    this.powerUp = {
      mode: "normal",
      remainingDistance: 0,
      remainingDuration: 0,
      exitSpeed: GameConfig.powerUp.jet.exitSpeed,
    };
    this.verticalTrackingActive = false;
    this.maxDistance = 0;
    this.landingElapsed = 0;
    this.landingWasAirborne = false;
    this.impactVelocity = { x: 0, y: 0 };
    this.approachAttempted = false;
    this.skipQueued = false;
    this.particles = [];
    this.explosions = [];
    this.impactFlash = null;
    this.jetTrails = [];
    this.mines = [];
    this.pickups = [];
    this.mineId = 0;
    this.pickupId = 0;
    this.elapsedTime = 0;
    this.missileTailFlameRemaining = 0;

    const seedArray = new Uint32Array(1);
    crypto.getRandomValues(seedArray);
    this.random = mulberry32(seedArray[0] ?? Date.now());
    this.nextMineDistance = randomBetween(
      this.random,
      GameConfig.mine.firstMin,
      GameConfig.mine.firstMax,
    );
    this.nextPickupDistance = randomBetween(
      this.random,
      GameConfig.pickup.safeDistance,
      GameConfig.pickup.firstMaxDistance,
    );
    if (this.launcherId === "slingshot") {
      this.syncPlayerToSlingshot();
    }
    this.ensureMines(GameConfig.mine.generationAhead);
    this.ensurePickups(GameConfig.pickup.generationAhead);
  }

  private beginSlingshotDrag(position: Vec2): boolean {
    const pouch = this.slingshotPouchScreen();
    const seated = this.slingshotSeatedScreen(pouch);
    const distanceToSeated = Math.hypot(
      position.x - seated.x,
      position.y - seated.y,
    );
    const distanceToPouch = Math.hypot(
      position.x - pouch.x,
      position.y - pouch.y,
    );
    if (
      Math.min(distanceToSeated, distanceToPouch) >
      GameConfig.slingshot.hotspotRadius
    ) {
      return false;
    }

    this.slingshot.state = "dragging";
    this.slingshot.elapsed = 0;
    this.slingshot.animationStart = { ...this.slingshot.offset };
    this.slingshot.atLimit = false;
    this.slingshot.pointerGrabOffset = {
      x: position.x - pouch.x,
      y: position.y - pouch.y,
    };
    this.updateSlingshotDrag(position);
    return true;
  }

  private updateSlingshotDrag(position: Vec2): void {
    const rest = this.worldToScreen(GameConfig.slingshot.restPouchWorld);
    const desiredPouch = {
      x: position.x - this.slingshot.pointerGrabOffset.x,
      y: position.y - this.slingshot.pointerGrabOffset.y,
    };
    const rawLaunchX = rest.x - desiredPouch.x;
    const rawLaunchY = rest.y - desiredPouch.y;
    const rawDistance = Math.hypot(rawLaunchX, rawLaunchY);
    const rawAngle = Math.atan2(-rawLaunchY, Math.max(0, rawLaunchX));
    const launchAngle = clamp(
      rawAngle,
      GameConfig.slingshot.minimumAngle,
      GameConfig.slingshot.maximumAngle,
    );
    const pullDistance = Math.min(
      rawDistance,
      GameConfig.slingshot.maximumPull,
    );

    this.slingshot.offset = {
      x: -Math.cos(launchAngle) * pullDistance,
      y: Math.sin(launchAngle) * pullDistance,
    };

    const reachedLimit = rawDistance >= GameConfig.slingshot.maximumPull;
    if (reachedLimit && !this.slingshot.atLimit) {
      this.slingshot.limitPulseRemaining =
        GameConfig.slingshot.limitPulseDuration;
    }
    this.slingshot.atLimit = reachedLimit;
    this.syncPlayerToSlingshot();
  }

  private releaseSlingshot(): void {
    const pullDistance = Math.hypot(
      this.slingshot.offset.x,
      this.slingshot.offset.y,
    );
    if (pullDistance < GameConfig.slingshot.minimumPull) {
      this.startSlingshotReturn();
      return;
    }

    const speedProgress = clamp(
      (pullDistance - GameConfig.slingshot.minimumPull) /
        (GameConfig.slingshot.maximumPull -
          GameConfig.slingshot.minimumPull),
      0,
      1,
    );
    const launchSpeed = lerp(
      GameConfig.slingshot.minimumSpeed,
      GameConfig.slingshot.maximumSpeed,
      speedProgress,
    );
    const launchAngle = Math.atan2(
      this.slingshot.offset.y,
      -this.slingshot.offset.x,
    );

    this.slingshot.state = "recoil";
    this.slingshot.animationStart = { ...this.slingshot.offset };
    this.slingshot.elapsed = 0;
    this.slingshot.atLimit = false;
    this.launchPlayerWithVelocity({
      x: Math.cos(launchAngle) * launchSpeed,
      y: -Math.sin(launchAngle) * launchSpeed,
    });
  }

  private startSlingshotReturn(): void {
    this.slingshot.state = "returning";
    this.slingshot.animationStart = { ...this.slingshot.offset };
    this.slingshot.elapsed = 0;
    this.slingshot.atLimit = false;
    this.slingshot.limitPulseRemaining = 0;
  }

  private updateSlingshot(deltaTime: number): void {
    this.slingshot.limitPulseRemaining = Math.max(
      0,
      this.slingshot.limitPulseRemaining - deltaTime,
    );

    if (this.slingshot.state === "returning") {
      this.slingshot.elapsed += deltaTime;
      const progress = clamp(
        this.slingshot.elapsed /
          GameConfig.slingshot.cancelReturnDuration,
        0,
        1,
      );
      const eased = 1 - (1 - progress) ** 3;
      this.slingshot.offset = {
        x: this.slingshot.animationStart.x * (1 - eased),
        y: this.slingshot.animationStart.y * (1 - eased),
      };
      this.syncPlayerToSlingshot();
      if (progress >= 1) {
        this.slingshot.state = "idle";
        this.slingshot.offset = { x: 0, y: 0 };
      }
      return;
    }

    if (this.slingshot.state !== "recoil") return;

    this.slingshot.elapsed += deltaTime;
    const { recoilOvershootDuration, recoilDuration } = GameConfig.slingshot;
    let factor = 0;
    if (this.slingshot.elapsed < recoilOvershootDuration) {
      const progress = clamp(
        this.slingshot.elapsed / recoilOvershootDuration,
        0,
        1,
      );
      const eased = 1 - (1 - progress) ** 3;
      factor = lerp(1, -0.14, eased);
    } else {
      const progress = clamp(
        (this.slingshot.elapsed - recoilOvershootDuration) /
          (recoilDuration - recoilOvershootDuration),
        0,
        1,
      );
      factor = -0.14 * (1 - progress) * Math.cos(progress * Math.PI * 4);
    }
    this.slingshot.offset = {
      x: this.slingshot.animationStart.x * factor,
      y: this.slingshot.animationStart.y * factor,
    };

    if (this.slingshot.elapsed >= recoilDuration) {
      this.slingshot.state = "settled";
      this.slingshot.offset = { x: 0, y: 0 };
    }
  }

  private syncPlayerToSlingshot(): void {
    const { restPouchWorld, seatedOffset } = GameConfig.slingshot;
    this.player.pos = {
      x:
        restPouchWorld.x +
        (this.slingshot.offset.x + seatedOffset.x) /
          GameConfig.pixelsPerMeter,
      y:
        restPouchWorld.y +
        (this.slingshot.offset.y + seatedOffset.y) /
          GameConfig.pixelsPerMeter,
    };
    this.player.vel = { x: 0, y: 0 };
  }

  private slingshotPouchScreen(): Vec2 {
    const rest = this.worldToScreen(GameConfig.slingshot.restPouchWorld);
    const jitter = this.slingshotLimitJitter();
    return {
      x: rest.x + this.slingshot.offset.x,
      y: rest.y + this.slingshot.offset.y + jitter,
    };
  }

  private slingshotSeatedScreen(pouch: Vec2): Vec2 {
    return {
      x: pouch.x + GameConfig.slingshot.seatedOffset.x,
      y: pouch.y + GameConfig.slingshot.seatedOffset.y,
    };
  }

  private slingshotLimitJitter(): number {
    const duration = GameConfig.slingshot.limitPulseDuration;
    if (this.slingshot.limitPulseRemaining <= 0 || duration <= 0) return 0;
    const elapsed = duration - this.slingshot.limitPulseRemaining;
    return (
      Math.sin(elapsed * Math.PI * 50) *
      3 *
      GameConfig.visualScale *
      (this.slingshot.limitPulseRemaining / duration)
    );
  }

  private advanceHumanCannon(): void {
    if (this.humanCannon.state === "idle") {
      this.humanCannon.state = "lit";
      this.humanCannon.elapsed = 0;
      return;
    }

    if (this.humanCannon.state !== "lit") return;

    const { launchAngle, minimumSpeed, maximumSpeed, muzzleWorld } =
      GameConfig.humanCannon;
    const launchSpeed = lerp(
      minimumSpeed,
      maximumSpeed,
      this.humanCannonPower(),
    );
    this.humanCannon.state = "fired";
    this.humanCannon.elapsed = 0;
    this.player.pos = { ...muzzleWorld };
    this.launchPlayerWithVelocity({
      x: Math.cos(launchAngle) * launchSpeed,
      y: -Math.sin(launchAngle) * launchSpeed,
    });
  }

  private updateHumanCannon(deltaTime: number): void {
    if (this.humanCannon.state === "idle") return;
    this.humanCannon.elapsed += deltaTime;
  }

  private humanCannonPower(): number {
    if (this.humanCannon.state !== "lit") return 0;
    const duration = GameConfig.humanCannon.sweepDuration;
    const leg = Math.floor(this.humanCannon.elapsed / duration);
    const legProgress =
      (this.humanCannon.elapsed - leg * duration) / duration;
    return leg % 2 === 0 ? legProgress : 1 - legProgress;
  }

  private launchMissileTruck(): void {
    const { launchAngle, launchSpeed, launchWorld } = GameConfig.missileTruck;
    this.missileTailFlameRemaining =
      GameConfig.missileTruck.tailFlameDuration;
    this.player.pos = { ...launchWorld };
    this.launchPlayerWithVelocity({
      x: Math.cos(launchAngle) * launchSpeed,
      y: -Math.sin(launchAngle) * launchSpeed,
    });
  }

  private updateMissileTailFlame(deltaTime: number): void {
    this.missileTailFlameRemaining = Math.max(
      0,
      this.missileTailFlameRemaining - deltaTime,
    );
  }

  private updateInitialFall(deltaTime: number): void {
    this.player.vel.y += GameConfig.initialFallGravity * deltaTime;
    this.player.pos.y += this.player.vel.y * deltaTime;
    if (this.player.pos.y >= this.groundCenterY()) {
      this.beginLanding(false);
    }
  }

  private updateAirborne(deltaTime: number): void {
    if (this.powerUp.mode === "lantern") {
      this.updateLanternFlight(deltaTime);
      return;
    }
    if (this.powerUp.mode === "jet") {
      this.updateJetFlight(deltaTime);
      return;
    }
    if (this.powerUp.mode === "ufo") {
      this.updateUfoFlight(deltaTime);
      return;
    }

    this.updateNormalAirborne(deltaTime);
  }

  private updateNormalAirborne(deltaTime: number): void {
    this.player.vel.y += GameConfig.gravity * deltaTime;
    this.player.pos.x += this.player.vel.x * deltaTime;
    this.player.pos.y += this.player.vel.y * deltaTime;

    if (this.checkMineCollision()) return;

    if (this.player.pos.y >= this.groundCenterY()) {
      this.beginLanding(true);
    }
  }

  private updateLanternFlight(deltaTime: number): void {
    const { ascentSpeed } = GameConfig.powerUp.lantern;
    const ascent = Math.min(
      ascentSpeed * deltaTime,
      this.powerUp.remainingDistance,
    );
    this.player.pos.x += this.player.vel.x * deltaTime;
    this.player.pos.y -= ascent;
    this.player.vel.y = -ascentSpeed;
    this.powerUp.remainingDistance -= ascent;

    if (this.powerUp.remainingDistance <= DISTANCE_EPSILON) {
      this.powerUp.mode = "normal";
      this.powerUp.remainingDistance = 0;
      this.player.vel.y = 0;
    }
  }

  private updateJetFlight(deltaTime: number): void {
    const activeTime = Math.min(deltaTime, this.powerUp.remainingDuration);
    this.player.pos.x += this.player.vel.x * activeTime;
    this.player.vel.y = 0;
    this.powerUp.remainingDuration -= activeTime;
    const activeTrail = this.jetTrails.at(-1);
    if (activeTrail) {
      activeTrail.endX =
        this.player.pos.x -
        GameConfig.powerUp.jet.trailExhaustOffsetX /
          GameConfig.pixelsPerMeter;
    }

    if (this.powerUp.remainingDuration <= TIME_EPSILON) {
      this.powerUp.mode = "normal";
      this.powerUp.remainingDuration = 0;
      this.player.vel.x = this.powerUp.exitSpeed;
      this.player.vel.y = 0;

      const normalTime = deltaTime - activeTime;
      if (normalTime > TIME_EPSILON) {
        this.updateNormalAirborne(normalTime);
      }
    }
  }

  private updateUfoFlight(deltaTime: number): void {
    const activeTime = Math.min(deltaTime, this.powerUp.remainingDuration);
    this.player.pos.x += this.player.vel.x * activeTime;
    this.player.vel.y = 0;
    this.powerUp.remainingDuration -= activeTime;

    if (this.powerUp.remainingDuration <= TIME_EPSILON) {
      this.powerUp.mode = "normal";
      this.powerUp.remainingDuration = 0;
      this.player.vel.x = this.powerUp.exitSpeed;
      this.player.vel.y = 0;

      const normalTime = deltaTime - activeTime;
      if (normalTime > TIME_EPSILON) {
        this.updateNormalAirborne(normalTime);
      }
    }
  }

  private beginLanding(wasAirborne: boolean): void {
    this.player.pos.y = this.groundCenterY();
    this.impactVelocity = { ...this.player.vel };
    // Keep the horizontal component alive during the post-impact input window.
    // Freezing it here made every landing visibly pause for 120 ms.
    this.player.vel = { x: this.impactVelocity.x, y: 0 };
    this.landingWasAirborne = wasAirborne;
    this.landingElapsed = 0;

    if (
      wasAirborne &&
      this.skipQueued &&
      this.isImpactFastEnough(this.impactVelocity)
    ) {
      this.applySkip();
      return;
    }

    this.phase = "landingGrace";
  }

  private updateLandingGrace(deltaTime: number): void {
    this.updateGroundMotion(deltaTime);
    if (this.checkMineCollision()) return;

    this.landingElapsed += deltaTime;
    if (this.landingElapsed < GameConfig.skip.postImpactWindow) return;

    this.phase = "sliding";
    this.emitAudio("land");
  }

  private updateSliding(deltaTime: number): void {
    const reducedSpeed = this.updateGroundMotion(deltaTime);

    if (this.checkMineCollision()) return;

    if (reducedSpeed < GameConfig.stopSpeed) {
      this.player.vel.x = 0;
      this.phase = "ended";
    }
  }

  private updateGroundMotion(deltaTime: number): number {
    this.player.pos.x += this.player.vel.x * deltaTime;
    const speed = Math.abs(this.player.vel.x);
    const reducedSpeed = Math.max(0, speed - GameConfig.groundFriction * deltaTime);
    this.player.vel.x = Math.sign(this.player.vel.x) * reducedSpeed;
    return reducedSpeed;
  }

  private handleAirborneAction(): void {
    if (this.player.vel.y <= 0 || this.approachAttempted) return;
    const timeToImpact = this.timeToImpact();
    if (timeToImpact > GameConfig.skip.approachWindow) return;

    this.approachAttempted = true;
    this.skipQueued =
      timeToImpact <= GameConfig.skip.preImpactWindow &&
      this.isImpactFastEnough(this.projectedImpactVelocity(timeToImpact));
  }

  private handleLandingAction(): void {
    if (
      !this.landingWasAirborne ||
      this.approachAttempted ||
      this.landingElapsed > GameConfig.skip.postImpactWindow
    ) {
      return;
    }

    this.approachAttempted = true;
    if (this.isImpactFastEnough(this.impactVelocity)) {
      this.applySkip();
    }
  }

  private applySkip(): void {
    this.phase = "airborne";
    this.player.pos.y = this.groundCenterY() - 0.02;
    this.player.vel.x = this.impactVelocity.x * GameConfig.skip.horizontalRetention;
    this.player.vel.y =
      -Math.abs(this.impactVelocity.y) * GameConfig.skip.verticalRetention;
    this.resetApproachState();
    this.emitAudio("skip");
  }

  private resetApproachState(): void {
    this.approachAttempted = false;
    this.skipQueued = false;
    this.landingElapsed = 0;
    this.landingWasAirborne = false;
  }

  private timeToImpact(): number {
    const distance = this.groundCenterY() - this.player.pos.y;
    if (distance <= 0) return 0;
    const velocity = this.player.vel.y;
    const discriminant = velocity * velocity + 2 * GameConfig.gravity * distance;
    return (-velocity + Math.sqrt(discriminant)) / GameConfig.gravity;
  }

  private projectedImpactVelocity(timeToImpact: number): Vec2 {
    return {
      x: this.player.vel.x,
      y: this.player.vel.y + GameConfig.gravity * timeToImpact,
    };
  }

  private isImpactFastEnough(velocity: Vec2): boolean {
    return Math.hypot(velocity.x, velocity.y) >= GameConfig.skip.minImpactSpeed;
  }

  private updateSwing(deltaTime: number): void {
    if (this.swing.state === "idle" || this.swing.state === "done") return;

    const swing = GameConfig.swing;
    this.swing.elapsed = Math.min(swing.duration, this.swing.elapsed + deltaTime);

    if (this.swing.elapsed >= swing.duration) {
      this.swing.state = "done";
    } else if (this.swing.elapsed >= swing.followThroughStart) {
      this.swing.state = "followThrough";
    }
  }

  private tryInitialLaunch(): void {
    const { launchWindowTopY, launchWindowBottomY } = GameConfig.swing;
    const playerY = this.player.pos.y;
    if (playerY < launchWindowTopY || playerY > launchWindowBottomY) return;

    const timingProgress =
      (playerY - launchWindowTopY) /
      (launchWindowBottomY - launchWindowTopY);
    const launchAngle = lerp(
      GameConfig.launchAngleMax,
      GameConfig.launchAngleMin,
      timingProgress,
    );

    this.launchPlayer(launchAngle);
  }

  private launchPlayer(launchAngle: number): void {
    this.launchPlayerWithVelocity({
      x: Math.cos(launchAngle) * GameConfig.launchSpeed,
      y: -Math.sin(launchAngle) * GameConfig.launchSpeed,
    });
  }

  private launchPlayerWithVelocity(velocity: Vec2): void {
    if (this.launcherId === "blackEagle") {
      const clubHead = this.batterClubSegment(this.swing.elapsed).end;
      this.impactFlash = {
        pos: {
          x: lerp(clubHead.x, this.player.pos.x, 0.4),
          y: lerp(clubHead.y, this.player.pos.y, 0.4),
        },
        life: GameConfig.swing.impactFlashDuration,
        maxLife: GameConfig.swing.impactFlashDuration,
      };
    }
    this.player.vel = { ...velocity };
    this.phase = "airborne";
    this.resetApproachState();
    switch (this.launcherId) {
      case "blackEagle":
        this.emitAudio("hitBlackEagle");
        break;
      case "slingshot":
        this.emitAudio("launchSlingshot");
        break;
      case "humanCannon":
        this.emitAudio("launchHumanCannon");
        break;
      case "missileTruck":
        this.emitAudio("launchMissileTruck");
        break;
    }
  }

  private batterClubSegment(elapsed: number): { start: Vec2; end: Vec2 } {
    const frameDuration =
      GameConfig.swing.duration / GameConfig.swing.frameCount;
    const framePosition = clamp(
      elapsed / frameDuration,
      0,
      Math.min(3, BatterFrames.length - 1),
    );
    const firstIndex = Math.floor(framePosition);
    const secondIndex = Math.min(firstIndex + 1, 3);
    const amount = framePosition - firstIndex;
    const firstFrame = BatterFrames[firstIndex];
    const secondFrame = BatterFrames[secondIndex];
    const firstClub = firstFrame.club!;
    const secondClub = secondFrame.club!;

    const toWorld = (point: Vec2, frame: (typeof BatterFrames)[number]): Vec2 => ({
      x:
        GameConfig.hitter.x +
        ((frame.anchor.x - point.x) * frame.scale) /
          GameConfig.pixelsPerMeter,
      y:
        ((point.y - frame.anchor.y) * frame.scale) /
        GameConfig.pixelsPerMeter,
    });

    const firstGrip = toWorld(firstClub.grip, firstFrame);
    const secondGrip = toWorld(secondClub.grip, secondFrame);
    const firstHead = toWorld(firstClub.head, firstFrame);
    const secondHead = toWorld(secondClub.head, secondFrame);
    return {
      start: {
        x: lerp(firstGrip.x, secondGrip.x, amount),
        y: lerp(firstGrip.y, secondGrip.y, amount),
      },
      end: {
        x: lerp(firstHead.x, secondHead.x, amount),
        y: lerp(firstHead.y, secondHead.y, amount),
      },
    };
  }

  private checkMineCollision(): boolean {
    for (const mine of this.mines) {
      if (mine.exploded) continue;
      const horizontalOverlap =
        Math.abs(this.player.pos.x - mine.pos.x) <=
        (this.player.width + GameConfig.mine.width) / 2;
      const verticalOverlap =
        Math.abs(this.player.pos.y - mine.pos.y) <=
        (this.player.height + GameConfig.mine.height) / 2;
      if (horizontalOverlap && verticalOverlap) {
        this.triggerMine(mine);
        return true;
      }
    }
    return false;
  }

  private triggerMine(mine: MineState): void {
    mine.exploded = true;
    this.player.pos.y = Math.min(this.player.pos.y, this.groundCenterY() - 0.1);
    this.player.vel.x = Math.max(
      Math.abs(this.player.vel.x || this.impactVelocity.x) *
        GameConfig.mine.horizontalMultiplier,
      GameConfig.mine.minimumHorizontalBoost,
    );
    this.player.vel.y = -GameConfig.mine.verticalBoost;
    this.phase = "airborne";
    this.resetApproachState();
    this.spawnExplosion(mine.pos);
    this.camera.shakeTime = GameConfig.camera.shakeDuration;
    this.camera.shakeStrength = GameConfig.camera.shakeStrength;
    this.emitAudio("explosion");
  }

  private ensureMines(targetDistance: number): void {
    while (this.nextMineDistance <= targetDistance) {
      const distance = this.clearDistanceSign(this.nextMineDistance);
      this.mines.push({
        id: this.mineId,
        distance,
        pos: { x: distance, y: -GameConfig.mine.height / 2 },
        exploded: false,
      });
      this.mineId += 1;
      this.nextMineDistance =
        distance +
        randomBetween(
          this.random,
          GameConfig.mine.intervalMin,
          GameConfig.mine.intervalMax,
        );
    }
  }

  private ensurePickups(targetDistance: number): void {
    while (this.nextPickupDistance <= targetDistance) {
      const type = this.choosePickupType();
      const pickupConfig = this.getPickupConfig(type);
      const altitude = randomBetween(
        this.random,
        pickupConfig.minAltitude,
        pickupConfig.maxAltitude,
      );
      this.pickups.push({
        id: this.pickupId,
        type,
        distance: this.nextPickupDistance,
        pos: { x: this.nextPickupDistance, y: -altitude },
        status: "available",
      });
      this.pickupId += 1;
      this.nextPickupDistance += randomBetween(
        this.random,
        GameConfig.pickup.intervalMin,
        GameConfig.pickup.intervalMax,
      );
    }
  }

  private choosePickupType(): PickupType {
    const roll = this.random();
    const lanternThreshold = GameConfig.pickup.skyLantern.weight;
    if (roll < lanternThreshold) {
      return "skyLantern";
    }
    const jetThreshold =
      lanternThreshold + GameConfig.pickup.sixthGenJet.weight;
    if (roll < jetThreshold) return "sixthGenJet";
    return "ufo";
  }

  private getPickupConfig(type: PickupType) {
    switch (type) {
      case "redPacket":
        return GameConfig.pickup.redPacket;
      case "skyLantern":
        return GameConfig.pickup.skyLantern;
      case "sixthGenJet":
        return GameConfig.pickup.sixthGenJet;
      case "ufo":
        return GameConfig.pickup.ufo;
    }
  }

  private updatePickups(
    deltaTime: number,
    previousPlayerPosition: Vec2,
  ): void {
    if (this.phase === "airborne") {
      for (const pickup of this.pickups) {
        if (pickup.status !== "available") continue;
        const highSpeedTransformation =
          this.powerUp.mode === "jet" || this.powerUp.mode === "ufo";
        if (
          highSpeedTransformation &&
          pickup.type !== "redPacket"
        ) {
          continue;
        }
        if (this.powerUp.mode === "ufo" && pickup.type === "redPacket") {
          continue;
        }
        if (
          pointToSegmentDistance(
            pickup.pos,
            previousPlayerPosition,
            this.player.pos,
          ) <= GameConfig.pickup.radius
        ) {
          this.collectPickup(pickup);
        }
      }

      if (this.powerUp.mode === "ufo") {
        this.lockVisibleRedPackets();
      }
    }

    this.updateAttractingRedPackets(deltaTime);
    const cleanupBefore = this.maxDistance - GameConfig.pickup.cleanupBehind;
    this.pickups = this.pickups.filter(
      (pickup) =>
        pickup.status === "attracting" ||
        (pickup.status !== "collected" && pickup.distance >= cleanupBefore),
    );
  }

  private collectPickup(pickup: PickupState): void {
    pickup.status = "collected";
    switch (pickup.type) {
      case "redPacket":
        this.emitAudio("pickupRedPacket");
        break;
      case "skyLantern":
        this.powerUp.mode = "lantern";
        this.powerUp.remainingDistance =
          GameConfig.powerUp.lantern.ascentDistance;
        this.powerUp.remainingDuration = 0;
        this.player.vel.y = -GameConfig.powerUp.lantern.ascentSpeed;
        this.verticalTrackingActive = true;
        this.resetApproachState();
        this.emitAudio("pickupLantern");
        break;
      case "sixthGenJet":
        this.powerUp.exitSpeed = Math.max(
          this.player.vel.x,
          GameConfig.powerUp.jet.exitSpeed,
        );
        this.powerUp.mode = "jet";
        this.powerUp.remainingDistance = 0;
        this.powerUp.remainingDuration = GameConfig.powerUp.jet.duration;
        {
          const exhaustX =
            this.player.pos.x -
            GameConfig.powerUp.jet.trailExhaustOffsetX /
              GameConfig.pixelsPerMeter;
          this.jetTrails.push({
            startX: exhaustX,
            endX: exhaustX,
            y: this.player.pos.y,
          });
        }
        this.player.vel.x = Math.max(
          this.player.vel.x,
          GameConfig.powerUp.jet.speed,
        );
        this.player.vel.y = 0;
        this.verticalTrackingActive = true;
        this.resetApproachState();
        this.emitAudio("pickupJet");
        break;
      case "ufo":
        this.powerUp.exitSpeed = Math.max(
          this.player.vel.x,
          GameConfig.powerUp.ufo.exitSpeed,
        );
        this.powerUp.mode = "ufo";
        this.powerUp.remainingDistance = 0;
        this.powerUp.remainingDuration = GameConfig.powerUp.ufo.duration;
        this.player.vel.x = Math.max(
          this.player.vel.x,
          GameConfig.powerUp.ufo.speed,
        );
        this.player.vel.y = 0;
        this.verticalTrackingActive = true;
        this.resetApproachState();
        this.emitAudio("pickupUfo");
        break;
    }
  }

  private lockVisibleRedPackets(): void {
    for (const pickup of this.pickups) {
      if (
        pickup.type !== "redPacket" ||
        pickup.status !== "available" ||
        !this.isPickupVisible(pickup)
      ) {
        continue;
      }
      pickup.status = "attracting";
      this.emitAudio("pickupRedPacket");
    }
  }

  private isPickupVisible(pickup: PickupState): boolean {
    const screen = this.worldToScreen(pickup.pos);
    const pickupConfig = this.getPickupConfig(pickup.type);
    const halfWidth =
      (pickupConfig.width * GameConfig.pixelsPerMeter) / 2;
    const halfHeight =
      (pickupConfig.height * GameConfig.pixelsPerMeter) / 2;
    return (
      screen.x + halfWidth >= 0 &&
      screen.x - halfWidth <= GameConfig.logicalWidth &&
      screen.y + halfHeight >= 0 &&
      screen.y - halfHeight <= GameConfig.logicalHeight
    );
  }

  private updateAttractingRedPackets(deltaTime: number): void {
    const travel = GameConfig.pickup.magnetSpeed * deltaTime;
    const target = this.ufoEmitterWorldPosition();
    for (const pickup of this.pickups) {
      if (pickup.status !== "attracting") continue;
      const offsetX = target.x - pickup.pos.x;
      const offsetY = target.y - pickup.pos.y;
      const distance = Math.hypot(offsetX, offsetY);
      if (
        distance <= GameConfig.pickup.magnetCollectDistance ||
        travel >= distance
      ) {
        pickup.pos = { ...target };
        pickup.status = "collected";
        continue;
      }
      pickup.pos.x += (offsetX / distance) * travel;
      pickup.pos.y += (offsetY / distance) * travel;
    }
  }

  private ufoEmitterWorldPosition(): Vec2 {
    return {
      x: this.player.pos.x,
      y: this.player.pos.y + GameConfig.powerUp.ufo.emitterOffsetY,
    };
  }

  private clearDistanceSign(distance: number): number {
    const interval = GameConfig.signs.interval;
    const remainder = distance % interval;
    if (remainder < GameConfig.mine.signClearance) {
      return distance + (GameConfig.mine.signClearance - remainder);
    }
    if (remainder > interval - GameConfig.mine.signClearance) {
      return distance + (interval + GameConfig.mine.signClearance - remainder);
    }
    return distance;
  }

  private spawnExplosion(position: Vec2): void {
    this.explosions.push({ pos: { ...position }, life: 0.32, maxLife: 0.32 });
    const particleCount = 18;
    for (let index = 0; index < particleCount; index += 1) {
      const angle = randomBetween(this.random, Math.PI, Math.PI * 2);
      const speed = randomBetween(this.random, 18, 52);
      const maxLife = randomBetween(this.random, 0.35, 0.72);
      this.particles.push({
        pos: { ...position },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        rotation: randomBetween(this.random, 0, Math.PI * 2),
        spin: randomBetween(this.random, -8, 8),
        life: maxLife,
        maxLife,
        size: randomBetween(this.random, 1.2, 3.1),
        color:
          index % 2 === 0
            ? GameConfig.palette.explosion
            : GameConfig.palette.explosionLight,
      });
    }
  }

  private updateEffects(deltaTime: number): void {
    for (const particle of this.particles) {
      particle.life -= deltaTime;
      particle.vel.y += GameConfig.gravity * 0.55 * deltaTime;
      particle.pos.x += particle.vel.x * deltaTime;
      particle.pos.y += particle.vel.y * deltaTime;
      particle.rotation += particle.spin * deltaTime;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);

    for (const explosion of this.explosions) {
      explosion.life -= deltaTime;
    }
    this.explosions = this.explosions.filter((explosion) => explosion.life > 0);

    if (this.impactFlash) {
      this.impactFlash.life -= deltaTime;
      if (this.impactFlash.life <= 0) {
        this.impactFlash = null;
      }
    }

    this.camera.shakeTime = Math.max(0, this.camera.shakeTime - deltaTime);
  }

  private updateCamera(deltaTime: number): void {
    const pixelsPerMeter = GameConfig.pixelsPerMeter;
    const playerScreenX =
      GameConfig.worldAnchorScreenX +
      (this.player.pos.x - this.camera.x) * pixelsPerMeter;
    if (playerScreenX > GameConfig.followScreenX) {
      const desiredCameraX =
        this.player.pos.x +
        (GameConfig.worldAnchorScreenX - GameConfig.followScreenX) /
          pixelsPerMeter;
      const followRate = GameConfig.camera.followRate;
      // Feed the horizontal velocity into the target. A plain smooth interpolation
      // always trails a moving target, pushing the player right of the intended
      // anchor; this term cancels that steady-state lag while keeping the onset soft.
      const velocityCompensatedTarget =
        desiredCameraX + this.player.vel.x / followRate;
      const smoothing = 1 - Math.exp(-followRate * deltaTime);
      const nextCameraX = lerp(
        this.camera.x,
        velocityCompensatedTarget,
        smoothing,
      );
      this.camera.x = Math.max(this.camera.x, nextCameraX);
    }

    if (this.powerUp.mode !== "normal") {
      this.verticalTrackingActive = true;
    }
    if (!this.verticalTrackingActive) return;

    const desiredCameraY = Math.min(
      0,
      this.player.pos.y +
        (GameConfig.groundScreenY -
          GameConfig.camera.verticalFollowScreenY) /
          pixelsPerMeter,
    );
    const verticalRate = GameConfig.camera.verticalFollowRate;
    const velocityCompensatedTarget = Math.min(
      0,
      desiredCameraY + this.player.vel.y / verticalRate,
    );
    const verticalSmoothing = 1 - Math.exp(-verticalRate * deltaTime);
    this.camera.y = Math.min(
      0,
      lerp(this.camera.y, velocityCompensatedTarget, verticalSmoothing),
    );

    if (
      this.powerUp.mode === "normal" &&
      desiredCameraY === 0 &&
      Math.abs(this.camera.y) < 0.05
    ) {
      this.camera.y = 0;
      this.verticalTrackingActive = false;
    }
  }

  private getShakeOffset(): Vec2 {
    if (this.camera.shakeTime <= 0) return { x: 0, y: 0 };
    const strength =
      this.camera.shakeStrength *
      (this.camera.shakeTime / GameConfig.camera.shakeDuration);
    return {
      x: randomBetween(this.random, -strength, strength),
      y: randomBetween(this.random, -strength, strength),
    };
  }

  private drawSky(context: CanvasRenderingContext2D): void {
    if (this.backgroundSprites) {
      const { farAtlas } = this.backgroundSprites;
      drawAtlasPose(
        context,
        farAtlas,
        BackgroundPoses.sun,
        GameConfig.background.sunScreen,
      );

      const {
        cloudCycleWidth,
        cloudParallaxes,
        cloudScreens,
      } = GameConfig.background;
      for (let index = 0; index < BackgroundPoses.clouds.length; index += 1) {
        const pose = BackgroundPoses.clouds[index];
        const base = cloudScreens[index];
        const scroll =
          this.camera.x *
          GameConfig.pixelsPerMeter *
          cloudParallaxes[index];
        const halfWidth = (pose.frame.width * pose.scale) / 2;
        const x =
          wrap(base.x - scroll + halfWidth, cloudCycleWidth) - halfWidth;
        if (
          x < -halfWidth ||
          x > GameConfig.logicalWidth + halfWidth
        ) {
          continue;
        }
        drawAtlasPose(context, farAtlas, pose, { x, y: base.y });
      }
      return;
    }

    this.drawSkyFallback(context);
  }

  private drawSkyFallback(context: CanvasRenderingContext2D): void {
    context.fillStyle = GameConfig.palette.sun;
    context.beginPath();
    context.arc(GameConfig.logicalWidth - 180, 155, 58, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = `${GameConfig.palette.cloud}cc`;
    this.drawCloudFallback(
      context,
      GameConfig.logicalWidth - 410 - this.camera.x * 0.32,
      170,
      1,
    );
    this.drawCloudFallback(
      context,
      GameConfig.logicalWidth - 1090 - this.camera.x * 0.2,
      290,
      0.72,
    );
  }

  private drawMidground(context: CanvasRenderingContext2D): void {
    if (!this.backgroundSprites) return;

    const { logicalWidth, pixelsPerMeter } = GameConfig;
    const {
      midgroundBottomScreenY,
      midgroundParallax,
      midgroundScale,
      midgroundVerticalParallax,
    } = GameConfig.background;
    const image = this.backgroundSprites.midground;
    const tileWidth = image.width * midgroundScale;
    const tileHeight = image.height * midgroundScale;
    const cycleWidth = tileWidth * 2;
    const scroll = wrap(
      this.camera.x * pixelsPerMeter * midgroundParallax,
      cycleWidth,
    );
    let tileIndex = Math.floor(scroll / tileWidth);
    let x = -(scroll - tileIndex * tileWidth);
    const y =
      midgroundBottomScreenY -
      tileHeight -
      this.camera.y * pixelsPerMeter * midgroundVerticalParallax;

    while (x < logicalWidth) {
      if (tileIndex % 2 === 0) {
        context.drawImage(image, x, y, tileWidth, tileHeight);
      } else {
        context.save();
        context.translate(x + tileWidth, y);
        context.scale(-1, 1);
        context.drawImage(image, 0, 0, tileWidth, tileHeight);
        context.restore();
      }
      x += tileWidth;
      tileIndex += 1;
    }
  }

  private drawCloudFallback(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
  ): void {
    const wrappedX = ((x + 260) % 1860 + 1860) % 1860 - 260;
    context.save();
    context.translate(wrappedX, y);
    context.scale(-scale, scale);
    context.beginPath();
    context.arc(0, 0, 34, Math.PI, 0);
    context.arc(52, -18, 52, Math.PI, 0);
    context.arc(112, 0, 38, Math.PI, 0);
    context.lineTo(112, 24);
    context.lineTo(0, 24);
    context.closePath();
    context.fill();
    context.restore();
  }

  private drawWorld(context: CanvasRenderingContext2D): void {
    this.drawGround(context);
    this.drawDistanceSigns(context);
    this.drawMines(context);
    this.drawJetTrails(context);
    this.drawUfoTractorBeam(context);
    this.drawPickups(context);
    if (this.launcherId === "blackEagle") {
      this.drawHitterAndClub(context);
    } else if (this.launcherId === "slingshot") {
      this.drawSlingshotScene(context);
    } else if (this.launcherId === "humanCannon") {
      this.drawHumanCannonScene(context);
    } else if (this.launcherId === "missileTruck") {
      this.drawMissileTruckScene(context);
    }
    this.drawEffects(context);
    this.drawMissileTailFlame(context);
    const playerIsLoaded =
      (this.launcherId === "slingshot" ||
        this.launcherId === "humanCannon" ||
        this.launcherId === "missileTruck") &&
      this.phase === "ready";
    if (!playerIsLoaded) {
      this.drawPlayer(context);
    }
    this.drawImpactFlash(context);
  }

  private ufoBeamGeometry(): UfoBeamGeometry | null {
    if (this.powerUp.mode !== "ufo") return null;

    const emitter = this.worldToScreen(this.ufoEmitterWorldPosition());
    const groundY = this.worldToScreenY(0);
    // Let the beam tuck underneath the emitter so the foreground UFO masks the
    // seam. This keeps the two shapes connected even while the camera moves.
    const topY = emitter.y - 2;
    const beamHeight = groundY - topY;
    if (beamHeight <= 0) return null;

    const topWidth =
      GameConfig.powerUp.ufo.beamTopWidth * GameConfig.pixelsPerMeter;
    return {
      centerX: emitter.x,
      topY,
      groundY,
      topWidth,
      groundWidth:
        topWidth +
        Math.tan(GameConfig.powerUp.ufo.beamSpreadAngle) * beamHeight * 2,
      topCapHeight:
        GameConfig.powerUp.ufo.beamTopCapHeight * GameConfig.pixelsPerMeter,
      groundCapHeight:
        GameConfig.powerUp.ufo.beamGroundCapHeight * GameConfig.pixelsPerMeter,
    };
  }

  private drawUfoTractorBeam(context: CanvasRenderingContext2D): void {
    const beam = this.ufoBeamGeometry();
    if (!beam) return;

    const {
      centerX,
      topY,
      groundY,
      topWidth,
      groundWidth,
      topCapHeight,
      groundCapHeight,
    } = beam;
    context.save();

    // Semi-transparent, flat color blocks follow the approved concept while
    // the geometry stretches to the actual ground instead of a fixed height.
    context.fillStyle = "rgb(226 248 255 / 24%)";
    context.beginPath();
    context.moveTo(centerX - topWidth / 2, topY);
    context.lineTo(centerX - groundWidth / 2, groundY);
    context.lineTo(centerX + groundWidth / 2, groundY);
    context.lineTo(centerX + topWidth / 2, topY);
    context.closePath();
    context.fill();

    const coreTopWidth = topWidth * 0.32;
    const coreGroundWidth = topWidth * 0.68;
    context.fillStyle = "rgb(91 229 247 / 20%)";
    context.beginPath();
    context.moveTo(centerX - coreTopWidth / 2, topY);
    context.lineTo(centerX - coreGroundWidth / 2, groundY);
    context.lineTo(centerX + coreGroundWidth / 2, groundY);
    context.lineTo(centerX + coreTopWidth / 2, topY);
    context.closePath();
    context.fill();

    context.fillStyle = "rgb(199 248 255 / 38%)";
    context.beginPath();
    context.ellipse(
      centerX,
      topY,
      topWidth / 2,
      topCapHeight / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();

    context.fillStyle = "rgb(218 249 249 / 28%)";
    context.beginPath();
    context.ellipse(
      centerX,
      groundY,
      groundWidth / 2,
      groundCapHeight / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
  }

  private ufoLightsOn(): boolean {
    if (this.powerUp.mode !== "ufo") return false;
    const elapsed =
      GameConfig.powerUp.ufo.duration - this.powerUp.remainingDuration;
    return (
      Math.floor(elapsed / GameConfig.powerUp.ufo.lightBlinkInterval) % 2 ===
      0
    );
  }

  private drawHumanCannonScene(context: CanvasRenderingContext2D): void {
    const {
      launchAngle,
      loadedAnchor,
      emptyAnchor,
      recoilDistance,
      recoilDuration,
      spriteScale,
      wheelWorld,
    } = GameConfig.humanCannon;
    const wheel = this.worldToScreen(wheelWorld);
    let recoilOffset: Vec2 = { x: 0, y: 0 };

    if (
      this.humanCannon.state === "fired" &&
      this.humanCannon.elapsed < recoilDuration
    ) {
      const progress = clamp(
        this.humanCannon.elapsed / recoilDuration,
        0,
        1,
      );
      const amount =
        Math.sin(progress * Math.PI) *
        (1 - progress * 0.35) *
        recoilDistance;
      recoilOffset = {
        x: -Math.cos(launchAngle) * amount,
        y: Math.sin(launchAngle) * amount,
      };
    }

    context.save();
    context.translate(wheel.x + recoilOffset.x, wheel.y + recoilOffset.y);
    if (this.humanCannonSprites) {
      const loaded = this.phase === "ready";
      const image = loaded
        ? this.humanCannonSprites.loaded
        : this.humanCannonSprites.empty;
      const anchor = loaded ? loadedAnchor : emptyAnchor;
      context.drawImage(
        image,
        -anchor.x * spriteScale,
        -anchor.y * spriteScale,
        image.width * spriteScale,
        image.height * spriteScale,
      );
    } else {
      this.drawHumanCannonFallback(context);
    }
    context.restore();

    if (this.phase === "ready" && this.humanCannon.state === "lit") {
      this.drawHumanCannonFuse(context);
      this.drawHumanCannonPowerBar(context);
    }

    if (this.humanCannon.state === "fired") {
      this.drawHumanCannonSmoke(context, recoilOffset);
    }
  }

  private drawMissileTruckScene(context: CanvasRenderingContext2D): void {
    const {
      emptyAnchor,
      emptyScale,
      groundWorld,
      loadedAnchor,
      loadedScale,
      loadedWorld,
      rackAngle,
    } = GameConfig.missileTruck;
    const ground = this.worldToScreen(groundWorld);

    if (this.missileTruckSprites) {
      const loaded = this.phase === "ready";
      const image = loaded
        ? this.missileTruckSprites.loaded
        : this.missileTruckSprites.empty;
      const anchor = loaded ? loadedAnchor : emptyAnchor;
      const scale = loaded ? loadedScale : emptyScale;
      context.drawImage(
        image,
        ground.x - anchor.x * scale,
        ground.y - anchor.y * scale,
        image.width * scale,
        image.height * scale,
      );
      return;
    }

    this.drawMissileTruckFallback(context, ground);
    if (this.phase !== "ready") return;

    const loaded = this.worldToScreen(loadedWorld);
    if (this.sprites) {
      drawSpritePose(context, this.sprites, FlyerPoses.airborne, loaded, {
        rotation: -rackAngle,
        flipX: true,
      });
      return;
    }

    context.save();
    context.translate(loaded.x, loaded.y);
    context.rotate(-rackAngle);
    this.drawOriginalPlayer(
      context,
      { x: 0, y: 0 },
      this.player.width *
        GameConfig.pixelsPerMeter *
        GameConfig.visualScale *
        GameConfig.player.poseVisualScale,
      this.player.height *
        GameConfig.pixelsPerMeter *
        GameConfig.visualScale *
        GameConfig.player.poseVisualScale,
    );
    context.restore();
  }

  private drawMissileTruckFallback(
    context: CanvasRenderingContext2D,
    ground: Vec2,
  ): void {
    const visualScale =
      GameConfig.visualScale * GameConfig.missileTruck.visualScale;
    context.save();
    context.translate(ground.x, ground.y);
    context.fillStyle = "#7f8b32";
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 7 * visualScale;
    context.lineJoin = "round";
    context.fillRect(-48 * visualScale, -78 * visualScale, 250 * visualScale, 62 * visualScale);
    context.strokeRect(-48 * visualScale, -78 * visualScale, 250 * visualScale, 62 * visualScale);
    context.save();
    context.translate(-20 * visualScale, -82 * visualScale);
    context.rotate(-GameConfig.missileTruck.launchAngle);
    context.fillRect(0, -16 * visualScale, 180 * visualScale, 32 * visualScale);
    context.strokeRect(0, -16 * visualScale, 180 * visualScale, 32 * visualScale);
    context.restore();
    for (const x of [-18 * visualScale, 58 * visualScale, 138 * visualScale]) {
      context.fillStyle = "#303744";
      context.beginPath();
      context.arc(x, -30 * visualScale, 30 * visualScale, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  private drawHumanCannonFallback(
    context: CanvasRenderingContext2D,
  ): void {
    const { launchAngle } = GameConfig.humanCannon;
    const visualScale = GameConfig.visualScale;
    context.save();
    context.rotate(-launchAngle);
    context.fillStyle = "#555c68";
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 10 * visualScale;
    context.beginPath();
    context.roundRect(
      -148 * visualScale,
      -70 * visualScale,
      300 * visualScale,
      82 * visualScale,
      28 * visualScale,
    );
    context.fill();
    context.stroke();
    context.fillStyle = "#7b8490";
    context.beginPath();
    context.roundRect(
      130 * visualScale,
      -82 * visualScale,
      38 * visualScale,
      106 * visualScale,
      16 * visualScale,
    );
    context.fill();
    context.stroke();
    context.restore();

    context.fillStyle = "#f4a63f";
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 10 * visualScale;
    context.beginPath();
    context.arc(0, 0, 92 * visualScale, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "#555c68";
    context.beginPath();
    context.arc(0, 0, 20 * visualScale, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  private drawHumanCannonFuse(
    context: CanvasRenderingContext2D,
  ): void {
    const frames = this.effectSprites?.humanCannonFuseFlames;
    if (!frames) return;

    const {
      fuseFlameAnchor,
      fuseFlameFrameDuration,
      fuseFlameOffset,
      fuseFlameSize,
      fuseWorld,
    } = GameConfig.humanCannon;
    const fuseTip = this.worldToScreen(fuseWorld);
    const frameIndex =
      Math.floor(this.humanCannon.elapsed / fuseFlameFrameDuration) %
      frames.length;
    const image = frames[frameIndex];
    const scale = fuseFlameSize / image.width;

    context.drawImage(
      image,
      fuseTip.x + fuseFlameOffset.x - fuseFlameAnchor.x * scale,
      fuseTip.y + fuseFlameOffset.y - fuseFlameAnchor.y * scale,
      image.width * scale,
      image.height * scale,
    );
  }

  private drawHumanCannonPowerBar(
    context: CanvasRenderingContext2D,
  ): void {
    const {
      powerBarHeight,
      powerBarWidth,
      powerBarWorld,
    } = GameConfig.humanCannon;
    const visualScale = GameConfig.visualScale;
    const wheel = this.worldToScreen(GameConfig.humanCannon.wheelWorld);
    const powerBar = this.worldToScreen(powerBarWorld);
    const screen = {
      x: wheel.x + (powerBar.x - wheel.x) * visualScale,
      y: wheel.y + (powerBar.y - wheel.y) * visualScale,
    };
    const power = this.humanCannonPower();
    const inset = 10 * visualScale;
    const indicatorX =
      -powerBarWidth / 2 + inset + power * (powerBarWidth - inset * 2);

    context.save();
    context.translate(screen.x, screen.y);
    const gradient = context.createLinearGradient(
      -powerBarWidth / 2,
      0,
      powerBarWidth / 2,
      0,
    );
    gradient.addColorStop(0, "#e3343f");
    gradient.addColorStop(0.52, "#ffd447");
    gradient.addColorStop(1, "#35b86b");
    context.fillStyle = gradient;
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 6 * visualScale;
    context.beginPath();
    context.roundRect(
      -powerBarWidth / 2,
      -powerBarHeight / 2,
      powerBarWidth,
      powerBarHeight,
      13 * visualScale,
    );
    context.fill();
    context.stroke();

    context.fillStyle = "#fffdf5";
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 5 * visualScale;
    context.beginPath();
    context.roundRect(
      indicatorX - 7 * visualScale,
      -powerBarHeight / 2 - 8 * visualScale,
      14 * visualScale,
      powerBarHeight + 16 * visualScale,
      6 * visualScale,
    );
    context.fill();
    context.stroke();
    context.restore();
  }

  private drawHumanCannonSmoke(
    context: CanvasRenderingContext2D,
    recoilOffset: Vec2,
  ): void {
    const smoke = this.effectSprites?.humanCannonSmoke;
    if (!smoke) return;

    const {
      launchAngle,
      muzzleWorld,
      smokeAnchor,
      smokeDuration,
      smokeEndWidth,
      smokeStartWidth,
      smokeTravelDistance,
    } = GameConfig.humanCannon;
    if (this.humanCannon.elapsed >= smokeDuration) return;
    const progress = clamp(
      this.humanCannon.elapsed / smokeDuration,
      0,
      1,
    );
    const easedProgress = 1 - (1 - progress) ** 3;
    const muzzle = this.worldToScreen(muzzleWorld);
    const forward = { x: Math.cos(launchAngle), y: -Math.sin(launchAngle) };
    const travel = smokeTravelDistance * easedProgress;
    const drawWidth =
      smokeStartWidth + (smokeEndWidth - smokeStartWidth) * easedProgress;
    const scale = drawWidth / smoke.width;

    context.save();
    context.translate(
      muzzle.x + recoilOffset.x + forward.x * travel,
      muzzle.y + recoilOffset.y + forward.y * travel,
    );
    context.rotate(-launchAngle);
    context.globalAlpha = 1 - progress;
    context.drawImage(
      smoke,
      -smokeAnchor.x * scale,
      -smokeAnchor.y * scale,
      smoke.width * scale,
      smoke.height * scale,
    );
    context.restore();
  }

  private drawSlingshotScene(context: CanvasRenderingContext2D): void {
    const pouch = this.slingshotPouchScreen();
    const seated = this.slingshotSeatedScreen(pouch);
    const visualScale = GameConfig.visualScale;
    const frameBase = this.worldToScreen({
      x: GameConfig.slingshot.forkWorldX,
      y: 0,
    });
    const backTipBase = this.worldToScreen(
      GameConfig.slingshot.backTipWorld,
    );
    const frontTipBase = this.worldToScreen(
      GameConfig.slingshot.frontTipWorld,
    );
    const backTip = {
      x: frameBase.x + (backTipBase.x - frameBase.x) * visualScale,
      y: frameBase.y + (backTipBase.y - frameBase.y) * visualScale,
    };
    const frontTip = {
      x: frameBase.x + (frontTipBase.x - frameBase.x) * visualScale,
      y: frameBase.y + (frontTipBase.y - frameBase.y) * visualScale,
    };
    const tension = clamp(
      Math.hypot(this.slingshot.offset.x, this.slingshot.offset.y) /
        GameConfig.slingshot.maximumPull,
      0,
      1,
    );
    const { pouchWidth, pouchHeight } = GameConfig.slingshot;
    const backBandStart = {
      x: backTip.x - 15 * visualScale,
      y: backTip.y + 3 * visualScale,
    };
    const frontBandStart = {
      x: frontTip.x - 15 * visualScale,
      y: frontTip.y - 3 * visualScale,
    };
    const pouchAttachX = pouch.x + pouchWidth * 0.38;

    this.drawSlingshotFrame(context);
    this.drawSlingshotBand(
      context,
      backBandStart,
      { x: pouchAttachX, y: pouch.y + pouchHeight * 0.2 },
      tension,
    );
    this.drawSlingshotKnot(context, backTip, backBandStart, false);

    if (this.phase === "ready") {
      this.drawSlingshotSeatedFlyer(context, seated);
    }

    this.drawSlingshotPouch(context, pouch);
    this.drawSlingshotBand(
      context,
      frontBandStart,
      { x: pouchAttachX, y: pouch.y - pouchHeight * 0.2 },
      tension,
    );
    this.drawSlingshotKnot(context, frontTip, frontBandStart, true);
  }

  private drawSlingshotFrame(context: CanvasRenderingContext2D): void {
    const base = this.worldToScreen({
      x: GameConfig.slingshot.forkWorldX,
      y: 0,
    });
    const size = GameConfig.slingshot.frameSize;

    if (!this.slingshotSprites) {
      const visualScale = GameConfig.visualScale;
      const backTip = this.worldToScreen(GameConfig.slingshot.backTipWorld);
      const frontTip = this.worldToScreen(GameConfig.slingshot.frontTipWorld);
      const scaledBackTip = {
        x: base.x + (backTip.x - base.x) * visualScale,
        y: base.y + (backTip.y - base.y) * visualScale,
      };
      const scaledFrontTip = {
        x: base.x + (frontTip.x - base.x) * visualScale,
        y: base.y + (frontTip.y - base.y) * visualScale,
      };
      context.strokeStyle = "#142033";
      context.lineWidth = 42 * visualScale;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(base.x, base.y);
      context.lineTo(base.x, base.y - size * 0.4);
      context.lineTo(scaledBackTip.x, scaledBackTip.y);
      context.moveTo(base.x, base.y - size * 0.4);
      context.lineTo(scaledFrontTip.x, scaledFrontTip.y);
      context.stroke();
      context.strokeStyle = "#f4a63f";
      context.lineWidth = 30 * visualScale;
      context.stroke();
      return;
    }

    const image = this.slingshotSprites.frame;
    const left = base.x - size / 2;
    const top = base.y - size + size * 0.042;
    const splitRatio = GameConfig.slingshot.frameTopSliceRatio;
    const overlapRatio = 0.025;
    const bottomSourceY = Math.floor(
      image.height * (splitRatio - overlapRatio),
    );
    const topSourceHeight = Math.ceil(
      image.height * (splitRatio + overlapRatio),
    );
    const bottomDestinationY = size * (splitRatio - overlapRatio);
    const topDestinationHeight = size * (splitRatio + overlapRatio);

    context.drawImage(
      image,
      0,
      bottomSourceY,
      image.width,
      image.height - bottomSourceY,
      left,
      top + bottomDestinationY,
      size,
      size - bottomDestinationY,
    );
    context.drawImage(
      image,
      0,
      0,
      image.width,
      topSourceHeight,
      left,
      top,
      size,
      topDestinationHeight,
    );
  }

  private drawSlingshotBand(
    context: CanvasRenderingContext2D,
    start: Vec2,
    end: Vec2,
    tension: number,
  ): void {
    const visualScale = GameConfig.visualScale;
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2 + (1 - tension) * 18 * visualScale,
    };
    const red = Math.round(143 + (239 - 143) * tension);
    const green = Math.round(29 + (51 - 29) * tension);
    const blue = Math.round(44 + (64 - 44) * tension);

    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = (14 - tension * 2) * visualScale;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.quadraticCurveTo(midpoint.x, midpoint.y, end.x, end.y);
    context.stroke();

    context.strokeStyle = `rgb(${red} ${green} ${blue})`;
    context.lineWidth = (8 - tension * 1.5) * visualScale;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.quadraticCurveTo(midpoint.x, midpoint.y, end.x, end.y);
    context.stroke();
  }

  private drawSlingshotKnot(
    context: CanvasRenderingContext2D,
    connection: Vec2,
    bandExit: Vec2,
    front: boolean,
  ): void {
    const visualScale = GameConfig.visualScale;
    context.save();
    context.translate(connection.x, connection.y);
    context.rotate(front ? -0.04 : 0.04);
    context.fillStyle = "#c52f3e";
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 4 * visualScale;
    context.lineJoin = "round";

    context.beginPath();
    context.roundRect(
      -13 * visualScale,
      -8 * visualScale,
      26 * visualScale,
      16 * visualScale,
      7 * visualScale,
    );
    context.fill();
    context.stroke();

    const localExit = {
      x: bandExit.x - connection.x,
      y: bandExit.y - connection.y,
    };
    context.beginPath();
    context.moveTo(-7 * visualScale, -6 * visualScale);
    context.bezierCurveTo(
      localExit.x - 5 * visualScale,
      localExit.y - 6 * visualScale,
      localExit.x - 8 * visualScale,
      localExit.y + 1 * visualScale,
      localExit.x - 3 * visualScale,
      localExit.y + 5 * visualScale,
    );
    context.bezierCurveTo(
      -13 * visualScale,
      10 * visualScale,
      -7 * visualScale,
      5 * visualScale,
      -4 * visualScale,
      2 * visualScale,
    );
    context.closePath();
    context.fill();
    context.stroke();

    context.strokeStyle = "#f35a64";
    context.lineWidth = 2.5 * visualScale;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(-8 * visualScale, -3 * visualScale);
    context.lineTo(8 * visualScale, -3 * visualScale);
    context.moveTo(-7 * visualScale, 3 * visualScale);
    context.lineTo(7 * visualScale, 3 * visualScale);
    context.stroke();
    context.restore();
  }

  private drawSlingshotSeatedFlyer(
    context: CanvasRenderingContext2D,
    seated: Vec2,
  ): void {
    const tilt = clamp(
      this.slingshot.offset.y / GameConfig.slingshot.maximumPull,
      -1,
      1,
    ) * GameConfig.slingshot.maximumSeatedTilt;
    const size = GameConfig.slingshot.seatedSize;

    context.save();
    context.translate(seated.x, seated.y);
    context.rotate(tilt);
    if (this.slingshotSprites) {
      context.drawImage(
        this.slingshotSprites.seatedFlyer,
        -size / 2,
        -size / 2,
        size,
        size,
      );
    } else {
      const visualScale = GameConfig.visualScale;
      context.fillStyle = "#17191f";
      context.strokeStyle = GameConfig.palette.ink;
      context.lineWidth = 5 * visualScale;
      context.beginPath();
      context.arc(0, -46 * visualScale, 22 * visualScale, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillRect(
        -22 * visualScale,
        -24 * visualScale,
        44 * visualScale,
        58 * visualScale,
      );
      context.fillStyle = "#fffdf5";
      context.fillRect(
        -2 * visualScale,
        24 * visualScale,
        56 * visualScale,
        22 * visualScale,
      );
    }
    context.restore();
  }

  private drawSlingshotPouch(
    context: CanvasRenderingContext2D,
    pouch: Vec2,
  ): void {
    const { pouchWidth, pouchHeight, maximumPull } = GameConfig.slingshot;
    const visualScale = GameConfig.visualScale;
    const rotation =
      clamp(this.slingshot.offset.y / maximumPull, -1, 1) * 0.12;
    context.save();
    context.translate(pouch.x, pouch.y);
    context.rotate(rotation);
    context.fillStyle = "#5b321f";
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 5 * visualScale;
    context.beginPath();
    context.roundRect(
      -pouchWidth / 2,
      -pouchHeight / 2,
      pouchWidth,
      pouchHeight,
      13,
    );
    context.fill();

    context.save();
    context.clip();
    context.strokeStyle = "#9a6440";
    context.lineWidth = 2.5 * visualScale;
    for (let x = -pouchWidth; x <= pouchWidth; x += 16 * visualScale) {
      context.beginPath();
      context.moveTo(x, -pouchHeight / 2);
      context.lineTo(x + pouchHeight, pouchHeight / 2);
      context.stroke();
      context.beginPath();
      context.moveTo(x, pouchHeight / 2);
      context.lineTo(x + pouchHeight, -pouchHeight / 2);
      context.stroke();
    }
    context.restore();

    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 5 * visualScale;
    context.beginPath();
    context.roundRect(
      -pouchWidth / 2,
      -pouchHeight / 2,
      pouchWidth,
      pouchHeight,
      13,
    );
    context.stroke();
    context.fillStyle = "#2f1d19";
    context.beginPath();
    context.ellipse(
      0,
      -pouchHeight * 0.3,
      pouchWidth * 0.34,
      5 * visualScale,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
  }

  private drawGround(context: CanvasRenderingContext2D): void {
    if (this.backgroundSprites) {
      const { logicalHeight, logicalWidth } = GameConfig;
      const {
        groundSourceTop,
        groundSurfaceY,
        groundTileScale,
      } = GameConfig.background;
      const image = this.backgroundSprites.groundTile;
      const groundScreenY = this.worldToScreenY(0);
      if (groundScreenY >= logicalHeight) return;

      const sourceHeight = image.height - groundSourceTop;
      const tileWidth = image.width * groundTileScale;
      const tileHeight = sourceHeight * groundTileScale;
      const drawY =
        groundScreenY -
        (groundSurfaceY - groundSourceTop) * groundTileScale;
      const scroll = wrap(
        this.camera.x * GameConfig.pixelsPerMeter,
        tileWidth,
      );

      for (
        let x = -scroll;
        x < logicalWidth;
        x += tileWidth
      ) {
        context.drawImage(
          image,
          0,
          groundSourceTop,
          image.width,
          sourceHeight,
          x,
          drawY,
          tileWidth + 1,
          tileHeight,
        );
      }
      return;
    }

    this.drawGroundFallback(context);
  }

  private drawGroundFallback(context: CanvasRenderingContext2D): void {
    const { logicalWidth, logicalHeight, palette } = GameConfig;
    const groundScreenY = this.worldToScreenY(0);
    if (groundScreenY >= logicalHeight) return;
    context.fillStyle = palette.ground;
    context.fillRect(
      0,
      Math.max(0, groundScreenY),
      logicalWidth,
      logicalHeight - Math.max(0, groundScreenY),
    );
    context.fillStyle = palette.groundTop;
    context.fillRect(0, groundScreenY, logicalWidth, 12);
    context.fillStyle = palette.groundDark;
    context.fillRect(0, groundScreenY + 62, logicalWidth, 9);

    const leftWorld = this.screenToWorldX(0);
    const rightWorld = this.screenToWorldX(logicalWidth);
    const firstTick = Math.floor(leftWorld / 20) * 20;
    context.fillStyle = `${palette.ink}20`;
    for (let worldX = firstTick; worldX <= rightWorld; worldX += 20) {
      const screenX = this.worldToScreenX(worldX);
      context.fillRect(screenX - 16, groundScreenY + 31, 32, 5);
    }
  }

  private drawDistanceSigns(context: CanvasRenderingContext2D): void {
    const leftWorld = this.screenToWorldX(-100);
    const rightWorld = this.screenToWorldX(GameConfig.logicalWidth + 100);
    const minimumDistance = Math.max(100, leftWorld);
    const maximumDistance = Math.max(0, rightWorld);
    const first =
      Math.ceil(minimumDistance / GameConfig.signs.interval) *
      GameConfig.signs.interval;

    for (
      let distance = first;
      distance <= maximumDistance;
      distance += GameConfig.signs.interval
    ) {
      const x = this.worldToScreenX(distance);
      const groundY = this.worldToScreenY(0);
      context.fillStyle = GameConfig.palette.ink;
      context.fillRect(x - 5, groundY - 72, 10, 72);
      context.fillStyle = GameConfig.palette.sign;
      context.strokeStyle = GameConfig.palette.ink;
      context.lineWidth = 4;
      context.fillRect(x - 46, groundY - 110, 92, 44);
      context.strokeRect(x - 46, groundY - 110, 92, 44);
      context.fillStyle = GameConfig.palette.ink;
      context.font = "900 21px Inter, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(`${distance}m`, x, groundY - 88);
    }
  }

  private drawMines(context: CanvasRenderingContext2D): void {
    for (const mine of this.mines) {
      if (mine.exploded) continue;
      const x = this.worldToScreenX(mine.pos.x);
      if (x < -60 || x > GameConfig.logicalWidth + 60) continue;
      const groundY = this.worldToScreenY(0);

      if (this.sprites) {
        const outlineWidth = GameConfig.mine.spriteOutlineWidth;
        drawOutlinedSpritePose(
          context,
          this.sprites,
          MinePose,
          { x, y: groundY - outlineWidth },
          { color: GameConfig.palette.ink, width: outlineWidth },
        );
        continue;
      }

      const width = GameConfig.mine.width * GameConfig.pixelsPerMeter;
      const height = GameConfig.mine.height * GameConfig.pixelsPerMeter;

      context.fillStyle = GameConfig.palette.mineDark;
      for (let spike = -1; spike <= 1; spike += 1) {
        const spikeX = x + spike * width * 0.23;
        context.beginPath();
        context.moveTo(spikeX - 6, groundY - height * 0.72);
        context.lineTo(spikeX, groundY - height - 10 - Math.abs(spike) * 3);
        context.lineTo(spikeX + 6, groundY - height * 0.72);
        context.closePath();
        context.fill();
      }

      context.fillStyle = GameConfig.palette.mine;
      context.beginPath();
      context.ellipse(
        x,
        groundY,
        width / 2,
        height,
        0,
        Math.PI,
        Math.PI * 2,
      );
      context.fill();
      context.strokeStyle = GameConfig.palette.mineDark;
      context.lineWidth = 4 + GameConfig.mine.spriteOutlineWidth;
      context.stroke();
    }
  }

  private drawPickups(context: CanvasRenderingContext2D): void {
    for (const pickup of this.pickups) {
      if (pickup.status === "collected") continue;
      const screen = this.worldToScreen(pickup.pos);
      if (
        screen.x < -120 ||
        screen.x > GameConfig.logicalWidth + 120 ||
        screen.y < -120 ||
        screen.y > GameConfig.logicalHeight + 120
      ) {
        continue;
      }
      const pickupConfig = this.getPickupConfig(pickup.type);
      const width = pickupConfig.width * GameConfig.pixelsPerMeter;
      const height = pickupConfig.height * GameConfig.pixelsPerMeter;
      const idle = pickup.status === "available";
      const floatY = idle
        ? Math.sin(
            this.elapsedTime * Math.PI * 2 * GameConfig.pickup.floatFrequency +
              pickup.id * 2.399963,
          ) * GameConfig.pickup.floatAmplitude
        : 0;
      const drawScreen = { x: screen.x, y: screen.y + floatY };
      context.save();
      switch (pickup.type) {
        case "redPacket":
          this.drawRedPacketIcon(context, drawScreen, width, height);
          break;
        case "skyLantern":
          this.drawSkyLanternIcon(context, drawScreen, width, height);
          break;
        case "sixthGenJet":
          this.drawJetIcon(context, drawScreen, width, height);
          break;
        case "ufo":
          if (this.sprites) {
            drawSpritePose(context, this.sprites, PickupPoses.ufo, drawScreen);
          } else {
            this.drawUfoIcon(context, drawScreen, width, height, false);
          }
          break;
      }
      context.restore();
    }
  }

  private drawRedPacketIcon(
    context: CanvasRenderingContext2D,
    screen: Vec2,
    width: number,
    height: number,
  ): void {
    context.save();
    context.translate(screen.x, screen.y);
    context.lineJoin = "round";
    context.fillStyle = GameConfig.palette.redPacket;
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect(-width / 2, -height / 2, width, height, 6);
    context.fill();
    context.stroke();

    context.fillStyle = GameConfig.palette.redPacketDark;
    context.beginPath();
    context.moveTo(-width / 2 + 2, -height / 2 + 2);
    context.lineTo(0, height * 0.06);
    context.lineTo(width / 2 - 2, -height / 2 + 2);
    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = GameConfig.palette.gold;
    context.beginPath();
    context.arc(0, height * 0.08, height * 0.15, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }

  private drawSkyLanternIcon(
    context: CanvasRenderingContext2D,
    screen: Vec2,
    width: number,
    height: number,
  ): void {
    context.save();
    context.translate(screen.x, screen.y);
    context.lineJoin = "round";

    this.traceSkyLantern(context, width, height);
    context.save();
    context.clip();
    context.fillStyle = GameConfig.palette.lanternOrange;
    context.fillRect(-width / 2, -height / 2, width, height);
    context.fillStyle = GameConfig.palette.lanternYellow;
    context.fillRect(-width / 2, -height * 0.02, width, height * 0.52);
    context.restore();

    this.traceSkyLantern(context, width, height);
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 4;
    context.stroke();

    context.beginPath();
    context.moveTo(0, -height / 2 + 3);
    context.lineTo(0, height * 0.4);
    context.stroke();

    const baseWidth = width * 0.62;
    const baseHeight = Math.max(7, height * 0.12);
    context.fillStyle = GameConfig.palette.redPacket;
    context.beginPath();
    context.roundRect(
      -baseWidth / 2,
      height * 0.38,
      baseWidth,
      baseHeight,
      baseHeight / 2,
    );
    context.fill();
    context.stroke();
    context.restore();
  }

  private traceSkyLantern(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    context.beginPath();
    context.moveTo(0, -height / 2);
    context.lineTo(width * 0.32, -height * 0.43);
    context.lineTo(width * 0.46, -height * 0.27);
    context.lineTo(width * 0.43, height * 0.08);
    context.lineTo(width * 0.27, height * 0.42);
    context.lineTo(-width * 0.27, height * 0.42);
    context.lineTo(-width * 0.43, height * 0.08);
    context.lineTo(-width * 0.46, -height * 0.27);
    context.lineTo(-width * 0.32, -height * 0.43);
    context.closePath();
  }

  private drawJetIcon(
    context: CanvasRenderingContext2D,
    screen: Vec2,
    width: number,
    height: number,
  ): void {
    context.save();
    context.translate(screen.x, screen.y);
    context.scale(-1, 1);
    context.lineJoin = "round";
    this.traceJet(context, width, height);
    context.fillStyle = GameConfig.palette.jet;
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 5;
    context.fill();
    context.stroke();

    context.fillStyle = GameConfig.palette.jetLight;
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(-width * 0.31, 0);
    context.lineTo(-width * 0.18, -height * 0.17);
    context.lineTo(-width * 0.02, -height * 0.12);
    context.lineTo(width * 0.02, 0);
    context.lineTo(-width * 0.02, height * 0.12);
    context.lineTo(-width * 0.18, height * 0.17);
    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = GameConfig.palette.jetAccent;
    context.fillRect(width * 0.08, -height * 0.3, width * 0.12, height * 0.16);
    context.restore();
  }

  private traceJet(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    context.beginPath();
    context.moveTo(-width / 2, 0);
    context.lineTo(-width * 0.14, -height * 0.18);
    context.lineTo(width * 0.2, -height / 2);
    context.lineTo(width * 0.43, -height / 2);
    context.lineTo(width * 0.27, -height * 0.12);
    context.lineTo(width / 2, -height * 0.03);
    context.lineTo(width / 2, height * 0.03);
    context.lineTo(width * 0.27, height * 0.12);
    context.lineTo(width * 0.43, height / 2);
    context.lineTo(width * 0.2, height / 2);
    context.lineTo(-width * 0.14, height * 0.18);
    context.closePath();
  }

  private drawUfoIcon(
    context: CanvasRenderingContext2D,
    screen: Vec2,
    width: number,
    height: number,
    showPilot: boolean,
    lightsOn = true,
  ): void {
    const { palette } = GameConfig;
    const outline = Math.max(2, width * 0.035);
    context.save();
    context.translate(screen.x, screen.y);
    context.lineJoin = "round";
    context.lineCap = "round";
    context.strokeStyle = palette.ink;
    context.lineWidth = outline;

    context.fillStyle = palette.ufo;
    context.beginPath();
    context.moveTo(-width * 0.48, -height * 0.02);
    context.quadraticCurveTo(-width * 0.32, -height * 0.2, -width * 0.2, -height * 0.2);
    context.lineTo(-width * 0.12, -height * 0.43);
    context.quadraticCurveTo(0, -height * 0.5, width * 0.12, -height * 0.43);
    context.lineTo(width * 0.2, -height * 0.2);
    context.quadraticCurveTo(width * 0.32, -height * 0.2, width * 0.48, -height * 0.02);
    context.quadraticCurveTo(width * 0.4, height * 0.3, 0, height * 0.38);
    context.quadraticCurveTo(-width * 0.4, height * 0.3, -width * 0.48, -height * 0.02);
    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = lightsOn ? palette.ufoLight : palette.ufoDark;
    for (const lightX of [-0.36, -0.22, -0.08, 0.08, 0.22, 0.36]) {
      const x = width * lightX;
      const y = height * (0.015 + Math.abs(lightX) * 0.08);
      context.beginPath();
      context.arc(x, y, Math.max(1.6, height * 0.027), 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = palette.ink;
      context.lineWidth = Math.max(1, outline * 0.35);
      context.stroke();
    }

    context.strokeStyle = palette.ufoLight;
    context.lineWidth = Math.max(3, height * 0.09);
    context.beginPath();
    context.moveTo(-width * 0.43, 0);
    context.quadraticCurveTo(0, height * 0.09, width * 0.43, 0);
    context.stroke();

    const screenWidth = width * 0.22;
    const screenHeight = height * 0.25;
    const screenY = -height * 0.29;
    context.fillStyle = palette.ufoScreen;
    context.strokeStyle = palette.ink;
    context.lineWidth = outline * 0.75;
    context.beginPath();
    context.roundRect(
      -screenWidth / 2,
      screenY - screenHeight / 2,
      screenWidth,
      screenHeight,
      Math.max(2, screenHeight * 0.18),
    );
    context.fill();
    context.stroke();

    context.fillStyle = palette.ufoDark;
    context.beginPath();
    context.ellipse(
      0,
      height * 0.3,
      width * 0.12,
      height * 0.11,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.stroke();
    context.strokeStyle = palette.ufoLight;
    context.lineWidth = Math.max(2, height * 0.055);
    context.beginPath();
    context.ellipse(
      0,
      height * 0.3,
      width * 0.08,
      height * 0.065,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();

    if (showPilot) {
      context.save();
      context.beginPath();
      context.roundRect(
        -screenWidth / 2 + outline,
        screenY - screenHeight / 2 + outline,
        screenWidth - outline * 2,
        screenHeight - outline * 2,
        Math.max(1, screenHeight * 0.1),
      );
      context.clip();
      context.fillStyle = "#8f96a8";
      context.beginPath();
      context.ellipse(0, screenY + screenHeight * 0.55, screenWidth * 0.42, screenHeight * 0.42, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#ffd0ad";
      context.beginPath();
      context.arc(0, screenY, screenHeight * 0.28, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = palette.ink;
      context.beginPath();
      context.arc(0, screenY - screenHeight * 0.1, screenHeight * 0.29, Math.PI, Math.PI * 2);
      context.fill();
      context.fillRect(-screenWidth * 0.27, screenY - screenHeight * 0.04, screenWidth * 0.54, screenHeight * 0.13);
      context.restore();
    }

    context.restore();
  }

  private drawHitterAndClub(context: CanvasRenderingContext2D): void {
    const hitterAnchor = this.worldToScreen({ x: GameConfig.hitter.x, y: 0 });
    const hitterX = hitterAnchor.x;
    const visualScale = GameConfig.visualScale;
    const width =
      GameConfig.hitter.width * GameConfig.pixelsPerMeter * visualScale;
    const height =
      GameConfig.hitter.height * GameConfig.pixelsPerMeter * visualScale;
    const hitterY = this.worldToScreenY(0) - height;
    if (hitterX > -200 && hitterX < GameConfig.logicalWidth + 200) {
      if (this.sprites) {
        drawSpritePose(
          context,
          this.sprites,
          BatterFrames[this.currentBatterFrameIndex()],
          hitterAnchor,
          { flipX: true },
        );
        return;
      }

      context.fillStyle = GameConfig.palette.hitterEdge;
      context.fillRect(
        hitterX - width / 2 - 4 * visualScale,
        hitterY - 4 * visualScale,
        width + 8 * visualScale,
        height + 4 * visualScale,
      );
      context.fillStyle = GameConfig.palette.hitter;
      context.fillRect(hitterX - width / 2, hitterY, width, height);
    }

    const club = this.batterClubSegment(this.swing.elapsed);
    const grip = this.worldToScreen(club.start);
    const head = this.worldToScreen(club.end);
    context.strokeStyle = GameConfig.palette.club;
    context.lineWidth =
      GameConfig.swing.thickness * GameConfig.pixelsPerMeter * visualScale;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(grip.x, grip.y);
    context.lineTo(head.x, head.y);
    context.stroke();

    context.save();
    context.translate(head.x, head.y);
    context.fillStyle = GameConfig.palette.club;
    context.fillRect(
      -10 * visualScale,
      -10 * visualScale,
      26 * visualScale,
      20 * visualScale,
    );
    context.fillStyle = GameConfig.palette.clubHead;
    context.fillRect(
      -5 * visualScale,
      -5 * visualScale,
      16 * visualScale,
      10 * visualScale,
    );
    context.restore();
  }

  private currentBatterFrameIndex(): number {
    if (this.swing.state === "idle") return 0;
    if (this.swing.state === "done") return BatterFrames.length - 1;
    const frameDuration =
      GameConfig.swing.duration / GameConfig.swing.frameCount;
    return Math.min(
      BatterFrames.length - 1,
      Math.floor(this.swing.elapsed / frameDuration),
    );
  }

  private drawPlayer(context: CanvasRenderingContext2D): void {
    const screen = this.worldToScreen(this.player.pos);
    const width = this.player.width * GameConfig.pixelsPerMeter;
    const height = this.player.height * GameConfig.pixelsPerMeter;
    const visualScale = GameConfig.visualScale;
    const visualWidth = width * visualScale;
    const visualHeight = height * visualScale;
    const poseWidth = visualWidth * GameConfig.player.poseVisualScale;
    const poseHeight = visualHeight * GameConfig.player.poseVisualScale;
    const heightAboveGround = Math.max(0, -this.player.pos.y - this.player.height / 2);
    const shadowScale = clamp(1 - heightAboveGround / 100, 0.18, 1);
    const shadowWidth =
      this.powerUp.mode === "ufo"
        ? GameConfig.powerUp.ufo.displayWidth * GameConfig.pixelsPerMeter
        : this.powerUp.mode === "jet"
        ? GameConfig.pickup.sixthGenJet.width *
          GameConfig.pixelsPerMeter *
          visualScale
        : visualWidth;

    context.fillStyle = "rgb(20 32 51 / 18%)";
    context.beginPath();
    context.ellipse(
      screen.x,
      this.worldToScreenY(0) + 8,
      shadowWidth * 0.72 * shadowScale,
      8 * shadowScale,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();

    if (this.powerUp.mode === "ufo") {
      const lightsOn = this.ufoLightsOn();
      if (this.sprites) {
        drawSpritePose(
          context,
          this.sprites,
          lightsOn ? FlyerPoses.ufoLightsOn : FlyerPoses.ufo,
          screen,
        );
      } else {
        this.drawUfoIcon(
          context,
          screen,
          GameConfig.powerUp.ufo.displayWidth * GameConfig.pixelsPerMeter,
          GameConfig.powerUp.ufo.displayHeight * GameConfig.pixelsPerMeter,
          true,
          lightsOn,
        );
      }
      return;
    }

    if (this.powerUp.mode === "jet") {
      if (this.sprites) {
        drawSpritePose(context, this.sprites, FlyerPoses.jet, screen, {
          flipX: true,
        });
      } else {
        this.drawJetIcon(
          context,
          screen,
          GameConfig.pickup.sixthGenJet.width *
            GameConfig.pixelsPerMeter *
            visualScale,
          GameConfig.pickup.sixthGenJet.height *
            GameConfig.pixelsPerMeter *
            visualScale,
        );
      }
      return;
    }

    if (this.sprites) {
      this.drawPlayerSprite(context, screen);
      return;
    }

    if (this.powerUp.mode === "lantern") {
      const lanternWidth =
        GameConfig.pickup.skyLantern.width *
        GameConfig.pixelsPerMeter *
        GameConfig.player.poseVisualScale;
      const lanternHeight =
        GameConfig.pickup.skyLantern.height *
        GameConfig.pixelsPerMeter *
        GameConfig.player.poseVisualScale;
      const ropeLength =
        14 * visualScale * GameConfig.player.poseVisualScale;
      const lanternScreen = {
        x: screen.x,
        y: screen.y - poseHeight / 2 - ropeLength - lanternHeight / 2,
      };
      context.strokeStyle = GameConfig.palette.ink;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(
        lanternScreen.x - lanternWidth * 0.2,
        lanternScreen.y + lanternHeight * 0.48,
      );
      context.lineTo(
        screen.x - poseWidth * 0.3,
        screen.y - poseHeight / 2,
      );
      context.moveTo(
        lanternScreen.x + lanternWidth * 0.2,
        lanternScreen.y + lanternHeight * 0.48,
      );
      context.lineTo(
        screen.x + poseWidth * 0.3,
        screen.y - poseHeight / 2,
      );
      context.stroke();
      this.drawSkyLanternIcon(
        context,
        lanternScreen,
        lanternWidth,
        lanternHeight,
      );
    }

    this.drawOriginalPlayer(context, screen, poseWidth, poseHeight);
  }

  private drawJetTrails(context: CanvasRenderingContext2D): void {
    if (this.jetTrails.length === 0) return;

    const {
      trailEngineOffsetY,
      trailWidth,
      trailPuffSpacing,
      trailPuffRadius,
    } = GameConfig.powerUp.jet;
    const engineOffsetWorld =
      trailEngineOffsetY / GameConfig.pixelsPerMeter;
    const puffSpacingWorld =
      trailPuffSpacing / GameConfig.pixelsPerMeter;
    const visibleWorldStart = this.screenToWorldX(-trailPuffRadius * 3);
    const visibleWorldEnd = this.screenToWorldX(
      GameConfig.logicalWidth + trailPuffRadius * 3,
    );

    context.save();
    context.strokeStyle = "rgb(255 255 255 / 56%)";
    context.lineWidth = trailWidth;
    context.lineCap = "round";
    context.shadowColor = "rgb(255 255 255 / 72%)";
    context.shadowBlur = 5;
    context.beginPath();
    for (const trail of this.jetTrails) {
      const startX = this.worldToScreenX(trail.startX);
      const endX = this.worldToScreenX(trail.endX);
      for (const offsetY of [-engineOffsetWorld, engineOffsetWorld]) {
        const y = this.worldToScreenY(trail.y + offsetY);
        context.moveTo(startX, y);
        context.lineTo(endX, y);
      }
    }
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = GameConfig.palette.cloud;

    for (let trailIndex = 0; trailIndex < this.jetTrails.length; trailIndex += 1) {
      const trail = this.jetTrails[trailIndex];
      const firstVisibleX = Math.max(trail.startX, visibleWorldStart);
      const lastVisibleX = Math.min(trail.endX, visibleWorldEnd);
      if (firstVisibleX > lastVisibleX) continue;

      const firstPuffIndex = Math.ceil(firstVisibleX / puffSpacingWorld);
      const lastPuffIndex = Math.floor(lastVisibleX / puffSpacingWorld);
      for (const engineIndex of [-1, 1]) {
        const centerY = this.worldToScreenY(
          trail.y + engineOffsetWorld * engineIndex,
        );
        for (
          let puffIndex = firstPuffIndex;
          puffIndex <= lastPuffIndex;
          puffIndex += 1
        ) {
          const channel = trailIndex * 11 + (engineIndex + 1) * 3;
          const xNoise = stableNoise(puffIndex, channel);
          const yNoise = stableNoise(puffIndex, channel + 1);
          const sizeNoise = stableNoise(puffIndex, channel + 2);
          const alphaNoise = stableNoise(puffIndex, channel + 3);
          const puffX =
            this.worldToScreenX(puffIndex * puffSpacingWorld) +
            (xNoise - 0.5) * trailPuffSpacing * 0.65;
          const puffY =
            centerY + (yNoise - 0.5) * trailPuffRadius * 0.9;
          const radiusX = trailPuffRadius * (0.8 + sizeNoise * 0.8);
          const radiusY = trailPuffRadius * (0.48 + sizeNoise * 0.42);

          context.globalAlpha = 0.48 + alphaNoise * 0.38;
          context.beginPath();
          context.ellipse(
            puffX,
            puffY,
            radiusX,
            radiusY,
            (yNoise - 0.5) * 0.32,
            0,
            Math.PI * 2,
          );
          context.fill();

          if (puffIndex % 2 === 0) {
            context.globalAlpha *= 0.48;
            context.beginPath();
            context.ellipse(
              puffX - radiusX * 0.18,
              puffY + (yNoise - 0.5) * trailPuffRadius * 1.25,
              radiusX * 0.62,
              radiusY * 0.7,
              0,
              0,
              Math.PI * 2,
            );
            context.fill();
          }
        }
      }
    }
    context.restore();
  }

  private drawPlayerSprite(
    context: CanvasRenderingContext2D,
    screen: Vec2,
  ): void {
    if (!this.sprites) return;

    if (this.powerUp.mode === "lantern") {
      drawSpritePose(context, this.sprites, FlyerPoses.lantern, screen, {
        flipX: true,
      });
      return;
    }

    if (this.phase === "ready" || this.phase === "falling") {
      drawSpritePose(context, this.sprites, FlyerPoses.falling, screen, {
        flipX: true,
      });
      return;
    }

    if (
      this.phase === "landingGrace" ||
      this.phase === "sliding" ||
      this.phase === "ended"
    ) {
      drawSpritePose(context, this.sprites, FlyerPoses.sliding, screen, {
        flipX: true,
      });
      return;
    }

    const rotation = this.airbornePlayerRotation();
    drawSpritePose(context, this.sprites, FlyerPoses.airborne, screen, {
      rotation,
      flipX: true,
    });
  }

  private airbornePlayerRotation(): number {
    const speed = Math.hypot(this.player.vel.x, this.player.vel.y);
    return speed <= DISTANCE_EPSILON
      ? 0
      : clamp(
          Math.atan2(this.player.vel.y, this.player.vel.x),
          -Math.PI / 6,
          Math.PI / 6,
        );
  }

  private drawMissileTailFlame(context: CanvasRenderingContext2D): void {
    if (
      this.launcherId !== "missileTruck" ||
      this.phase !== "airborne" ||
      this.powerUp.mode !== "normal" ||
      this.missileTailFlameRemaining <= 0 ||
      !this.effectSprites
    ) {
      return;
    }

    const {
      launchAngle,
      tailFlameAnchor,
      tailFlameFootOffset,
      tailFlameWidth,
    } = GameConfig.missileTruck;
    const poseVisualScale = GameConfig.player.poseVisualScale;
    const playerScreen = this.worldToScreen(this.player.pos);
    const playerRotation = this.airbornePlayerRotation();
    const cos = Math.cos(playerRotation);
    const sin = Math.sin(playerRotation);
    const feet = {
      x:
        playerScreen.x +
        tailFlameFootOffset.x * poseVisualScale * cos -
        tailFlameFootOffset.y * poseVisualScale * sin,
      y:
        playerScreen.y +
        tailFlameFootOffset.x * poseVisualScale * sin +
        tailFlameFootOffset.y * poseVisualScale * cos,
    };
    const image = this.effectSprites.missileTailFlame;
    const scale = tailFlameWidth / image.width;

    context.save();
    context.translate(feet.x, feet.y);
    context.rotate(-launchAngle);
    context.drawImage(
      image,
      -tailFlameAnchor.x * scale,
      -tailFlameAnchor.y * scale,
      image.width * scale,
      image.height * scale,
    );
    context.restore();
  }

  private drawOriginalPlayer(
    context: CanvasRenderingContext2D,
    screen: Vec2,
    width: number,
    height: number,
  ): void {
    context.fillStyle = GameConfig.palette.playerEdge;
    context.fillRect(
      screen.x - width / 2 - 4,
      screen.y - height / 2 - 4,
      width + 8,
      height + 8,
    );
    context.fillStyle = GameConfig.palette.player;
    context.fillRect(screen.x - width / 2, screen.y - height / 2, width, height);
  }

  private drawEffects(context: CanvasRenderingContext2D): void {
    for (const explosion of this.explosions) {
      const screen = this.worldToScreen(explosion.pos);
      const progress = 1 - explosion.life / explosion.maxLife;
      context.strokeStyle = `${GameConfig.palette.explosion}${Math.round(
        (1 - progress) * 255,
      )
        .toString(16)
        .padStart(2, "0")}`;
      context.lineWidth = 12 * (1 - progress) + 2;
      context.beginPath();
      context.arc(screen.x, screen.y, 18 + progress * 72, 0, Math.PI * 2);
      context.stroke();
    }

    for (const particle of this.particles) {
      const screen = this.worldToScreen(particle.pos);
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      const size = particle.size * GameConfig.pixelsPerMeter;
      context.save();
      context.translate(screen.x, screen.y);
      context.rotate(particle.rotation);
      context.globalAlpha = alpha;
      context.fillStyle = particle.color;
      context.beginPath();
      context.moveTo(size, 0);
      context.lineTo(-size * 0.7, size * 0.65);
      context.lineTo(-size * 0.7, -size * 0.65);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  private drawImpactFlash(context: CanvasRenderingContext2D): void {
    const flash = this.impactFlash;
    if (!flash) return;

    const progress = clamp(1 - flash.life / flash.maxLife, 0, 1);
    const fade = progress < 0.58 ? 1 : (1 - progress) / 0.42;
    const scale = 0.82 + Math.min(1, progress / 0.18) * 0.18;
    const outerRadius = GameConfig.swing.impactFlashRadius * scale;
    const innerRadius = outerRadius * 0.56;
    const screen = this.worldToScreen(flash.pos);
    const spikeScale = [
      1, 0.56, 0.78, 0.48, 0.9, 0.6, 0.72, 0.5, 0.96, 0.58,
      0.76, 0.46, 0.86, 0.62, 0.7, 0.52, 0.92, 0.6, 0.74, 0.5,
    ];

    context.save();
    context.translate(screen.x, screen.y);
    context.globalAlpha = clamp(fade, 0, 1);

    if (this.effectSprites) {
      const diameter = outerRadius * 2;
      context.drawImage(
        this.effectSprites.impactFlash,
        -diameter / 2,
        -diameter / 2,
        diameter,
        diameter,
      );
      context.restore();
      return;
    }

    context.rotate(-Math.PI / 16);
    context.fillStyle = GameConfig.palette.cloud;
    context.strokeStyle = GameConfig.palette.ink;
    context.lineWidth = 3;
    context.lineJoin = "miter";
    context.beginPath();
    for (let index = 0; index < 40; index += 1) {
      const spikeIndex = Math.floor(index / 2);
      const radius =
        index % 2 === 0
          ? outerRadius * spikeScale[spikeIndex]
          : innerRadius;
      const angle = (index / 40) * Math.PI * 2;
      const x = Math.cos(angle) * radius * 0.72;
      const y = Math.sin(angle) * radius;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  private worldToScreen(position: Vec2): Vec2 {
    return {
      x: this.worldToScreenX(position.x),
      y: this.worldToScreenY(position.y),
    };
  }

  private worldToScreenX(worldX: number): number {
    return (
      GameConfig.worldAnchorScreenX +
      (worldX - this.camera.x) * GameConfig.pixelsPerMeter
    );
  }

  private worldToScreenY(worldY: number): number {
    return (
      GameConfig.groundScreenY +
      (worldY - this.camera.y) * GameConfig.pixelsPerMeter
    );
  }

  private screenToWorldX(screenX: number): number {
    return (
      this.camera.x +
      (screenX - GameConfig.worldAnchorScreenX) / GameConfig.pixelsPerMeter
    );
  }

  private groundCenterY(): number {
    return -this.player.height / 2;
  }

}
