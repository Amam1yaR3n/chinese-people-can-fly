import { GameConfig } from "./config";
import type {
  AudioEvent,
  CameraState,
  ExplosionState,
  GamePhase,
  GameSnapshot,
  MineState,
  ParticleState,
  PlayerState,
  SwingState,
  Vec2,
} from "./types";

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;

const easeInCubic = (value: number): number => value * value * value;
const easeOutCubic = (value: number): number => 1 - (1 - value) ** 3;

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
  angle: number;
  previousAngle: number;
  connected: boolean;
}

export class Game {
  private phase: GamePhase = "ready";
  private player: PlayerState;
  private swing: SwingRuntime;
  private camera: CameraState = { x: 0, shakeTime: 0, shakeStrength: 0 };
  private mines: MineState[] = [];
  private particles: ParticleState[] = [];
  private explosions: ExplosionState[] = [];
  private maxDistance = 0;
  private landingElapsed = 0;
  private landingWasAirborne = false;
  private impactVelocity: Vec2 = { x: 0, y: 0 };
  private approachAttempted = false;
  private skipQueued = false;
  private random: () => number = Math.random;
  private nextMineDistance: number = GameConfig.mine.firstMin;
  private mineId = 0;

  constructor(private readonly emitAudio: (event: AudioEvent) => void) {
    this.player = this.createPlayer();
    this.swing = this.createSwing();
    this.resetRound(false);
  }

