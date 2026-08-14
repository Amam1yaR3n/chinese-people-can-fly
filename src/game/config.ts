const DEG = Math.PI / 180;

export const GameConfig = {
  logicalWidth: 1600,
  logicalHeight: 900,
  pixelsPerMeter: 6,
  groundScreenY: 780,
  worldAnchorScreenX: 1300,
  // One third in from the right edge, leaving most of the view ahead (left).
  followScreenX: 1060,
  fixedStep: 1 / 120,
  maxFrameDelta: 0.05,

  initialFallGravity: 38,
  gravity: 38,
  launchSpeed: 150,
  launchAngleMin: 15 * DEG,
  launchAngleMax: 75 * DEG,
  groundFriction: 24,
  stopSpeed: 1.5,

  player: {
    width: 5.5,
    height: 8,
    startX: 0,
    startY: -100,
  },

  hitter: {
    x: 7.5,
    width: 6,
    height: 16,
  },

  swing: {
    duration: 0.4,
    frameCount: 8,
    followThroughStart: 0.2,
    thickness: 1.2,
    launchWindowTopY: -28,
    launchWindowBottomY: -9,
  },

  skip: {
    approachWindow: 0.5,
    preImpactWindow: 0.1,
    postImpactWindow: 0.12,
    horizontalRetention: 0.8,
    verticalRetention: 0.8,
    minImpactSpeed: 150 * 0.3,
  },

  mine: {
    safeDistance: 150,
    firstMin: 420,
    firstMax: 650,
    intervalMin: 250,
    intervalMax: 900,
    signClearance: 12,
    width: 7,
    height: 2.8,
    horizontalMultiplier: 1.1,
    minimumHorizontalBoost: 120,
    verticalBoost: 90,
    generationAhead: 1100,
  },

  pickup: {
    safeDistance: 150,
    firstMaxDistance: 250,
    intervalMin: 100,
    intervalMax: 190,
    generationAhead: 1100,
    cleanupBehind: 320,
    radius: 20,
    magnetSpeed: 500,
    magnetCollectDistance: 2,
    redPacket: {
      weight: 0.5,
      minAltitude: 20,
      maxAltitude: 110,
      width: 8,
      height: 6,
    },
    skyLantern: {
      weight: 0.3,
      minAltitude: 20,
      maxAltitude: 110,
      width: 7,
      height: 10,
    },
    sixthGenJet: {
      weight: 0.2,
      minAltitude: 65,
      maxAltitude: 120,
      width: 18,
      height: 7,
    },
  },

  powerUp: {
    lantern: {
      ascentDistance: 90,
      ascentSpeed: 30,
    },
    jet: {
      travelDistance: 600,
      speed: 150,
      exitSpeed: 120,
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
  },
} as const;
