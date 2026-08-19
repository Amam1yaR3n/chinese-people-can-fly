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

  const DEG = Math.PI / 180;
  const DT = 1 / 120;
  const MAX_SECONDS = 20;
  const screenY = (game) => game.worldToScreenY(game.player.pos.y);

  // 各发射器开局发射的最极端纵向情形（最高角度/最大速度）。
  const launchCases = {
    blackEagle: {
      pos: { x: 0, y: -40 },
      vel: {
        x: GameConfig.launchSpeed * Math.cos(GameConfig.launchAngleMax),
        y: -GameConfig.launchSpeed * Math.sin(GameConfig.launchAngleMax),
      },
    },
    slingshot: {
      pos: { x: GameConfig.slingshot.restPouchWorld.x, y: -39.8 },
      vel: {
        x: GameConfig.slingshot.maximumSpeed * Math.cos(80 * DEG),
        y: -GameConfig.slingshot.maximumSpeed * Math.sin(80 * DEG),
      },
    },
    humanCannon: {
      pos: { x: 0, y: -20.7 },
      vel: {
        x: GameConfig.humanCannon.maximumSpeed *
          Math.cos(GameConfig.humanCannon.launchAngle),
        y: -GameConfig.humanCannon.maximumSpeed *
          Math.sin(GameConfig.humanCannon.launchAngle),
      },
    },
    missileTruck: {
      pos: { x: 0, y: -34.3 },
      vel: {
        x: GameConfig.missileTruck.launchSpeed *
          Math.cos(GameConfig.missileTruck.launchAngle),
        y: -GameConfig.missileTruck.launchSpeed *
          Math.sin(GameConfig.missileTruck.launchAngle),
      },
    },
  };

  const makeAirborneGame = (launcherId, initial) => {
    const game = new Game(() => {}, null, null, null, null, launcherId);
    game.phase = "airborne";
    game.player = {
      pos: { ...initial.pos },
      vel: { ...initial.vel },
      width: GameConfig.player.width,
      height: GameConfig.player.height,
    };
    game.camera = { x: 0, y: 0, shakeTime: 0, shakeStrength: 0 };
    game.verticalTrackingActive = false;
    game.mines = [];
    game.pickups = [];
    // 禁止自动生成障碍与道具，专注验证纯飞行轨迹下的摄像头跟随。
    game.nextMineDistance = Number.POSITIVE_INFINITY;
    game.nextPickupDistance = Number.POSITIVE_INFINITY;
    return game;
  };

  const runUntilLandedAndSettled = (game) => {
    let minScreenY = Infinity;
    let minCameraY = 0;
    let maxCameraY = -Infinity;
    let cameraMovedUp = false;
    let elapsed = 0;
    while (elapsed < MAX_SECONDS) {
      const landed = game.phase !== "airborne";
      if (
        landed &&
        !game.verticalTrackingActive &&
        Math.abs(game.camera.y) < 1e-6
      ) {
        break;
      }
      minScreenY = Math.min(minScreenY, screenY(game));
      minCameraY = Math.min(minCameraY, game.camera.y);
      maxCameraY = Math.max(maxCameraY, game.camera.y);
      cameraMovedUp = cameraMovedUp || minCameraY < -0.5;
      game.update(DT);
      elapsed += DT;
    }
    return { minScreenY, minCameraY, maxCameraY, cameraMovedUp, elapsed };
  };

  for (const [launcherId, initial] of Object.entries(launchCases)) {
    const game = makeAirborneGame(launcherId, initial);
    const { minScreenY, minCameraY, maxCameraY, cameraMovedUp } =
      runUntilLandedAndSettled(game);
    assert.ok(
      minScreenY >= 0,
      `${launcherId} 开局升空时角色纵向越出画面顶部（screenY=${minScreenY.toFixed(1)}）`,
    );
    assert.ok(
      cameraMovedUp,
      `${launcherId} 升空时摄像头应纵向跟随但实际未移动`,
    );
    assert.ok(
      maxCameraY <= 1e-6,
      `${launcherId} 摄像头不应向地面下方移动（cameraY=${maxCameraY.toFixed(2)}）`,
    );
    assert.ok(
      Math.abs(game.camera.y) < 1e-6,
      `${launcherId} 落地后摄像头应平滑归位（cameraY=${game.camera.y.toFixed(3)}）`,
    );
    console.log(
      `${launcherId.padEnd(13)} 最低画面位置 ${minScreenY.toFixed(1)}px，摄像头最大上移 ${(-minCameraY).toFixed(1)}px`,
    );
  }

  // 黑鹰开局自由落体：角色从高处落下时摄像头先平滑上移再回位。
  const fallGame = new Game(() => {}, null, null, null, null, "blackEagle");
  fallGame.phase = "falling";
  fallGame.camera = { x: 0, y: 0, shakeTime: 0, shakeStrength: 0 };
  fallGame.verticalTrackingActive = false;
  fallGame.mines = [];
  fallGame.pickups = [];
  fallGame.nextMineDistance = Number.POSITIVE_INFINITY;
  fallGame.nextPickupDistance = Number.POSITIVE_INFINITY;
  let fallMinScreenY = Infinity;
  let fallCameraMovedUp = false;
  let fallElapsed = 0;
  while (fallElapsed < MAX_SECONDS) {
    const settled =
      fallGame.phase !== "falling" &&
      !fallGame.verticalTrackingActive &&
      Math.abs(fallGame.camera.y) < 1e-6;
    if (settled) break;
    fallMinScreenY = Math.min(fallMinScreenY, screenY(fallGame));
    fallCameraMovedUp = fallCameraMovedUp || fallGame.camera.y < -0.5;
    fallGame.update(DT);
    fallElapsed += DT;
  }
  assert.ok(
    fallMinScreenY >= 0,
    `黑鹰开局自由落体时角色纵向越出画面顶部（screenY=${fallMinScreenY.toFixed(1)}）`,
  );
  assert.ok(fallCameraMovedUp, "黑鹰开局下落时摄像头应平滑上移");
  assert.ok(
    Math.abs(fallGame.camera.y) < 1e-6,
    "黑鹰开局落地后摄像头应平滑归位",
  );

  console.log("Camera vertical follow verification passed.");
} finally {
  await server.close();
}
