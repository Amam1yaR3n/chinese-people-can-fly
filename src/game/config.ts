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

  gravity: 38,
  launchSpeed: 150,
  launchAngleMin: 15 * DEG,
  launchAngleMax: 75 * DEG,
  groundFriction: 18,
  stopSpeed: 1.5,

  player: {
    width: 5.5,
    height: 8,
    startX: 0,
    startY: -100,
  },

  hitter: {
    x: 18,
    width: 6,
    height: 16,
  },

  club: {
    pivot: { x: 16, y: -13 },
    length: 22,
    thickness: 1.2,
    activeStartRatio: 0.55,
    idleAngle: -55 * DEG,
    downswingEndAngle: 190 * DEG,
    followEndAngle: 230 * DEG,
    launchMapStartAngle: 140 * DEG,
    launchMapEndAngle: 190 * DEG,
    downswingDuration: 0.18,
    followDuration: 0.22,
  },

  skip: {
    approachWindow: 0.5,
    preImpactWindow: 0.1,
    postImpactWindow: 0.12,
    horizontalRetention: 0.82,
    verticalRetention: 0.82,
    minImpactSpeed: 150 * 0.3,
  },

  mine: {
    safeDistance: 150,
    firstMin: 420,
    firstMax: 650,
    intervalMin: 450,
    intervalMax: 850,
    signClearance: 12,
    width: 7,
    height: 2.8,
    horizontalMultiplier: 1.12,
    minimumHorizontalBoost: 125,
    verticalBoost: 72,
    generationAhead: 1100,
  },

  signs: {
    interval: 200,
  },

  camera: {
    followRate: 6,
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
  },
} as const;
