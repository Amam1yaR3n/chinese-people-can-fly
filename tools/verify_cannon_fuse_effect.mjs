import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const [{ Game }, { GameConfig }] = await Promise.all([
    server.ssrLoadModule("/src/game/game.ts"),
    server.ssrLoadModule("/src/game/config.ts"),
  ]);

  const cannonLoaded = { width: 1365, height: 1126, id: "cannon-loaded" };
  const cannonEmpty = { width: 1000, height: 854, id: "cannon-empty" };
  const flame1 = { width: 256, height: 256, id: "flame-1" };
  const flame2 = { width: 256, height: 256, id: "flame-2" };
  const smoke = { width: 512, height: 512, id: "cannon-smoke" };
  const effectSprites = {
    impactFlash: { width: 256, height: 256, id: "impact-flash" },
    humanCannonFuseFlames: [flame1, flame2],
    humanCannonSmoke: smoke,
  };
  const game = new Game(
    () => {},
    null,
    null,
    { empty: cannonEmpty, loaded: cannonLoaded },
    null,
    "humanCannon",
    effectSprites,
  );

  let drawCalls = [];
  const context = new Proxy(
    {
      createLinearGradient: () => ({ addColorStop() {} }),
      drawImage: (...args) => drawCalls.push(args),
    },
    {
      get: (target, property) => target[property] ?? (() => {}),
      set: (target, property, value) => {
        target[property] = value;
        return true;
      },
    },
  );

  game.drawHumanCannonScene(context);
  assert.deepEqual(
    drawCalls.map(([image]) => image.id),
    ["cannon-loaded"],
    "The flame must stay hidden before ignition.",
  );

  game.action();
  assert.equal(game.humanCannon.state, "lit");
  drawCalls = [];
  game.drawHumanCannonScene(context);
  assert.deepEqual(
    drawCalls.map(([image]) => image.id),
    ["cannon-loaded", "flame-1"],
    "The first flame frame must appear with the power bar.",
  );

  const flameCall = drawCalls[1];
  const expectedScale =
    GameConfig.humanCannon.fuseFlameSize / flame1.width;
  assert.equal(flameCall[3], flame1.width * expectedScale);
  assert.equal(flameCall[4], flame1.height * expectedScale);

  game.humanCannon.elapsed =
    GameConfig.humanCannon.fuseFlameFrameDuration;
  drawCalls = [];
  game.drawHumanCannonScene(context);
  assert.deepEqual(
    drawCalls.map(([image]) => image.id),
    ["cannon-loaded", "flame-2"],
    "The second frame must replace the first after one frame duration.",
  );

  game.action();
  assert.equal(game.humanCannon.state, "fired");
  drawCalls = [];
  game.drawHumanCannonScene(context);
  assert.deepEqual(
    drawCalls.map(([image]) => image.id),
    ["cannon-empty", "cannon-smoke"],
    "The flame must disappear and the launch smoke must appear after firing.",
  );

  const smokeCall = drawCalls[1];
  assert.equal(smokeCall[3], GameConfig.humanCannon.smokeStartWidth);
  assert.equal(smokeCall[4], GameConfig.humanCannon.smokeStartWidth);

  game.humanCannon.elapsed = GameConfig.humanCannon.smokeDuration;
  drawCalls = [];
  game.drawHumanCannonScene(context);
  assert.deepEqual(
    drawCalls.map(([image]) => image.id),
    ["cannon-empty"],
    "The launch smoke must disappear when its animation finishes.",
  );

  console.log("Human cannon effects verification passed.");
} finally {
  await server.close();
}
