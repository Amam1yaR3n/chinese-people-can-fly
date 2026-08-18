import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createServer } from "vite";

const paeth = (left, above, upperLeft) => {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
};

const decodeRgbaPng = (path) => {
  const file = readFileSync(path);
  assert.deepEqual(
    [...file.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "Ground tile must be a PNG.",
  );

  let offset = 8;
  let width = 0;
  let height = 0;
  const imageData = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "Ground tile must use 8-bit channels.");
      assert.equal(data[9], 6, "Ground tile must preserve an RGBA channel.");
      assert.equal(data[12], 0, "Ground tile must not be interlaced.");
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  const bytesPerPixel = 4;
  const rowWidth = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(imageData));
  const pixels = Buffer.alloc(rowWidth * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * rowWidth;
    const previousRowOffset = rowOffset - rowWidth;
    for (let x = 0; x < rowWidth; x += 1) {
      const raw = filtered[sourceOffset + x];
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[previousRowOffset + x] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels[previousRowOffset + x - bytesPerPixel]
          : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else assert.equal(filter, 0, `Unsupported PNG filter ${filter}.`);
      pixels[rowOffset + x] = (raw + predictor) & 0xff;
    }
    sourceOffset += rowWidth;
  }
  return { width, height, pixels };
};

const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const [{ Game }, { GameConfig }, { BackgroundPoses }] = await Promise.all([
    server.ssrLoadModule("/src/game/game.ts"),
    server.ssrLoadModule("/src/game/config.ts"),
    server.ssrLoadModule("/src/game/sprites.ts"),
  ]);

  assert.equal(BackgroundPoses.clouds.length, 4);
  assert.equal(
    GameConfig.background.cloudParallaxes.length,
    BackgroundPoses.clouds.length,
  );
  assert.equal(
    new Set(GameConfig.background.cloudParallaxes).size,
    BackgroundPoses.clouds.length,
    "Every far cloud must use a distinct scrolling speed.",
  );

  const groundTilePixels = decodeRgbaPng(
    new URL("../assets/backgrounds/ground-tile-v8.png", import.meta.url),
  );
  assert.equal(groundTilePixels.width, 1671);
  assert.equal(groundTilePixels.height, 941);
  for (let offset = 0; offset < groundTilePixels.pixels.length; offset += 4) {
    if (groundTilePixels.pixels[offset + 3] === 0) {
      assert.equal(
        groundTilePixels.pixels[offset] |
          groundTilePixels.pixels[offset + 1] |
          groundTilePixels.pixels[offset + 2],
        0,
        "Transparent ground pixels must not retain checkerboard RGB data.",
      );
    }
  }
  for (let y = 0; y < groundTilePixels.height; y += 1) {
    const leftOffset = y * groundTilePixels.width * 4;
    const rightOffset = leftOffset + (groundTilePixels.width - 1) * 4;
    assert.deepEqual(
      groundTilePixels.pixels.subarray(leftOffset, leftOffset + 4),
      groundTilePixels.pixels.subarray(rightOffset, rightOffset + 4),
      `Ground tile edges must match at row ${y}.`,
    );
  }

  const backgroundSprites = {
    farAtlas: { width: 1672, height: 941, id: "far" },
    midground: { width: 2172, height: 724, id: "midground" },
    groundTile: { width: 1671, height: 941, id: "ground" },
  };
  const game = new Game(
    () => {},
    null,
    null,
    null,
    null,
    "blackEagle",
    null,
    backgroundSprites,
  );

  let drawCalls = [];
  let transform = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const transformStack = [];
  const context = new Proxy(
    {
      save: () => {
        transformStack.push({ ...transform });
      },
      restore: () => {
        transform = transformStack.pop() ?? { x: 0, y: 0 };
      },
      translate: (x, y) => {
        transform.x += x;
        transform.y += y;
      },
      scale: (x, y) => {
        transform.scaleX *= x;
        transform.scaleY *= y;
      },
      drawImage: (...args) => {
        drawCalls.push({ args, image: args[0], transform: { ...transform } });
      },
    },
    {
      get: (target, property) => target[property] ?? (() => {}),
      set: (target, property, value) => {
        target[property] = value;
        return true;
      },
    },
  );

  const renderAt = (cameraX, cameraY = 0) => {
    game.camera.x = cameraX;
    game.camera.y = cameraY;
    drawCalls = [];
    transform = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
    transformStack.length = 0;
    game.render(context);
    return drawCalls;
  };

  const initialSnapshot = game.getSnapshot();
  const atOrigin = renderAt(0);
  assert.deepEqual(game.getSnapshot(), initialSnapshot);

  const farCalls = atOrigin.filter(({ image }) => image.id === "far");
  assert.equal(farCalls.length, 5, "One sun and four clouds must be drawn.");
  assert.equal(
    farCalls.filter(({ args }) => args[1] === BackgroundPoses.sun.frame.x)
      .length,
    1,
    "The fixed sun must be drawn exactly once.",
  );

  const firstGroundIndex = atOrigin.findIndex(
    ({ image }) => image.id === "ground",
  );
  const firstMidgroundIndex = atOrigin.findIndex(
    ({ image }) => image.id === "midground",
  );
  assert.ok(firstMidgroundIndex > 4);
  assert.ok(firstGroundIndex > firstMidgroundIndex);

  const sunAtOrigin = farCalls.find(
    ({ args }) => args[1] === BackgroundPoses.sun.frame.x,
  );
  const cloudsAtOrigin = BackgroundPoses.clouds.map((pose) =>
    farCalls.find(({ args }) => args[1] === pose.frame.x),
  );
  const atOneHundred = renderAt(100);
  const sunAtOneHundred = atOneHundred.find(
    ({ image, args }) =>
      image.id === "far" && args[1] === BackgroundPoses.sun.frame.x,
  );
  const cloudsAtOneHundred = BackgroundPoses.clouds.map((pose) =>
    atOneHundred.find(
      ({ image, args }) => image.id === "far" && args[1] === pose.frame.x,
    ),
  );
  const groundAtOneHundred = atOneHundred.find(
    ({ image }) => image.id === "ground",
  );
  const midgroundAtOrigin = atOrigin.find(
    ({ image }) => image.id === "midground",
  );
  const midgroundAtOneHundred = atOneHundred.find(
    ({ image }) => image.id === "midground",
  );

  assert.equal(sunAtOneHundred.transform.x, sunAtOrigin.transform.x);
  for (let index = 0; index < BackgroundPoses.clouds.length; index += 1) {
    const actualDelta =
      cloudsAtOneHundred[index].transform.x -
      cloudsAtOrigin[index].transform.x;
    const expectedDelta =
      -100 *
      GameConfig.pixelsPerMeter *
      GameConfig.background.cloudParallaxes[index];
    assert.ok(
      Math.abs(actualDelta - expectedDelta) < 1e-9,
      `Cloud ${index + 1} must use its configured scrolling speed.`,
    );
  }
  assert.equal(
    groundAtOneHundred.args[5],
    -100 * GameConfig.pixelsPerMeter,
  );
  const groundCallsAtOneHundred = atOneHundred.filter(
    ({ image }) => image.id === "ground",
  );
  assert.ok(groundCallsAtOneHundred.length >= 2);
  assert.equal(
    groundCallsAtOneHundred[1].args[5] - groundCallsAtOneHundred[0].args[5],
    backgroundSprites.groundTile.width * GameConfig.background.groundTileScale,
  );
  assert.ok(
    groundCallsAtOneHundred[0].args[7] >=
      backgroundSprites.groundTile.width *
        GameConfig.background.groundTileScale +
        1,
    "Ground tiles must overlap to avoid subpixel seams.",
  );
  assert.ok(
    Math.abs(
      midgroundAtOneHundred.args[1] -
        midgroundAtOrigin.args[1] -
        -100 *
          GameConfig.pixelsPerMeter *
          GameConfig.background.midgroundParallax,
    ) < 1e-9,
    "The midground must use its configured horizontal parallax.",
  );

  const lanternCameraY = -125;
  const raisedView = renderAt(0, lanternCameraY);
  const raisedMidground = raisedView.find(
    ({ image }) => image.id === "midground",
  );
  const raisedMidgroundTop = raisedMidground.args[2];
  const raisedMidgroundBottom =
    raisedMidgroundTop + raisedMidground.args[4];
  assert.ok(
    raisedMidgroundTop < GameConfig.logicalHeight / 2,
    "The mountain layer must remain visible at maximum lantern camera lift.",
  );
  assert.ok(
    raisedMidgroundBottom >= GameConfig.logicalHeight,
    "The forest layer must continue below the viewport during camera lift.",
  );

  const mirroredCameraX =
    (backgroundSprites.midground.width + 100) /
    (GameConfig.pixelsPerMeter *
      GameConfig.background.midgroundParallax);
  const mirroredView = renderAt(mirroredCameraX);
  const mirroredMidground = mirroredView.find(
    ({ image }) => image.id === "midground",
  );
  assert.equal(
    mirroredMidground.transform.scaleX,
    -1,
    "Alternating mirrored tiles must hide the source image's unequal edges.",
  );

  const farAway = renderAt(20_000);
  assert.equal(
    farAway.filter(
      ({ image, args }) =>
        image.id === "far" && args[1] === BackgroundPoses.sun.frame.x,
    ).length,
    1,
  );
  assert.ok(farAway.some(({ image }) => image.id === "ground"));

  console.log("Background layer verification passed.");
} finally {
  await server.close();
}
