import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const targetAid = 117098575566525;
const supportedAbilities = new Set([
  "getAuthorRelation",
  "getVideoUserActions",
]);
const calls = [];
const state = {
  actionError: null,
  relationError: null,
  relationResponse: {
    status: "ok",
    data: { isFollowing: true },
  },
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
      if (state.actionError) throw state.actionError;
      return state.response;
    },
    async getAuthorRelation() {
      calls.push(["getAuthorRelation"]);
      if (state.relationError) throw state.relationError;
      return state.relationResponse;
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
  assert.deepEqual(await sdk.readToyAuthorRelation(), {
    status: "ok",
    data: { isFollowing: true },
  });
  assert.deepEqual(calls.at(-1), ["getAuthorRelation"]);
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid, 0] }),
    { status: "error", reason: "unexpected_response" },
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
    { status: "error", reason: "unexpected_response" },
  );

  state.response = { items: [] };
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "error", reason: "video_unavailable" },
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
    { status: "error", reason: "video_unavailable" },
  );

  state.actionError = new Error("actions failed");
  const originalWarn = console.warn;
  console.warn = () => {};
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "error", reason: "request_failed" },
  );
  const notLoggedInError = new Error("login required");
  notLoggedInError.type = "not_logged_in";
  state.actionError = notLoggedInError;
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "error", reason: "not_logged_in" },
  );

  state.relationError = new Error("relation failed");
  assert.deepEqual(await sdk.readToyAuthorRelation(), {
    status: "error",
    reason: "request_failed",
  });
  state.relationError = notLoggedInError;
  assert.deepEqual(await sdk.readToyAuthorRelation(), {
    status: "error",
    reason: "not_logged_in",
  });
  state.relationError = null;
  console.warn = originalWarn;
  state.actionError = null;

  state.relationResponse = { status: "ok", data: {} };
  assert.deepEqual(await sdk.readToyAuthorRelation(), {
    status: "error",
    reason: "unexpected_response",
  });

  state.relationResponse = { status: "unsupported" };
  assert.deepEqual(await sdk.readToyAuthorRelation(), {
    status: "unavailable",
  });

  state.relationResponse = { status: "not_logged_in" };
  assert.deepEqual(await sdk.readToyAuthorRelation(), {
    status: "error",
    reason: "not_logged_in",
  });

  supportedAbilities.delete("getAuthorRelation");
  assert.deepEqual(await sdk.readToyAuthorRelation(), {
    status: "unavailable",
  });

  state.response = { status: "unsupported", items: [] };
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "unavailable" },
  );

  state.response = { status: "not_logged_in", items: [] };
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "error", reason: "not_logged_in" },
  );

  supportedAbilities.delete("getVideoUserActions");
  assert.deepEqual(
    await sdk.readToyVideoUserActions({ aids: [targetAid] }),
    { status: "unavailable" },
  );
  assert.deepEqual(await sdk.readToyVideoUserActions({ aids: [] }), {
    status: "error",
    reason: "unexpected_response",
  });

  const byId = (id) =>
    launchers.LAUNCHERS.find((launcher) => launcher.id === id);
  const noActions = { liked: false, coinCount: 0, isFollowing: false };
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
      isFollowing: true,
    }),
    true,
  );
  assert.equal(byId("missileTruck").unlockRequirement, "following");
  assert.equal(byId("missileTruck").unlockHint, "关注火山哥哥解锁");
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
  assert.match(main, /readToyAuthorRelation/);
  assert.match(main, /const FEATURED_VIDEO_AID = 117_098_575_566_525/);
  assert.match(main, /aids: \[FEATURED_VIDEO_AID\]/);
  assert.match(main, /isFollowing: relationResult\.data\.isFollowing/);
  assert.match(main, /void refreshFeaturedVideoMetadata\(\)/);
  assert.match(main, /name\.textContent = unlocked \? launcher\.name : "？？？"/);
  assert.match(main, /else void refreshLauncherAccess\(\)/);
  assert.match(main, /void refreshLauncherAccess\(\);\s*settingsClose\.focus/);
  assert.match(html, /id="launcher-access-status"/);
  assert.match(html, /id="launcher-access-retry"/);
  assert.match(html, /刷新解锁状态/);

  console.log("Video interaction and author-follow launcher unlock checks passed.");
} finally {
  await server.close();
}
