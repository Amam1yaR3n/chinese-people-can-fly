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

  const audio = [];
  const game = new Game(
    (event) => audio.push(event),
    null,
    null,
    null,
    null,
    "blackEagle",
  );
  game.phase = "falling";
  game.player = {
    pos: { x: 0, y: -15 },
    vel: { x: 0, y: 0 },
    width: GameConfig.player.width,
    height: GameConfig.player.height,
  };
  game.swing = { state: "idle", elapsed: 0 };

  game.action();

  assert.equal(game.phase, "airborne");
  assert.deepEqual(audio, ["swing", "hitBlackEagle"]);
  assert.ok(game.impactFlash);
  assert.equal(game.impactFlash.life, GameConfig.swing.impactFlashDuration);
  assert.equal(game.impactFlash.maxLife, GameConfig.swing.impactFlashDuration);

  const drawCalls = {
    moveTo: 0,
    lineTo: 0,
    fill: 0,
    stroke: 0,
  };
  const context = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo() {
      drawCalls.moveTo += 1;
    },
    lineTo() {
      drawCalls.lineTo += 1;
    },
    fill() {
      drawCalls.fill += 1;
    },
    stroke() {
      drawCalls.stroke += 1;
    },
  };
  game.drawImpactFlash(context);

  // One 40-vertex outline (20 outer spikes, 20 valleys), without radial lines.
  assert.deepEqual(drawCalls, {
    moveTo: 1,
    lineTo: 39,
    fill: 1,
    stroke: 1,
  });

  game.updateEffects(GameConfig.swing.impactFlashDuration);
  assert.equal(game.impactFlash, null);

  const slingshot = new Game(
    () => {},
    null,
    null,
    null,
    null,
    "slingshot",
  );
  slingshot.launchPlayerWithVelocity({ x: 100, y: -40 });
  assert.equal(slingshot.impactFlash, null);

  console.log("Impact effect verification passed.");
} finally {
  await server.close();
}
