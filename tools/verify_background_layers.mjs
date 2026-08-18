import assert from "node:assert/strict";
import { createServer } from "vite";

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

  const backgroundSprites = {
    farAtlas: { width: 1672, height: 941, id: "far" },
    groundTile: { width: 1672, height: 941, id: "ground" },
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
  let transform = { x: 0, y: 0 };
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
    transform = { x: 0, y: 0 };
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
  assert.ok(firstGroundIndex > 4);

  const sunAtOrigin = farCalls.find(
    ({ args }) => args[1] === BackgroundPoses.sun.frame.x,
  );
  const cloudAtOrigin = farCalls.find(
    ({ args }) => args[1] === BackgroundPoses.clouds[0].frame.x,
  );
  const atOneHundred = renderAt(100);
  const sunAtOneHundred = atOneHundred.find(
    ({ image, args }) =>
      image.id === "far" && args[1] === BackgroundPoses.sun.frame.x,
  );
  const cloudAtOneHundred = atOneHundred.find(
    ({ image, args }) =>
      image.id === "far" && args[1] === BackgroundPoses.clouds[0].frame.x,
  );
  const groundAtOneHundred = atOneHundred.find(
    ({ image }) => image.id === "ground",
  );

  assert.equal(sunAtOneHundred.transform.x, sunAtOrigin.transform.x);
  assert.equal(
    cloudAtOneHundred.transform.x - cloudAtOrigin.transform.x,
    -100 * GameConfig.pixelsPerMeter * GameConfig.background.cloudParallax,
  );
  assert.equal(
    groundAtOneHundred.args[5],
    -100 * GameConfig.pixelsPerMeter,
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
