import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const [{ Game }, { GameConfig }, { FlyerPoses, MinePose, PickupPoses }] =
    await Promise.all([
      server.ssrLoadModule("/src/game/game.ts"),
      server.ssrLoadModule("/src/game/config.ts"),
      server.ssrLoadModule("/src/game/sprites.ts"),
    ]);

  const makeGame = (launcherId = "slingshot") => {
    const audio = [];
    const game = new Game(
      (event) => audio.push(event),
      null,
      null,
      null,
      null,
      launcherId,
    );
    game.phase = "airborne";
    game.pickups = [];
    game.mines = [];
    game.player = {
      pos: { x: 0, y: -80 },
      vel: { x: 160, y: 30 },
      width: GameConfig.player.width,
      height: GameConfig.player.height,
    };
    game.camera = { x: 0, y: 0, shakeTime: 0, shakeStrength: 0 };
    return { audio, game };
  };

  const totalPickupWeight =
    GameConfig.pickup.redPacket.weight +
    GameConfig.pickup.skyLantern.weight +
    GameConfig.pickup.sixthGenJet.weight +
    GameConfig.pickup.ufo.weight;
  assert.ok(Math.abs(totalPickupWeight - 1) < Number.EPSILON);
  assert.deepEqual(
    [
      [0.49, "redPacket"],
      [0.5, "skyLantern"],
      [0.6799, "skyLantern"],
      [0.68, "sixthGenJet"],
      [0.8599, "sixthGenJet"],
      [0.86, "ufo"],
      [0.9999, "ufo"],
    ].map(([roll, expected]) => {
      const game = makeGame().game;
      game.random = () => roll;
      return [game.choosePickupType(), expected];
    }),
    [
      ["redPacket", "redPacket"],
      ["skyLantern", "skyLantern"],
      ["skyLantern", "skyLantern"],
      ["sixthGenJet", "sixthGenJet"],
      ["sixthGenJet", "sixthGenJet"],
      ["ufo", "ufo"],
      ["ufo", "ufo"],
    ],
  );
  assert.deepEqual(
    [GameConfig.pickup.sixthGenJet.minAltitude, GameConfig.pickup.sixthGenJet.maxAltitude],
    [40, 120],
  );
  assert.deepEqual(
    [GameConfig.pickup.ufo.minAltitude, GameConfig.pickup.ufo.maxAltitude],
    [65, 120],
  );
  assert.equal(GameConfig.powerUp.jet.duration, 3.5);
  assert.equal(GameConfig.powerUp.ufo.duration, 5);

  for (const launcherId of ["blackEagle", "slingshot"]) {
    const { audio, game } = makeGame(launcherId);
    game.collectPickup({
      id: 1,
      type: "ufo",
      distance: 0,
      pos: { x: 0, y: -80 },
      status: "available",
    });
    assert.equal(game.powerUp.mode, "ufo");
    assert.equal(game.powerUp.remainingDuration, 5);
    assert.equal(game.powerUp.exitSpeed, 160);
    assert.deepEqual(game.player.vel, { x: 160, y: 0 });
    assert.deepEqual(audio, ["pickupUfo"]);

    game.updateUfoFlight(2.5);
    assert.equal(game.powerUp.remainingDuration, 2.5);
    assert.equal(game.player.pos.x, 400);
    assert.equal(game.player.pos.y, -80);
    game.updateUfoFlight(2.5);
    assert.equal(game.powerUp.mode, "normal");
    assert.equal(game.player.pos.x, 800);
    assert.equal(game.player.pos.y, -80);
    assert.deepEqual(game.player.vel, { x: 160, y: 0 });
  }

  const slowExit = makeGame();
  slowExit.game.player.vel.x = 80;
  slowExit.game.collectPickup({
    id: 2,
    type: "ufo",
    distance: 0,
    pos: { x: 0, y: -80 },
    status: "available",
  });
  assert.equal(slowExit.game.player.vel.x, 120);
  slowExit.game.updateUfoFlight(5);
  assert.equal(slowExit.game.player.vel.x, 120);

  const fastJet = makeGame("blackEagle");
  fastJet.game.collectPickup({
    id: 8,
    type: "sixthGenJet",
    distance: 0,
    pos: { x: 0, y: -80 },
    status: "available",
  });
  assert.equal(fastJet.game.powerUp.mode, "jet");
  assert.equal(fastJet.game.powerUp.remainingDuration, 3.5);
  assert.equal(fastJet.game.powerUp.exitSpeed, 160);
  assert.deepEqual(fastJet.game.player.vel, { x: 160, y: 0 });
  fastJet.game.updateJetFlight(1.5);
  assert.equal(fastJet.game.powerUp.remainingDuration, 2);
  assert.equal(fastJet.game.player.pos.x, 240);
  fastJet.game.updateJetFlight(2);
  assert.equal(fastJet.game.powerUp.mode, "normal");
  assert.equal(fastJet.game.player.pos.x, 560);
  assert.deepEqual(fastJet.game.player.vel, { x: 160, y: 0 });
  assert.deepEqual(fastJet.audio, ["pickupJet"]);

  const slowJet = makeGame();
  slowJet.game.player.vel.x = 130;
  slowJet.game.collectPickup({
    id: 9,
    type: "sixthGenJet",
    distance: 0,
    pos: { x: 0, y: -80 },
    status: "available",
  });
  assert.equal(slowJet.game.powerUp.exitSpeed, 130);
  assert.equal(slowJet.game.player.vel.x, 150);
  slowJet.game.updateJetFlight(3.5);
  assert.equal(slowJet.game.player.pos.x, 525);
  assert.equal(slowJet.game.player.vel.x, 130);

  const magnet = makeGame();
  magnet.game.powerUp.mode = "ufo";
  magnet.game.powerUp.remainingDuration = 5;
  magnet.game.player.vel = { x: 120, y: 0 };
  magnet.game.pickups = [
    {
      id: 3,
      type: "redPacket",
      distance: 10,
      pos: { x: 10, y: -80 },
      status: "available",
    },
    {
      id: 4,
      type: "sixthGenJet",
      distance: 0,
      pos: { x: 0, y: -80 },
      status: "available",
    },
  ];
  magnet.game.updatePickups(0, { ...magnet.game.player.pos });
  assert.equal(magnet.game.pickups.find(({ id }) => id === 3).status, "attracting");
  assert.equal(magnet.game.pickups.find(({ id }) => id === 4).status, "available");
  assert.equal(magnet.game.redPacketCount, 1);
  assert.deepEqual(magnet.audio, ["pickupRedPacket"]);
  magnet.game.powerUp.mode = "normal";
  magnet.game.updateAttractingRedPackets(1);
  assert.equal(magnet.game.pickups.find(({ id }) => id === 3).status, "collected");
  assert.deepEqual(magnet.game.pickups.find(({ id }) => id === 3).pos, {
    x: 0,
    y: -80 + GameConfig.powerUp.ufo.emitterOffsetY,
  });

  const attractionDirection = makeGame().game;
  attractionDirection.powerUp.mode = "ufo";
  attractionDirection.powerUp.remainingDuration = 5;
  attractionDirection.pickups = [
    {
      id: 10,
      type: "redPacket",
      distance: 10,
      pos: { x: 10, y: -80 },
      status: "attracting",
    },
  ];
  attractionDirection.updateAttractingRedPackets(0.01);
  assert.ok(attractionDirection.pickups[0].pos.x < 10);
  assert.ok(attractionDirection.pickups[0].pos.y > -80);

  const effects = makeGame().game;
  effects.powerUp.mode = "ufo";
  effects.powerUp.remainingDuration = GameConfig.powerUp.ufo.duration;
  assert.equal(effects.ufoLightsOn(), true);
  effects.powerUp.remainingDuration = GameConfig.powerUp.ufo.duration - 0.2;
  assert.equal(effects.ufoLightsOn(), false);
  effects.powerUp.remainingDuration = GameConfig.powerUp.ufo.duration - 0.4;
  assert.equal(effects.ufoLightsOn(), true);

  effects.player.pos.y = -80;
  const tallBeam = effects.ufoBeamGeometry();
  assert.ok(tallBeam);
  effects.player.pos.y = -40;
  const shortBeam = effects.ufoBeamGeometry();
  assert.ok(shortBeam);
  assert.ok(tallBeam.groundY - tallBeam.topY > shortBeam.groundY - shortBeam.topY);
  assert.ok(tallBeam.groundWidth > shortBeam.groundWidth);
  assert.equal(tallBeam.topWidth, shortBeam.topWidth);
  effects.camera.y = -25;
  const shiftedBeam = effects.ufoBeamGeometry();
  assert.ok(shiftedBeam);
  assert.equal(
    shiftedBeam.groundY - shiftedBeam.topY,
    shortBeam.groundY - shortBeam.topY,
  );

  const jet = makeGame("blackEagle");
  jet.game.powerUp.mode = "jet";
  jet.game.powerUp.remainingDuration = 3.5;
  jet.game.player.vel = { x: 150, y: 0 };
  jet.game.pickups = [
    {
      id: 5,
      type: "redPacket",
      distance: 0,
      pos: { x: 0, y: -80 },
      status: "available",
    },
    {
      id: 6,
      type: "redPacket",
      distance: 200,
      pos: { x: 200, y: -80 },
      status: "available",
    },
    {
      id: 7,
      type: "ufo",
      distance: 0,
      pos: { x: 0, y: -80 },
      status: "available",
    },
  ];
  jet.game.updatePickups(0, { ...jet.game.player.pos });
  assert.equal(jet.game.pickups.some(({ id }) => id === 5), false);
  assert.equal(jet.game.pickups.find(({ id }) => id === 6).status, "available");
  assert.equal(jet.game.pickups.find(({ id }) => id === 7).status, "available");
  assert.equal(jet.game.redPacketCount, 1);

  const atlas = JSON.parse(
    await readFile("assets/characters/atlas/characters.json", "utf8"),
  );
  const frameTuple = ({ x, y, width, height }) => [x, y, width, height];
  const atlasTuple = ({ x, y, w, h }) => [x, y, w, h];
  assert.deepEqual(
    frameTuple(FlyerPoses.ufo.frame),
    atlasTuple(atlas.frames["flyer/ufo"].frame),
  );
  assert.deepEqual(
    frameTuple(FlyerPoses.ufoLightsOn.frame),
    atlasTuple(atlas.frames["flyer/ufo-lights-on"].frame),
  );
  assert.deepEqual(
    frameTuple(PickupPoses.ufo.frame),
    atlasTuple(atlas.frames["pickups/ufo"].frame),
  );
  assert.deepEqual(
    frameTuple(MinePose.frame),
    atlasTuple(atlas.frames["obstacles/mine"].frame),
  );
  assert.equal(FlyerPoses.ufo.frame.width * FlyerPoses.ufo.scale, 210);
  assert.equal(FlyerPoses.ufo.frame.height * FlyerPoses.ufo.scale, 140);
  assert.equal(
    FlyerPoses.ufoLightsOn.frame.width * FlyerPoses.ufoLightsOn.scale,
    210,
  );
  assert.equal(
    FlyerPoses.ufoLightsOn.frame.height * FlyerPoses.ufoLightsOn.scale,
    140,
  );
  assert.equal(PickupPoses.ufo.frame.width * PickupPoses.ufo.scale, 66);
  assert.equal(PickupPoses.ufo.frame.height * PickupPoses.ufo.scale, 42);

  console.log("UFO gameplay verification passed.");
} finally {
  await server.close();
}
