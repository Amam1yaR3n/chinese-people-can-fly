import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const [{ GameConfig }, { drawOutlinedSpritePose, MinePose }] =
    await Promise.all([
      server.ssrLoadModule("/src/game/config.ts"),
      server.ssrLoadModule("/src/game/sprites.ts"),
    ]);

  assert.equal(MinePose.scale, 0.052 * 1.2);
  assert.equal(MinePose.anchor.y, 399);

  const calls = [];
  let transform = { x: 0, y: 0 };
  const stack = [];
  const context = new Proxy(
    {
      save: () => stack.push({ ...transform }),
      restore: () => {
        transform = stack.pop() ?? { x: 0, y: 0 };
      },
      translate: (x, y) => {
        transform.x += x;
        transform.y += y;
      },
      rotate: () => {},
      shadowColor: "transparent",
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      drawImage: (...args) =>
        calls.push({
          args,
          shadowColor: context.shadowColor,
          shadowOffsetX: context.shadowOffsetX,
          shadowOffsetY: context.shadowOffsetY,
          transform: { ...transform },
        }),
    },
    {
      get: (target, property) => target[property] ?? (() => {}),
    },
  );

  const groundY = GameConfig.groundScreenY;
  const outlineWidth = GameConfig.mine.spriteOutlineWidth;
  drawOutlinedSpritePose(
    context,
    { image: { id: "character-atlas" } },
    MinePose,
    { x: 320, y: groundY - outlineWidth },
    { color: GameConfig.palette.ink, width: outlineWidth },
  );

  assert.equal(calls.length, 9);
  const outlineCalls = calls.slice(0, -1);
  const finalCall = calls.at(-1);
  assert.equal(outlineCalls.length, 8);
  assert.ok(
    outlineCalls.every(({ shadowColor }) => shadowColor === GameConfig.palette.ink),
  );
  assert.equal(finalCall.shadowColor, "transparent");

  const { args } = finalCall;
  assert.equal(args[7], MinePose.frame.width * 0.052 * 1.2);
  assert.equal(args[8], MinePose.frame.height * 0.052 * 1.2);
  const outlinedBottom = Math.max(
    ...outlineCalls.map(
      ({ args: drawArgs, shadowOffsetY, transform: drawTransform }) =>
        drawTransform.y +
        drawArgs[6] +
        MinePose.anchor.y * MinePose.scale +
        shadowOffsetY,
    ),
  );
  assert.equal(
    outlinedBottom,
    groundY,
    "The thickened mine outline bottom must remain aligned with the ground surface.",
  );

  assert.equal(GameConfig.mine.width, 7);
  assert.equal(GameConfig.mine.height, 2.8);

  console.log("Mine sprite verification passed.");
} finally {
  await server.close();
}
