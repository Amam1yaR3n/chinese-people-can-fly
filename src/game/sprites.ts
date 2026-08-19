import { GameConfig } from "./config";
import type { Vec2 } from "./types";

export interface CharacterSprites {
  readonly image: HTMLImageElement;
}

export interface SlingshotSprites {
  readonly frame: HTMLImageElement;
  readonly seatedFlyer: HTMLImageElement;
}

export interface HumanCannonSprites {
  readonly empty: HTMLImageElement;
  readonly loaded: HTMLImageElement;
}

export interface MissileTruckSprites {
  readonly empty: HTMLImageElement;
  readonly loaded: HTMLImageElement;
}

export interface EffectSprites {
  readonly impactFlash: HTMLImageElement;
  readonly humanCannonFuseFlames: readonly [
    HTMLImageElement,
    HTMLImageElement,
  ];
  readonly humanCannonSmoke: HTMLImageElement;
  readonly missileTailFlame: HTMLImageElement;
}

export interface BackgroundSprites {
  readonly farAtlas: HTMLImageElement;
  readonly midground: HTMLImageElement;
  readonly groundTile: HTMLImageElement;
}

export interface AtlasFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SpritePose {
  readonly frame: AtlasFrame;
  readonly anchor: Vec2;
  readonly scale: number;
}

export interface BatterFrame extends SpritePose {
  readonly club?: {
    readonly grip: Vec2;
    readonly head: Vec2;
  };
}

const CHARACTER_ATLAS_PATH = "./assets/characters/atlas/characters.png";
const SLINGSHOT_FRAME_PATH =
  "./assets/characters/launchers/slingshot-frame.png";
const SLINGSHOT_SEATED_PATH =
  "./assets/characters/flyer/slingshot-seated.png";
const HUMAN_CANNON_EMPTY_PATH =
  "./assets/characters/launchers/human-cannon.png";
const HUMAN_CANNON_LOADED_PATH =
  "./assets/characters/launchers/human-cannon-loaded-v1.png";
const MISSILE_TRUCK_PATH =
  "./assets/characters/launchers/missile-truck.png";
const MISSILE_TRUCK_LOADED_PATH =
  "./assets/characters/launchers/missile-truck-loaded-review-v1.png";
const IMPACT_FLASH_PATH = "./assets/effects/impact-flash.png";
const HUMAN_CANNON_FUSE_FLAME_PATHS = [
  "./assets/effects/human-cannon-fuse-flame-1.png",
  "./assets/effects/human-cannon-fuse-flame-2.png",
] as const;
const HUMAN_CANNON_SMOKE_PATH =
  "./assets/effects/human-cannon-launch-smoke.png";
const MISSILE_TAIL_FLAME_PATH =
  "./assets/effects/missile-player-tail-flame.png";
const BACKGROUND_FAR_ATLAS_PATH = "./assets/backgrounds/far-atlas.png";
const BACKGROUND_MIDGROUND_PATH =
  "./assets/backgrounds/china-mountain-forest-midground.png";
const BACKGROUND_GROUND_TILE_PATH =
  "./assets/backgrounds/ground-tile-v8.png";

const frame = (
  x: number,
  y: number,
  width: number,
  height: number,
): AtlasFrame => ({ x, y, width, height });

export const BackgroundPoses = {
  sun: {
    frame: frame(100, 70, 360, 360),
    anchor: { x: 180, y: 180 },
    scale: 0.52,
  },
  clouds: [
    {
      frame: frame(590, 80, 540, 320),
      anchor: { x: 270, y: 160 },
      scale: 0.65,
    },
    {
      frame: frame(1210, 170, 390, 240),
      anchor: { x: 195, y: 120 },
      scale: 0.58,
    },
    {
      frame: frame(20, 480, 640, 340),
      anchor: { x: 320, y: 170 },
      scale: 0.6,
    },
    {
      frame: frame(630, 480, 610, 360),
      anchor: { x: 305, y: 180 },
      scale: 0.56,
    },
  ],
} as const satisfies {
  readonly sun: SpritePose;
  readonly clouds: readonly SpritePose[];
};

