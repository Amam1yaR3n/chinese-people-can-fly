import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createServer } from "vite";

const supportedAbilities = new Set(["navigate", "getAuthorVideos"]);
const calls = [];
const state = {
  throwAuthorVideos: false,
  authorVideos: {
    status: "ok",
    items: [
      {
        ref: { bvid: "BV1VBbk6EEJP" },
        status: "ok",
        data: {
          aid: 117098575566525,
          bvid: "BV1VBbk6EEJP",
          title: "我把大狗叫做成了游戏！（点击即玩）【B站AI创造公开赛】",
          cover:
            "http://i2.hdslb.com/bfs/archive/30591c7517fa0be5db2ae6d7163efcb6170fa685.jpg",
        },
      },
    ],
  },
};

globalThis.window = {
  location: { protocol: "https:", href: "https://example.com/toy/game/" },
  toy: {
    async isSupport(ability) {
      calls.push(["isSupport", ability]);
      return supportedAbilities.has(ability);
    },
    navigate(request) {
      calls.push(["navigate", request]);
      return Promise.resolve();
    },
    async getAuthorVideos(request) {
      calls.push(["getAuthorVideos", request]);
      if (state.throwAuthorVideos) throw new Error("author videos failed");
      return state.authorVideos;
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

  assert.equal(await sdk.prepareToyNavigation(), true);

  const homeNavigation = sdk.navigateToy({
    type: "space",
    id: "137429365",
  });
  assert.deepEqual(calls.at(-1), [
    "navigate",
    { type: "space", id: "137429365" },
  ]);
  assert.deepEqual(await homeNavigation, { status: "ok" });

  const videoNavigation = sdk.navigateToy({
    type: "video",
    id: "BV1VBbk6EEJP",
  });
  assert.deepEqual(calls.at(-1), [
    "navigate",
    { type: "video", id: "BV1VBbk6EEJP" },
  ]);
  assert.deepEqual(await videoNavigation, { status: "ok" });

  const videoResult = await sdk.readToyAuthorVideos({
    videos: [{ bvid: "BV1VBbk6EEJP" }],
  });
  assert.deepEqual(calls.at(-1), [
    "getAuthorVideos",
    { videos: [{ bvid: "BV1VBbk6EEJP" }] },
  ]);
  assert.deepEqual(videoResult, {
    status: "ok",
    items: [
      {
        aid: 117098575566525,
        bvid: "BV1VBbk6EEJP",
        title: "我把大狗叫做成了游戏！（点击即玩）【B站AI创造公开赛】",
        cover:
          "http://i2.hdslb.com/bfs/archive/30591c7517fa0be5db2ae6d7163efcb6170fa685.jpg",
      },
    ],
  });

  state.authorVideos = {
    status: "ok",
    items: [
      {
        ref: { bvid: "BV1WRONG0000" },
        status: "ok",
        data: {
          aid: 1,
          bvid: "BV1VBbk6EEJP",
          title: "错误匹配",
          cover: "https://example.com/wrong.jpg",
        },
      },
    ],
  };
  assert.deepEqual(
    await sdk.readToyAuthorVideos({
      videos: [{ bvid: "BV1VBbk6EEJP" }],
    }),
    { status: "ok", items: [] },
  );

  state.throwAuthorVideos = true;
  const originalWarn = console.warn;
  console.warn = () => {};
  assert.deepEqual(
    await sdk.readToyAuthorVideos({
      videos: [{ bvid: "BV1VBbk6EEJP" }],
    }),
    { status: "error" },
  );
  console.warn = originalWarn;
  state.throwAuthorVideos = false;

  supportedAbilities.delete("getAuthorVideos");
  assert.deepEqual(
    await sdk.readToyAuthorVideos({
      videos: [{ bvid: "BV1VBbk6EEJP" }],
    }),
    { status: "unavailable" },
  );

  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const leaderboardIndex = html.indexOf('id="leaderboard-button"');
  const audioIndex = html.indexOf('id="audio-button"');
  const settingsIndex = html.indexOf('id="settings-button"');
  assert.ok(leaderboardIndex >= 0 && leaderboardIndex < audioIndex);
  assert.ok(audioIndex < settingsIndex);

  const audioDialogStart = html.indexOf('id="audio-dialog"');
  const settingsDialogStart = html.indexOf('id="settings-dialog"');
  const resultStart = html.indexOf('id="result"');
  const audioMarkup = html.slice(audioDialogStart, settingsDialogStart);
  const settingsMarkup = html.slice(settingsDialogStart, resultStart);
  assert.match(audioMarkup, /id="music-volume"/);
  assert.match(audioMarkup, /id="effects-volume"/);
  assert.doesNotMatch(settingsMarkup, /id="music-volume"|id="effects-volume"/);
  assert.match(settingsMarkup, /id="author-home-button"/);
  assert.match(settingsMarkup, /id="featured-video-button"/);
  assert.match(settingsMarkup, /class="video-play-icon"/);
  assert.match(settingsMarkup, /火山哥哥/);
  assert.match(settingsMarkup, /BV1VBbk6EEJP|大狗叫/);

  await access(new URL("../assets/ui/author-avatar.jpg", import.meta.url));
  await access(
    new URL("../assets/ui/featured-video-cover.jpg", import.meta.url),
  );

  const main = await readFile(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  assert.match(main, /type: "space", id: AUTHOR_ID/);
  assert.match(main, /type: "video", id: FEATURED_VIDEO_BVID/);
  assert.match(main, /const navigation = navigateToy\(request\)/);

  console.log("Promotion UI, Toy video data, and navigation checks passed.");
} finally {
  await server.close();
}
