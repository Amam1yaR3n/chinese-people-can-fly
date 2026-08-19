import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const targetAid = 117098575566525;
const supportedAbilities = new Set(["getVideoUserActions"]);
const calls = [];
const state = {
  throwActions: false,
  response: {
    items: [
      {
        aid: targetAid,
        status: "ok",
        liked: true,
        coinCount: 1,
        favorited: false,
      },
    ],
  },
};

globalThis.window = {
  location: { protocol: "https:", href: "https://example.com/toy/game/" },
  localStorage: {
    getItem() {
      return null;
    },
    setItem() {},
  },
  toy: {
    async isSupport(ability) {
      calls.push(["isSupport", ability]);
      return supportedAbilities.has(ability);
    },
    async getVideoUserActions(request) {
      calls.push(["getVideoUserActions", request]);
      if (state.throwActions) throw new Error("actions failed");
      return state.response;
    },
  },
};

const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const sdk = await server.ssrLoadModule("/src/platform/toy-sdk.ts");
  const launchers = await server.ssrLoadModule("/src/game/launchers.ts");
  const progress = await server.ssrLoadModule("/src/game/progress.ts");
  const cloudProgress = await server.ssrLoadModule(
    "/src/game/cloud-progress.ts",
  );

  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid, targetAid] }),
    {
      status: "ok",
      items: [
        {
          aid: targetAid,
          liked: true,
          coinCount: 1,
          favorited: false,
        },
      ],
    },
  );
  assert.deepEqual(calls.at(-1), [
    "getVideoUserActions",
    { aids: [targetAid] },
  ]);
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid, 0] }),
    { status: "error" },
  );

  state.response = {
    items: [
      {
        aid: targetAid,
        status: "ok",
        liked: false,
        coinCount: -1,
        favorited: true,
      },
    ],
  };
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "error" },
  );

  state.response = { items: [] };
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "error" },
  );

  state.response = {
    items: [
      {
        aid: targetAid,
        status: "ok",
        liked: true,
        coinCount: 2,
        favorited: true,
      },
      { aid: 1, status: "error" },
    ],
  };
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "error" },
  );

  state.throwActions = true;
  const originalWarn = console.warn;
  console.warn = () => {};
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "error" },
  );
  console.warn = originalWarn;
  state.throwActions = false;

  supportedAbilities.delete("getVideoUserActions");
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "unavailable" },
  );
  assert.deepEqual(await sdk.readToyVideoUserActions({ aids: [] }), {
    status: "error",
  });

  const byId = (id) =>
    launchers.LAUNCHERS.find((launcher) => launcher.id === id);
  const noActions = { liked: false, coinCount: 0, favorited: false };
  assert.equal(launchers.isLauncherUnlocked(byId("blackEagle"), null), true);
  assert.equal(launchers.isLauncherUnlocked(byId("slingshot"), noActions), false);
  assert.equal(
    launchers.isLauncherUnlocked(byId("slingshot"), {
      ...noActions,
      liked: true,
    }),
    true,
  );
  assert.equal(
    launchers.isLauncherUnlocked(byId("humanCannon"), {
      ...noActions,
      coinCount: 1,
    }),
    true,
  );
  assert.equal(
    launchers.isLauncherUnlocked(byId("missileTruck"), {
      ...noActions,
      favorited: true,
    }),
    true,
  );
  assert.equal(
    launchers.isLauncherSelectable(byId("missileTruck"), null),
    false,
  );

  const migrated = progress.sanitizeProgress({
    version: 1,
    bestDistance: 100_000,
    selectedLauncher: "missileTruck",
  });
  assert.deepEqual(migrated, {
    version: 1,
    bestDistance: 100_000,
    selectedLauncher: "missileTruck",
  });
  assert.deepEqual(
    cloudProgress.mergeProgress(
      { version: 1, bestDistance: 500, selectedLauncher: "slingshot" },
      { version: 1, bestDistance: 800, selectedLauncher: "humanCannon" },
      false,
    ),
    { version: 1, bestDistance: 800, selectedLauncher: "humanCannon" },
  );

  const main = await readFile(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(main, /unlockDistance|hasNewlyUnlockedLauncher/);
  assert.match(main, /readToyVideoUserActions/);
  assert.match(main, /name\.textContent = unlocked \? launcher\.name : "？？？"/);
  assert.match(main, /else void refreshLauncherAccess\(\)/);
  assert.match(main, /void refreshLauncherAccess\(\);\s*settingsClose\.focus/);
  assert.match(html, /id="launcher-access-status"/);
  assert.match(html, /id="launcher-access-retry"/);
  assert.match(html, /刷新解锁状态/);

  console.log("Video interaction launcher unlock checks passed.");
} finally {
  await server.close();
}