export const FlyerPoses = {
  airborne: {
    frame: frame(531, 1404, 1286, 683),
    anchor: { x: 643, y: 342 },
    scale:
      0.068 * GameConfig.visualScale * GameConfig.player.poseVisualScale,
  },
  lantern: {
    frame: frame(8, 2095, 254, 812),
    // The physics center follows the person rather than the lantern envelope.
    anchor: { x: 127, y: 548 },
    scale:
      0.17 * GameConfig.visualScale * GameConfig.player.poseVisualScale,
  },
  sliding: {
    frame: frame(270, 2095, 661, 251),
    // 放大后仍保持腹部贴地：底边相对物理中心固定为半个角色高度。
    anchor: {
      x: 331,
      y:
        251 -
        (GameConfig.player.height / 2) *
          GameConfig.pixelsPerMeter /
          (0.135 *
            GameConfig.visualScale *
            GameConfig.player.poseVisualScale),
    },
    scale:
      0.135 * GameConfig.visualScale * GameConfig.player.poseVisualScale,
  },
  falling: {
    frame: frame(939, 2095, 270, 585),
    anchor: { x: 135, y: 293 },
    scale:
      0.15 * GameConfig.visualScale * GameConfig.player.poseVisualScale,
  },
  jet: {
    frame: frame(8, 2915, 902, 1069),
    anchor: { x: 451, y: 534.5 },
    scale: 0.11 * GameConfig.visualScale,
  },
  ufo: {
    frame: frame(918, 2915, 600, 400),
    anchor: { x: 300, y: 200 },
    scale: 0.25 * GameConfig.visualScale,
  },
  ufoLightsOn: {
    frame: frame(8, 3992, 600, 400),
    anchor: { x: 300, y: 200 },
    scale: 0.25 * GameConfig.visualScale,
  },
} as const satisfies Record<string, SpritePose>;

export const MinePose = {
  frame: frame(616, 3992, 1098, 411),
  // The visible bottom edge sits on the ground; the remaining pixels are padding.
  anchor: { x: 549, y: 399 },
  scale: 0.052 * 1.2,
} as const satisfies SpritePose;

export const PickupPoses = {
  ufo: {
    frame: frame(1722, 3992, 264, 168),
    anchor: { x: 132, y: 84 },
    scale: 0.25,
  },
} as const satisfies Record<string, SpritePose>;

const BATTER_SCALE = 0.145 * GameConfig.visualScale;

export const BatterFrames: readonly BatterFrame[] = [
  {
    frame: frame(8, 8, 408, 672),
    anchor: { x: 206, y: 660 },
    scale: BATTER_SCALE,
    club: { grip: { x: 352, y: 248 }, head: { x: 48, y: 48 } },
  },
  {
    frame: frame(424, 8, 450, 673),
    anchor: { x: 179, y: 661 },
    scale: BATTER_SCALE,
    club: { grip: { x: 329, y: 381 }, head: { x: 408, y: 43 } },
  },
  {
    frame: frame(882, 8, 575, 603),
    anchor: { x: 183, y: 591 },
    scale: BATTER_SCALE,
    club: { grip: { x: 337, y: 335 }, head: { x: 557, y: 206 } },
  },
  {
    frame: frame(1465, 8, 560, 619),
    anchor: { x: 191, y: 607 },
    scale: BATTER_SCALE,
    club: { grip: { x: 215, y: 413 }, head: { x: 474, y: 572 } },
  },
  {
    frame: frame(8, 689, 567, 707),
    anchor: { x: 249, y: 695 },
    scale: BATTER_SCALE,
  },
  {
    frame: frame(583, 689, 475, 673),
    anchor: { x: 237, y: 661 },
    scale: BATTER_SCALE,
  },
  {
    frame: frame(1066, 689, 513, 615),
    anchor: { x: 215, y: 603 },
    scale: BATTER_SCALE,
  },
  {
    frame: frame(8, 1404, 515, 606),
    anchor: { x: 213, y: 594 },
    scale: BATTER_SCALE,
  },
];

export const loadCharacterSprites = async (): Promise<CharacterSprites | null> => {
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener(
        "error",
        () => reject(new Error(`Unable to load ${CHARACTER_ATLAS_PATH}`)),
        { once: true },
      );
      image.src = new URL(CHARACTER_ATLAS_PATH, document.baseURI).href;
    });
    await image.decode();
    return { image };
  } catch (error) {
    console.error("Character sprites failed to load; using geometry fallback.", error);
    return null;
  }
};

const loadImage = async (path: string): Promise<HTMLImageElement> => {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error(`Unable to load ${path}`)),
      { once: true },
    );
    image.src = new URL(path, document.baseURI).href;
  });
  await image.decode();
  return image;
};

