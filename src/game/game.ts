import { GameConfig } from "./config";
import {
  BatterFrames,
  drawSpritePose,
  FlyerPoses,
  MinePose,
  type CharacterSprites,
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

const DISTANCE_EPSILON = 1e-7;

const randomBetween = (
  random: () => number,
  minimum: number,
  maximum: number,
): number => minimum + (maximum - minimum) * random();

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

interface PowerUpRuntime {
  mode: PlayerMode;
  remainingDistance: number;
}

export class Game {
  private phase: GamePhase = "ready";
  private player: PlayerState;
  private swing: SwingRuntime;
  private camera: CameraState = { x: 0, y: 0, shakeTime: 0, shakeStrength: 0 };
  private powerUp: PowerUpRuntime = {
    mode: "normal",
    remainingDistance: 0,
  };
  private verticalTrackingActive = false;
  private mines: MineState[] = [];
  private pickups: PickupState[] = [];
  private particles: ParticleState[] = [];
  private explosions: ExplosionState[] = [];
  private maxDistance = 0;
  private skipCount = 0;
  private redPacketCount = 0;
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

  constructor(
    private readonly emitAudio: (event: AudioEvent) => void,
    private readonly sprites: CharacterSprites | null,
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
      score:
        Math.floor(this.maxDistance / 10) +
        this.skipCount * 5 +
        this.redPacketCount * 50,
      ended: this.phase === "ended",
    };
  }

  action(): void {
    switch (this.phase) {
      case "ready":
        this.phase = "falling";
        break;
      case "ended":
        this.resetRound(true);
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
    const previousPlayerPosition = { ...this.player.pos };
    this.updateSwing(deltaTime);

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

    this.maxDistance = Math.max(this.maxDistance, -this.player.pos.x);
    this.ensureMines(this.maxDistance + GameConfig.mine.generationAhead);
    this.ensurePickups(this.maxDistance + GameConfig.pickup.generationAhead);
    this.updateCamera(deltaTime);
    this.updatePickups(deltaTime, previousPlayerPosition);
    this.updateEffects(deltaTime);
  }

  render(context: CanvasRenderingContext2D): void {
    const { logicalWidth, logicalHeight, palette } = GameConfig;
    const skyGradient = context.createLinearGradient(0, 0, 0, logicalHeight);
    skyGradient.addColorStop(0, palette.sky);
    skyGradient.addColorStop(1, palette.skyDeep);
    context.fillStyle = skyGradient;
    context.fillRect(0, 0, logicalWidth, logicalHeight);

    this.drawSky(context);

    const shake = this.getShakeOffset();
    context.save();
    context.translate(shake.x, shake.y);
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

  private resetRound(startImmediately: boolean): void {
    this.phase = startImmediately ? "falling" : "ready";
    this.player = this.createPlayer();
    this.swing = this.createSwing();
    this.camera = { x: 0, y: 0, shakeTime: 0, shakeStrength: 0 };
    this.powerUp = {
      mode: "normal",
      remainingDistance: 0,
    };
    this.verticalTrackingActive = false;
    this.maxDistance = 0;
    this.skipCount = 0;
    this.redPacketCount = 0;
    this.landingElapsed = 0;
    this.landingWasAirborne = false;
    this.impactVelocity = { x: 0, y: 0 };
    this.approachAttempted = false;
    this.skipQueued = false;
    this.particles = [];
    this.explosions = [];
    this.mines = [];
    this.pickups = [];
    this.mineId = 0;
    this.pickupId = 0;

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
    this.ensureMines(GameConfig.mine.generationAhead);
    this.ensurePickups(GameConfig.pickup.generationAhead);
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
    const { speed } = GameConfig.powerUp.jet;
    const travel = Math.min(speed * deltaTime, this.powerUp.remainingDistance);
    this.player.pos.x -= travel;
    this.player.vel.x = -speed;
    this.player.vel.y = 0;
    this.powerUp.remainingDistance -= travel;

    if (this.powerUp.remainingDistance <= DISTANCE_EPSILON) {
      this.powerUp.mode = "normal";
      this.powerUp.remainingDistance = 0;
      this.player.vel.x = -GameConfig.powerUp.jet.exitSpeed;
      this.player.vel.y = 0;
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
    this.skipCount += 1;
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
    this.player.vel.x = -Math.cos(launchAngle) * GameConfig.launchSpeed;
    this.player.vel.y = -Math.sin(launchAngle) * GameConfig.launchSpeed;
    this.phase = "airborne";
    this.resetApproachState();
    this.emitAudio("hit");
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
        ((point.x - frame.anchor.x) * frame.scale) /
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
    this.player.vel.x = -Math.max(
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
        pos: { x: -distance, y: -GameConfig.mine.height / 2 },
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
        pos: { x: -this.nextPickupDistance, y: -altitude },
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
    if (roll < GameConfig.pickup.redPacket.weight) return "redPacket";
    if (
      roll <
      GameConfig.pickup.redPacket.weight + GameConfig.pickup.skyLantern.weight
    ) {
      return "skyLantern";
    }
    return "sixthGenJet";
  }

  private getPickupConfig(type: PickupType) {
    switch (type) {
      case "redPacket":
        return GameConfig.pickup.redPacket;
      case "skyLantern":
        return GameConfig.pickup.skyLantern;
      case "sixthGenJet":
        return GameConfig.pickup.sixthGenJet;
    }
  }

  private updatePickups(
    deltaTime: number,
    previousPlayerPosition: Vec2,
  ): void {
    if (this.phase === "airborne") {
      for (const pickup of this.pickups) {
        if (pickup.status !== "available") continue;
        if (
          this.powerUp.mode === "jet" &&
          pickup.type !== "redPacket"
        ) {
          continue;
        }
        if (this.powerUp.mode === "jet" && pickup.type === "redPacket") {
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

      if (this.powerUp.mode === "jet") {
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
        this.redPacketCount += 1;
        this.emitAudio("pickupRedPacket");
        break;
      case "skyLantern":
        this.powerUp.mode = "lantern";
        this.powerUp.remainingDistance =
          GameConfig.powerUp.lantern.ascentDistance;
        this.player.vel.y = -GameConfig.powerUp.lantern.ascentSpeed;
        this.verticalTrackingActive = true;
        this.resetApproachState();
        this.emitAudio("pickupLantern");
        break;
      case "sixthGenJet":
        this.powerUp.mode = "jet";
        this.powerUp.remainingDistance = GameConfig.powerUp.jet.travelDistance;
        this.player.vel.x = -GameConfig.powerUp.jet.speed;
        this.player.vel.y = 0;
        this.verticalTrackingActive = true;
        this.resetApproachState();
        this.emitAudio("pickupJet");
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
      this.redPacketCount += 1;
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
    for (const pickup of this.pickups) {
      if (pickup.status !== "attracting") continue;
      const offsetX = this.player.pos.x - pickup.pos.x;
      const offsetY = this.player.pos.y - pickup.pos.y;
      const distance = Math.hypot(offsetX, offsetY);
      if (
        distance <= GameConfig.pickup.magnetCollectDistance ||
        travel >= distance
      ) {
        pickup.pos = { ...this.player.pos };
        pickup.status = "collected";
        continue;
      }
      pickup.pos.x += (offsetX / distance) * travel;
      pickup.pos.y += (offsetY / distance) * travel;
    }
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

    this.camera.shakeTime = Math.max(0, this.camera.shakeTime - deltaTime);
  }

  private updateCamera(deltaTime: number): void {
    const pixelsPerMeter = GameConfig.pixelsPerMeter;
    const playerScreenX =
      GameConfig.worldAnchorScreenX +
      (this.player.pos.x - this.camera.x) * pixelsPerMeter;
    if (playerScreenX < GameConfig.followScreenX) {
      const desiredCameraX =
        this.player.pos.x +
        (GameConfig.worldAnchorScreenX - GameConfig.followScreenX) /
          pixelsPerMeter;
      const followRate = GameConfig.camera.followRate;
      // Feed the horizontal velocity into the target. A plain smooth interpolation
      // always trails a moving target, pushing the player left of the intended
      // anchor; this term cancels that steady-state lag while keeping the onset soft.
      const velocityCompensatedTarget =
        desiredCameraX + this.player.vel.x / followRate;
      const smoothing = 1 - Math.exp(-followRate * deltaTime);
      const nextCameraX = lerp(
        this.camera.x,
        velocityCompensatedTarget,
        smoothing,
      );
      this.camera.x = Math.min(this.camera.x, nextCameraX);
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
    context.fillStyle = GameConfig.palette.sun;
    context.beginPath();
    context.arc(180, 155, 58, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = `${GameConfig.palette.cloud}cc`;
    this.drawCloud(context, 410 - this.camera.x * 0.32, 170, 1);
    this.drawCloud(context, 1090 - this.camera.x * 0.2, 290, 0.72);
  }

  private drawCloud(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
  ): void {
    const wrappedX = ((x + 260) % 1860 + 1860) % 1860 - 260;
    context.save();
    context.translate(wrappedX, y);
    context.scale(scale, scale);
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
    this.drawPickups(context);
    this.drawHitterAndClub(context);
    this.drawEffects(context);
    this.drawPlayer(context);
  }

  private drawGround(context: CanvasRenderingContext2D): void {
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
    const maximumDistance = Math.max(0, -leftWorld);
    const minimumDistance = Math.max(100, -rightWorld);
    const first =
      Math.ceil(minimumDistance / GameConfig.signs.interval) *
      GameConfig.signs.interval;

    for (
      let distance = first;
      distance <= maximumDistance;
      distance += GameConfig.signs.interval
    ) {
      const x = this.worldToScreenX(-distance);
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
        drawSpritePose(context, this.sprites, MinePose, { x, y: groundY });
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
      context.lineWidth = 4;
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
      switch (pickup.type) {
        case "redPacket":
          this.drawRedPacketIcon(context, screen, width, height);
          break;
        case "skyLantern":
          this.drawSkyLanternIcon(context, screen, width, height);
          break;
        case "sixthGenJet":
          this.drawJetIcon(context, screen, width, height);
          break;
      }
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

  private drawHitterAndClub(context: CanvasRenderingContext2D): void {
    const hitterAnchor = this.worldToScreen({ x: GameConfig.hitter.x, y: 0 });
    const hitterX = hitterAnchor.x;
    const width = GameConfig.hitter.width * GameConfig.pixelsPerMeter;
    const height = GameConfig.hitter.height * GameConfig.pixelsPerMeter;
    const hitterY = this.worldToScreenY(0) - height;
    if (hitterX > -200 && hitterX < GameConfig.logicalWidth + 200) {
      if (this.sprites) {
        drawSpritePose(
          context,
          this.sprites,
          BatterFrames[this.currentBatterFrameIndex()],
          hitterAnchor,
        );
        return;
      }

      context.fillStyle = GameConfig.palette.hitterEdge;
      context.fillRect(hitterX - width / 2 - 4, hitterY - 4, width + 8, height + 4);
      context.fillStyle = GameConfig.palette.hitter;
      context.fillRect(hitterX - width / 2, hitterY, width, height);
    }

    const club = this.batterClubSegment(this.swing.elapsed);
    const grip = this.worldToScreen(club.start);
    const head = this.worldToScreen(club.end);
    context.strokeStyle = GameConfig.palette.club;
    context.lineWidth = GameConfig.swing.thickness * GameConfig.pixelsPerMeter;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(grip.x, grip.y);
    context.lineTo(head.x, head.y);
    context.stroke();

    context.save();
    context.translate(head.x, head.y);
    context.fillStyle = GameConfig.palette.club;
    context.fillRect(-10, -10, 26, 20);
    context.fillStyle = GameConfig.palette.clubHead;
    context.fillRect(-5, -5, 16, 10);
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
    const heightAboveGround = Math.max(0, -this.player.pos.y - this.player.height / 2);
    const shadowScale = clamp(1 - heightAboveGround / 100, 0.18, 1);
    const shadowWidth =
      this.powerUp.mode === "jet"
        ? GameConfig.pickup.sixthGenJet.width * GameConfig.pixelsPerMeter
        : width;

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

    if (this.powerUp.mode === "jet") {
      if (this.sprites) {
        drawSpritePose(context, this.sprites, FlyerPoses.jet, screen);
      } else {
        this.drawJetIcon(
          context,
          screen,
          GameConfig.pickup.sixthGenJet.width * GameConfig.pixelsPerMeter,
          GameConfig.pickup.sixthGenJet.height * GameConfig.pixelsPerMeter,
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
        GameConfig.pickup.skyLantern.width * GameConfig.pixelsPerMeter;
      const lanternHeight =
        GameConfig.pickup.skyLantern.height * GameConfig.pixelsPerMeter;
      const ropeLength = 14;
      const lanternScreen = {
        x: screen.x,
        y: screen.y - height / 2 - ropeLength - lanternHeight / 2,
      };
      context.strokeStyle = GameConfig.palette.ink;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(
        lanternScreen.x - lanternWidth * 0.2,
        lanternScreen.y + lanternHeight * 0.48,
      );
      context.lineTo(screen.x - width * 0.3, screen.y - height / 2);
      context.moveTo(
        lanternScreen.x + lanternWidth * 0.2,
        lanternScreen.y + lanternHeight * 0.48,
      );
      context.lineTo(screen.x + width * 0.3, screen.y - height / 2);
      context.stroke();
      this.drawSkyLanternIcon(
        context,
        lanternScreen,
        lanternWidth,
        lanternHeight,
      );
    }

    this.drawOriginalPlayer(context, screen, width, height);
  }

  private drawPlayerSprite(
    context: CanvasRenderingContext2D,
    screen: Vec2,
  ): void {
    if (!this.sprites) return;

    if (this.powerUp.mode === "lantern") {
      drawSpritePose(context, this.sprites, FlyerPoses.lantern, screen);
      return;
    }

    if (this.phase === "ready" || this.phase === "falling") {
      drawSpritePose(context, this.sprites, FlyerPoses.falling, screen);
      return;
    }

    if (
      this.phase === "landingGrace" ||
      this.phase === "sliding" ||
      this.phase === "ended"
    ) {
      drawSpritePose(context, this.sprites, FlyerPoses.sliding, screen);
      return;
    }

    const speed = Math.hypot(this.player.vel.x, this.player.vel.y);
    const rotation =
      speed <= DISTANCE_EPSILON
        ? 0
        : clamp(
            Math.atan2(-this.player.vel.y, -this.player.vel.x),
            -Math.PI / 6,
            Math.PI / 6,
          );
    drawSpritePose(context, this.sprites, FlyerPoses.airborne, screen, {
      rotation,
    });
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