  getSnapshot(): GameSnapshot {
    return {
      phase: this.phase,
      distance: Math.max(0, Math.floor(this.maxDistance)),
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
          this.swing.connected = false;
          this.emitAudio("swing");
        }
        break;
      case "airborne":
        this.handleAirborneAction();
        break;
      case "landingGrace":
        this.handleLandingAction();
        break;
      case "sliding":
        break;
    }
  }

  update(deltaTime: number): void {
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
    this.updateCamera(deltaTime);
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
      angle: GameConfig.club.idleAngle,
      previousAngle: GameConfig.club.idleAngle,
      connected: false,
    };
  }

  private resetRound(startImmediately: boolean): void {
    this.phase = startImmediately ? "falling" : "ready";
    this.player = this.createPlayer();
    this.swing = this.createSwing();
    this.camera = { x: 0, shakeTime: 0, shakeStrength: 0 };
    this.maxDistance = 0;
    this.landingElapsed = 0;
    this.landingWasAirborne = false;
    this.impactVelocity = { x: 0, y: 0 };
    this.approachAttempted = false;
    this.skipQueued = false;
    this.particles = [];
    this.explosions = [];
    this.mines = [];
    this.mineId = 0;

    const seedArray = new Uint32Array(1);
    crypto.getRandomValues(seedArray);
    this.random = mulberry32(seedArray[0] ?? Date.now());
    this.nextMineDistance = randomBetween(
      this.random,
      GameConfig.mine.firstMin,
      GameConfig.mine.firstMax,
    );
    this.ensureMines(GameConfig.mine.generationAhead);
  }

  private updateInitialFall(deltaTime: number): void {
    this.player.vel.y += GameConfig.gravity * deltaTime;
    this.player.pos.y += this.player.vel.y * deltaTime;
    if (this.player.pos.y >= this.groundCenterY()) {
      this.beginLanding(false);
    }
  }

  private updateAirborne(deltaTime: number): void {
    this.player.vel.y += GameConfig.gravity * deltaTime;
    this.player.pos.x += this.player.vel.x * deltaTime;
    this.player.pos.y += this.player.vel.y * deltaTime;

    if (this.checkMineCollision()) return;

    if (this.player.pos.y >= this.groundCenterY()) {
      this.beginLanding(true);
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
    const club = GameConfig.club;
    this.swing.previousAngle = this.swing.angle;

    if (this.swing.state === "downswing") {
      this.swing.elapsed += deltaTime;
      const progress = clamp(this.swing.elapsed / club.downswingDuration, 0, 1);
      this.swing.angle = lerp(
        club.idleAngle,
        club.downswingEndAngle,
        easeInCubic(progress),
      );

      if (this.phase === "falling" && !this.swing.connected) {
        const collisionAngle = this.findClubCollision(
          this.swing.previousAngle,
          this.swing.angle,
        );
        if (collisionAngle !== null) {
          this.launchPlayer(collisionAngle);
        }
      }

      if (progress >= 1) {
        this.swing.state = "followThrough";
        this.swing.elapsed = 0;
      }
      return;
    }

    if (this.swing.state === "followThrough") {
      this.swing.elapsed += deltaTime;
      const progress = clamp(this.swing.elapsed / club.followDuration, 0, 1);
      this.swing.angle = lerp(
        club.downswingEndAngle,
        club.followEndAngle,
        easeOutCubic(progress),
      );
      if (progress >= 1) {
        this.swing.state = "done";
      }
    }
  }

  private findClubCollision(previousAngle: number, angle: number): number | null {
    const sampleCount = 8;
    const playerRadius = Math.hypot(this.player.width / 2, this.player.height / 2);
    const hitRadius = playerRadius + GameConfig.club.thickness / 2;

    for (let sample = 0; sample <= sampleCount; sample += 1) {
      const amount = sample / sampleCount;
      const sampledAngle = lerp(previousAngle, angle, amount);
      const segment = this.clubActiveSegment(sampledAngle);
      if (
        pointToSegmentDistance(this.player.pos, segment.start, segment.end) <= hitRadius
      ) {
        return sampledAngle;
      }
    }
    return null;
  }

  private launchPlayer(collisionAngle: number): void {
    const mapProgress = clamp(
      (collisionAngle - GameConfig.club.launchMapStartAngle) /
        (GameConfig.club.launchMapEndAngle - GameConfig.club.launchMapStartAngle),
      0,
      1,
    );
    const launchAngle = lerp(
      GameConfig.launchAngleMin,
      GameConfig.launchAngleMax,
      mapProgress,
    );
    this.player.vel.x = -Math.cos(launchAngle) * GameConfig.launchSpeed;
    this.player.vel.y = -Math.sin(launchAngle) * GameConfig.launchSpeed;
    this.phase = "airborne";
    this.swing.connected = true;
    this.resetApproachState();
    this.emitAudio("hit");
  }

  private clubActiveSegment(angle: number): { start: Vec2; end: Vec2 } {
    const { pivot, length, activeStartRatio } = GameConfig.club;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    return {
      start: {
        x: pivot.x + direction.x * length * activeStartRatio,
        y: pivot.y + direction.y * length * activeStartRatio,
      },
      end: {
        x: pivot.x + direction.x * length,
        y: pivot.y + direction.y * length,
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
    if (playerScreenX >= GameConfig.followScreenX) return;

    const targetCameraX =
      this.player.pos.x +
      (GameConfig.worldAnchorScreenX - GameConfig.followScreenX) / pixelsPerMeter;
    const smoothing = 1 - Math.exp(-GameConfig.camera.followRate * deltaTime);
    this.camera.x = Math.min(this.camera.x, lerp(this.camera.x, targetCameraX, smoothing));
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
    this.drawHitterAndClub(context);
    this.drawEffects(context);
    this.drawPlayer(context);
  }

  private drawGround(context: CanvasRenderingContext2D): void {
    const { logicalWidth, logicalHeight, groundScreenY, palette } = GameConfig;
    context.fillStyle = palette.ground;
    context.fillRect(0, groundScreenY, logicalWidth, logicalHeight - groundScreenY);
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
      const groundY = GameConfig.groundScreenY;
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
      const groundY = GameConfig.groundScreenY;
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

  private drawHitterAndClub(context: CanvasRenderingContext2D): void {
    const hitterX = this.worldToScreenX(GameConfig.hitter.x);
    const width = GameConfig.hitter.width * GameConfig.pixelsPerMeter;
    const height = GameConfig.hitter.height * GameConfig.pixelsPerMeter;
    const hitterY = GameConfig.groundScreenY - height;
    if (hitterX > -200 && hitterX < GameConfig.logicalWidth + 200) {
      context.fillStyle = GameConfig.palette.hitterEdge;
      context.fillRect(hitterX - width / 2 - 4, hitterY - 4, width + 8, height + 4);
      context.fillStyle = GameConfig.palette.hitter;
      context.fillRect(hitterX - width / 2, hitterY, width, height);
    }

    const pivot = this.worldToScreen(GameConfig.club.pivot);
    const tip = {
      x:
        pivot.x +
        Math.cos(this.swing.angle) *
          GameConfig.club.length *
          GameConfig.pixelsPerMeter,
      y:
        pivot.y +
        Math.sin(this.swing.angle) *
          GameConfig.club.length *
          GameConfig.pixelsPerMeter,
    };
    context.strokeStyle = GameConfig.palette.club;
    context.lineWidth = GameConfig.club.thickness * GameConfig.pixelsPerMeter;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(pivot.x, pivot.y);
    context.lineTo(tip.x, tip.y);
    context.stroke();

    context.save();
    context.translate(tip.x, tip.y);
    context.rotate(this.swing.angle);
    context.fillStyle = GameConfig.palette.club;
    context.fillRect(-10, -10, 26, 20);
    context.fillStyle = GameConfig.palette.clubHead;
    context.fillRect(-5, -5, 16, 10);
    context.restore();
  }

  private drawPlayer(context: CanvasRenderingContext2D): void {
    const screen = this.worldToScreen(this.player.pos);
    const width = this.player.width * GameConfig.pixelsPerMeter;
    const height = this.player.height * GameConfig.pixelsPerMeter;
    const heightAboveGround = Math.max(0, -this.player.pos.y - this.player.height / 2);
    const shadowScale = clamp(1 - heightAboveGround / 100, 0.18, 1);

    context.fillStyle = "rgb(20 32 51 / 18%)";
    context.beginPath();
    context.ellipse(
      screen.x,
      GameConfig.groundScreenY + 8,
      width * 0.72 * shadowScale,
      8 * shadowScale,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();

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
      y: GameConfig.groundScreenY + position.y * GameConfig.pixelsPerMeter,
    };
  }

  private worldToScreenX(worldX: number): number {
    return (
      GameConfig.worldAnchorScreenX +
      (worldX - this.camera.x) * GameConfig.pixelsPerMeter
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
