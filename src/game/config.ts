const DEG = Math.PI / 180;

// 飞行角色与四大装置的统一视觉放大倍率。仅改变绘制尺寸，不改变物理判定
// （拾取半径、地雷碰撞、弹弓拖拽热区等）；附着在装置上的世界锚点按锚点等比放大。
const VISUAL_SCALE = 1.4;
const MISSILE_TRUCK_VISUAL_SCALE = 1.2;
const MISSILE_TRUCK_SCALE = VISUAL_SCALE * MISSILE_TRUCK_VISUAL_SCALE;

const WHEEL_WORLD = { x: 0, y: -5.7 };
const MUZZLE_WORLD = { x: 13.35, y: -16.42 };
const FUSE_WORLD = { x: -8.2, y: -12.3 };
const POWER_BAR_WORLD = { x: 4.62, y: -27.18 };
const MISSILE_LOADED_WORLD = { x: 5.25, y: -20.4 };

const scaleAround = (
  anchor: { readonly x: number; readonly y: number },
  point: { readonly x: number; readonly y: number },
  factor: number,
): { x: number; y: number } => ({
  x: anchor.x + (point.x - anchor.x) * factor,
  y: anchor.y + (point.y - anchor.y) * factor,
});

export const GameConfig = {
  logicalWidth: 1600,
  logicalHeight: 900,
  pixelsPerMeter: 6,
  groundScreenY: 780,
  worldAnchorScreenX: 300,
  // One third in from the left edge, leaving most of the view ahead (right).
  followScreenX: 540,
  fixedStep: 1 / 120,
  maxFrameDelta: 0.05,
  visualScale: VISUAL_SCALE,

  initialFallGravity: 38,
  gravity: 38,
  launchSpeed: 150,
  launchAngleMin: 15 * DEG,
  launchAngleMax: 75 * DEG,
  groundFriction: 36,
  stopSpeed: 1.5,

  player: {
    width: 5.5,
    height: 8,
    startX: 0,
    startY: -100,
    // 仅放大飞行、下落、孔明灯和肚皮滑行姿态，不影响物理尺寸。
    poseVisualScale: 1.2,
  },

  hitter: {
    x: -7.5,
    width: 6,
    height: 16,
  },

  swing: {
    duration: 0.4,
    frameCount: 8,
    followThroughStart: 0.2,
    thickness: 1.2,
    // 击飞判定窗口：角色中心落在这个竖直区间内时按下即命中（区间越大越容易）。
    launchWindowTopY: -40,
    launchWindowBottomY: -5,
    impactFlashDuration: 0.14,
    impactFlashRadius: 30.8,
  },

  slingshot: {
    forkWorldX: 23.333,
    frameSize: 220 * VISUAL_SCALE,
    frameTopSliceRatio: 0.52,
    backTipWorld: { x: 27.7, y: -28.35 },
    frontTipWorld: { x: 19.08, y: -28.35 },
    restPouchWorld: { x: 3.6, y: -25.4 },
    seatedOffset: { x: 30.5, y: -14.4 },
    seatedSize: 97 * VISUAL_SCALE,
    pouchWidth: 54 * VISUAL_SCALE,
    pouchHeight: 29 * VISUAL_SCALE,
    hotspotRadius: 108,
    maximumPull: 150,
    minimumPull: 36,
    minimumSpeed: 70,
    maximumSpeed: 180,
    minimumAngle: -80 * DEG,
    maximumAngle: 80 * DEG,
    cancelReturnDuration: 0.18,
    recoilOvershootDuration: 0.14,
    recoilDuration: 0.4,
    maximumSeatedTilt: 8 * DEG,
    limitPulseDuration: 0.12,
  },

  humanCannon: {
    wheelWorld: WHEEL_WORLD,
    muzzleWorld: scaleAround(WHEEL_WORLD, MUZZLE_WORLD, VISUAL_SCALE),
    fuseWorld: scaleAround(WHEEL_WORLD, FUSE_WORLD, VISUAL_SCALE),
    powerBarWorld: scaleAround(WHEEL_WORLD, POWER_BAR_WORLD, VISUAL_SCALE),
    loadedAnchor: { x: 558, y: 776 },
    emptyAnchor: { x: 500, y: 560 },
    spriteScale: 0.123 * VISUAL_SCALE,
    powerBarWidth: 160 * VISUAL_SCALE,
    powerBarHeight: 20 * VISUAL_SCALE,
    sweepDuration: 0.4,
    fuseFlameSize: 48,
    fuseFlameFrameDuration: 0.12,
    fuseFlameAnchor: { x: 128, y: 224 },
    // Let the bottom of the flame sit slightly inside the fuse tip.
    fuseFlameOffset: { x: 2, y: 3 },
    minimumSpeed: 50,
    maximumSpeed: 220,
    launchAngle: 26 * DEG,
    recoilDuration: 0.45,
    recoilDistance: 5 * VISUAL_SCALE,
    smokeDuration: 0.65,
    // The source image's left-center tip stays pinned to the cannon muzzle.
    smokeAnchor: { x: 32, y: 256 },
    smokeStartWidth: 92 * VISUAL_SCALE,
    smokeEndWidth: 122 * VISUAL_SCALE,
    smokeTravelDistance: 30 * VISUAL_SCALE,
  },

  missileTruck: {
    groundWorld: { x: 0, y: 0 },
    // 两张车图都以车轮可见底边为地面锚点，缩放时车轮保持贴地。
    emptyAnchor: { x: 200, y: 621 },
    emptyScale: 0.25 * MISSILE_TRUCK_SCALE,
    loadedAnchor: { x: 319, y: 973 },
    loadedScale: 0.15867 * MISSILE_TRUCK_SCALE,
    visualScale: MISSILE_TRUCK_VISUAL_SCALE,
    loadedWorld: scaleAround(
      { x: 0, y: 0 },
      MISSILE_LOADED_WORLD,
      MISSILE_TRUCK_SCALE,
    ),
    launchWorld: scaleAround(
      { x: 0, y: 0 },
      MISSILE_LOADED_WORLD,
      MISSILE_TRUCK_SCALE,
    ),
    rackAngle: 26 * DEG,
    launchSpeed: 260,
    launchAngle: 22 * DEG,
    tailFlameDuration: 1.2,
    tailFlameWidth: 72,
    tailFlameAnchor: { x: 1643, y: 454 },
    tailFlameFootOffset: { x: -54, y: 12 },
  },

  skip: {
    approachWindow: 0.5,
    preImpactWindow: 0.1,
    postImpactWindow: 0.12,
    horizontalRetention: 0.88,
    verticalRetention: 0.6,
    minImpactSpeed: 150 * 0.3,
  },

  mine: {
    safeDistance: 150,
    firstMin: 420,
    firstMax: 650,
    intervalMin: 250,
    intervalMax: 900,
    signClearance: 12,
    // Match the current sprite's visible alpha bounds, including its 1.5px outline.
    width: 11.6696,
    height: 4.5248,
    spriteOutlineWidth: 1.5,
    horizontalMultiplier: 1.1,
    minimumHorizontalBoost: 120,
    verticalBoost: 90,
    generationAhead: 1100,
  },

  pickup: {
    safeDistance: 150,
    firstMaxDistance: 250,
    intervalMin: 200,
    intervalMax: 380,
    generationAhead: 1100,
    cleanupBehind: 320,
    radius: 20,
    magnetSpeed: 500,
    magnetCollectDistance: 2,
    // 未拾取道具的上下漂浮动效（屏幕像素与频率）。
    floatAmplitude: 7,
    floatFrequency: 0.6,
    redPacket: {
      weight: 0,
      minAltitude: 20,
      maxAltitude: 110,
      width: 8,
      height: 6,
    },
    skyLantern: {
      weight: 0.36,
      minAltitude: 20,
      maxAltitude: 110,
      width: 7,
      height: 10,
    },
    sixthGenJet: {
      weight: 0.36,
      minAltitude: 40,
      maxAltitude: 120,
      width: 18,
      height: 7,
    },
    ufo: {
      weight: 0.28,
      minAltitude: 65,
      maxAltitude: 120,
      width: 11,
      height: 7,
    },
  },

  powerUp: {
    lantern: {
      ascentDistance: 90,
      ascentSpeed: 30,
    },
    jet: {
      duration: 3.5,
      speed: 150,
      exitSpeed: 120,
      trailExhaustOffsetX: 43 * VISUAL_SCALE,
      trailEngineOffsetY: 4.5 * VISUAL_SCALE,
      trailWidth: 6 * VISUAL_SCALE,
      trailPuffSpacing: 7 * VISUAL_SCALE,
      trailPuffRadius: 5.5 * VISUAL_SCALE,
    },
    ufo: {
      duration: 5,
      speed: 120,
      exitSpeed: 120,
      displayWidth: 25 * VISUAL_SCALE,
      displayHeight: (50 / 3) * VISUAL_SCALE,
      lightBlinkInterval: 0.18,
      // 磁吸收集的目标点，不随视觉缩放。
      emitterOffsetY: 5.5,
      beamTopWidth: 5.5 * VISUAL_SCALE,
      beamSpreadAngle: Math.PI / 18,
      beamTopCapHeight: 1.1 * VISUAL_SCALE,
      beamGroundCapHeight: 2.1 * VISUAL_SCALE,
    },
  },

  signs: {
    interval: 200,
  },

  camera: {
    followRate: 6,
    verticalFollowRate: 6,
    verticalFollowScreenY: 260,
    shakeDuration: 0.28,
    shakeStrength: 10,
  },

  background: {
    skyColor: "#a9ddeb",
    sunScreen: { x: 1410, y: 190 },
    // Higher clouds drift more slowly; lower clouds move faster for depth.
    cloudParallaxes: [0.035, 0.05, 0.08, 0.065],
    cloudCycleWidth: 2300,
    cloudScreens: [
      { x: 180, y: 155 },
      { x: 680, y: 300 },
      { x: 1120, y: 420 },
      { x: 1540, y: 350 },
    ],
    midgroundParallax: 0.14,
    midgroundVerticalParallax: 0.16,
    midgroundBottomScreenY: 930,
    midgroundScale: 1,
    groundSourceTop: 630,
    groundSurfaceY: 661,
    groundTileScale: 1,
  },

  palette: {
    sky: "#bde9ff",
    skyDeep: "#8ed8f5",
    sun: "#ffd45c",
    cloud: "#fffdf5",
    ground: "#f1d39b",
    groundTop: "#3e9b65",
    groundDark: "#ca9b5d",
    ink: "#142033",
    player: "#eb4d4b",
    playerEdge: "#a92e35",
    hitter: "#2869d8",
    hitterEdge: "#17499b",
    club: "#142033",
    clubHead: "#fffdf5",
    sign: "#fffdf5",
    mine: "#d92f39",
    mineDark: "#7f1d2d",
    explosion: "#ff9f1c",
    explosionLight: "#ffe04a",
    redPacket: "#ef3340",
    redPacketDark: "#b91c2b",
    gold: "#ffc83d",
    lanternOrange: "#ff5a1f",
    lanternYellow: "#ffd166",
    jet: "#4b5563",
    jetLight: "#94a3b8",
    jetAccent: "#e3343f",
    ufo: "#d6d7df",
    ufoDark: "#8f96a8",
    ufoLight: "#18d8d3",
    ufoScreen: "#ffdc63",
  },
} as const;
