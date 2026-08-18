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

  const characterImage = { width: 2048, height: 4403, id: "characters" };
  const tailFlameImage = { width: 1672, height: 941, id: "missile-flame" };
  const effectSprites = {
    impactFlash: { width: 1, height: 1, id: "impact" },
    humanCannonFuseFlames: [
      { width: 1, height: 1, id: "fuse-1" },
      { width: 1, height: 1, id: "fuse-2" },
    ],
    humanCannonSmoke: { width: 1, height: 1, id: "smoke" },
    missileTailFlame: tailFlameImage,
  };
  const game = new Game(
    () => {},
    { image: characterImage },
    null,
    null,
    null,
    "missileTruck",
    effectSprites,
  );

  let drawCalls = [];
  let transform = { x: 0, y: 0, rotation: 0 };
  const stack = [];
  const context = new Proxy(
    {
      save: () => stack.push({ ...transform }),
      restore: () => {
        transform = stack.pop() ?? { x: 0, y: 0, rotation: 0 };
      },
      translate: (x, y) => {
        transform.x += x;
        transform.y += y;
      },
      rotate: (angle) => {
        transform.rotation += angle;
      },
      scale: () => {},
      drawImage: (...args) =>
        drawCalls.push({ args, image: args[0], transform: { ...transform } }),
    },
    {
      get: (target, property) => target[property] ?? (() => {}),
      set: (target, property, value) => {
        target[property] = value;
        return true;
      },
    },
  );

  const render = () => {
    drawCalls = [];
    transform = { x: 0, y: 0, rotation: 0 };
    stack.length = 0;
    game.render(context);
    return drawCalls;
  };

  assert.equal(game.missileTailFlameRemaining, 0);
  game.action();
  assert.equal(game.getSnapshot().phase, "airborne");
  assert.equal(
    game.missileTailFlameRemaining,
    GameConfig.missileTruck.tailFlameDuration,
  );

  const launchFrame = render();
  const tailIndex = launchFrame.findIndex(
    ({ image }) => image.id === "missile-flame",
  );
  const playerIndex = launchFrame.findLastIndex(
    ({ image }) => image.id === "characters",
  );
  assert.ok(tailIndex >= 0, "Missile launch must draw the approved tail flame.");
  assert.ok(tailIndex < playerIndex, "The tail flame must render behind the player.");

  const tailCall = launchFrame[tailIndex];
  const flameScale =
    GameConfig.missileTruck.tailFlameWidth / tailFlameImage.width;
  assert.ok(
    Math.abs(
      tailCall.transform.rotation + GameConfig.missileTruck.launchAngle,
    ) < 1e-12,
    "The tail flame angle must match the missile launch axis.",
  );
  assert.ok(
    Math.abs(
      tailCall.args[1] +
        GameConfig.missileTruck.tailFlameAnchor.x * flameScale,
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(
      tailCall.args[2] +
        GameConfig.missileTruck.tailFlameAnchor.y * flameScale,
    ) < 1e-12,
  );

  game.update(GameConfig.missileTruck.tailFlameDuration - 0.001);
  assert.ok(game.missileTailFlameRemaining > 0);
  assert.ok(render().some(({ image }) => image.id === "missile-flame"));
  game.update(0.002);
  assert.equal(game.missileTailFlameRemaining, 0);
  assert.equal(
    render().filter(({ image }) => image.id === "missile-flame").length,
    0,
    "The missile tail flame must disappear after its configured duration.",
  );

  const otherLauncher = new Game(
    () => {},
    { image: characterImage },
    null,
    null,
    null,
    "blackEagle",
    effectSprites,
  );
  otherLauncher.action();
  assert.equal(otherLauncher.missileTailFlameRemaining, 0);

  console.log("Missile tail flame verification passed.");
} finally {
  await server.close();
}
