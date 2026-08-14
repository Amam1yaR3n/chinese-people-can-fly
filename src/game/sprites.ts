import type { Vec2 } from "./types";

export interface CharacterSprites {
  readonly image: HTMLImageElement;
}

interface AtlasFrame {
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

const frame = (
  x: number,
  y: number,
  width: number,
  height: number,
): AtlasFrame => ({ x, y, width, height });

export const FlyerPoses = {
  airborne: {
    frame: frame(531, 1404, 1286, 683),
    anchor: { x: 643, y: 342 },
    scale: 0.068,
  },
  lantern: {
    frame: frame(8, 2095, 254, 812),
    // The physics center follows the person rather than the lantern envelope.
    anchor: { x: 127, y: 548 },
    scale: 0.17,
  },
  sliding: {
    frame: frame(270, 2095, 661, 251),
    // The player center is 24 px above the ground; this keeps the belly on it.
    anchor: { x: 331, y: 73 },
    scale: 0.135,
  },
  falling: {
    frame: frame(939, 2095, 270, 585),
    anchor: { x: 135, y: 293 },
    scale: 0.15,
  },
  jet: {
    frame: frame(8, 2915, 902, 1069),
    anchor: { x: 451, y: 534.5 },
    scale: 0.11,
  },
} as const satisfies Record<string, SpritePose>;

export const MinePose = {
  frame: frame(918, 2915, 1098, 411),
  // The visible bottom edge sits on the ground; the remaining pixels are padding.
  anchor: { x: 549, y: 399 },
  scale: 0.052,
} as const satisfies SpritePose;

const BATTER_SCALE = 0.145;

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