export const loadSlingshotSprites = async (): Promise<SlingshotSprites | null> => {
  try {
    const [frameImage, seatedFlyer] = await Promise.all([
      loadImage(SLINGSHOT_FRAME_PATH),
      loadImage(SLINGSHOT_SEATED_PATH),
    ]);
    return { frame: frameImage, seatedFlyer };
  } catch (error) {
    console.error(
      "Slingshot sprites failed to load; using geometry fallback.",
      error,
    );
    return null;
  }
};

export const loadHumanCannonSprites = async (): Promise<HumanCannonSprites | null> => {
  try {
    const [empty, loaded] = await Promise.all([
      loadImage(HUMAN_CANNON_EMPTY_PATH),
      loadImage(HUMAN_CANNON_LOADED_PATH),
    ]);
    return { empty, loaded };
  } catch (error) {
    console.error(
      "Human cannon sprites failed to load; using geometry fallback.",
      error,
    );
    return null;
  }
};

export const loadMissileTruckSprites = async (): Promise<MissileTruckSprites | null> => {
  try {
    const [empty, loaded] = await Promise.all([
      loadImage(MISSILE_TRUCK_PATH),
      loadImage(MISSILE_TRUCK_LOADED_PATH),
    ]);
    return { empty, loaded };
  } catch (error) {
    console.error(
      "Missile truck sprite failed to load; using geometry fallback.",
      error,
    );
    return null;
  }
};

export const loadEffectSprites = async (): Promise<EffectSprites | null> => {
  try {
    const [
      impactFlash,
      fuseFlame1,
      fuseFlame2,
      humanCannonSmoke,
      missileTailFlame,
    ] =
      await Promise.all([
        loadImage(IMPACT_FLASH_PATH),
        loadImage(HUMAN_CANNON_FUSE_FLAME_PATHS[0]),
        loadImage(HUMAN_CANNON_FUSE_FLAME_PATHS[1]),
        loadImage(HUMAN_CANNON_SMOKE_PATH),
        loadImage(MISSILE_TAIL_FLAME_PATH),
      ]);
    return {
      impactFlash,
      humanCannonFuseFlames: [fuseFlame1, fuseFlame2],
      humanCannonSmoke,
      missileTailFlame,
    };
  } catch (error) {
    console.error(
      "Effect sprites failed to load; using geometry fallback.",
      error,
    );
    return null;
  }
};

export const loadBackgroundSprites = async (): Promise<BackgroundSprites | null> => {
  try {
    const [farAtlas, midground, groundTile] = await Promise.all([
      loadImage(BACKGROUND_FAR_ATLAS_PATH),
      loadImage(BACKGROUND_MIDGROUND_PATH),
      loadImage(BACKGROUND_GROUND_TILE_PATH),
    ]);
    return { farAtlas, midground, groundTile };
  } catch (error) {
    console.error(
      "Background sprites failed to load; using geometry fallback.",
      error,
    );
    return null;
  }
};

export const drawAtlasPose = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  pose: SpritePose,
  screen: Vec2,
): void => {
  const { frame: source, anchor, scale } = pose;
  context.save();
  context.translate(screen.x, screen.y);
  context.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    -anchor.x * scale,
    -anchor.y * scale,
    source.width * scale,
    source.height * scale,
  );
  context.restore();
};

export const drawSpritePose = (
  context: CanvasRenderingContext2D,
  sprites: CharacterSprites,
  pose: SpritePose,
  screen: Vec2,
  options: { readonly rotation?: number; readonly flipX?: boolean } = {},
): void => {
  const { frame: source, anchor, scale } = pose;
  context.save();
  context.translate(screen.x, screen.y);
  context.rotate(options.rotation ?? 0);
  if (options.flipX) context.scale(-1, 1);
  context.drawImage(
    sprites.image,
    source.x,
    source.y,
    source.width,
    source.height,
    -anchor.x * scale,
    -anchor.y * scale,
    source.width * scale,
    source.height * scale,
  );
  context.restore();
};

export const drawOutlinedSpritePose = (
  context: CanvasRenderingContext2D,
  sprites: CharacterSprites,
  pose: SpritePose,
  screen: Vec2,
  outline: { readonly color: string; readonly width: number },
): void => {
  const offsets = [-outline.width, 0, outline.width];

  context.save();
  context.shadowBlur = 0;
  context.shadowColor = outline.color;
  for (const offsetY of offsets) {
    for (const offsetX of offsets) {
      if (offsetX === 0 && offsetY === 0) continue;
      context.shadowOffsetX = offsetX;
      context.shadowOffsetY = offsetY;
      drawSpritePose(context, sprites, pose, screen);
    }
  }

  context.shadowColor = "transparent";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  drawSpritePose(context, sprites, pose, screen);
  context.restore();
};
