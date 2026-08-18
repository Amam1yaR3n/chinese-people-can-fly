import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const supportedAbilities = new Set([
  "getCloudStorage",
  "setCloudStorage",
  "submitScore",
  "getRankList",
  "getMyRank",
]);
const calls = [];
const state = {
  rankList: [],
  myRank: { ranked: false, rank: 0, score: 0 },
  submittedScore: 0,
  throwRankList: false,
};

globalThis.window = {
  location: { protocol: "https:", href: "https://example.com/toy/game/" },
  toy: {
    async isSupport(ability) {
      calls.push(["isSupport", ability]);
      return supportedAbilities.has(ability);
    },
    async getCloudStorage() {
      return {};
    },
    async setCloudStorage() {},
    async submitScore(request) {
      calls.push(["submitScore", request]);
      state.submittedScore = Math.max(state.submittedScore, request.score);
      return { score: state.submittedScore };
    },
    async getRankList(request) {
      calls.push(["getRankList", request]);
      if (state.throwRankList) throw new Error("rank list failed");
      return state.rankList;
    },
    async getMyRank(request) {
      calls.push(["getMyRank", request]);
      return state.myRank;
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
  const leaderboard = await server.ssrLoadModule("/src/game/leaderboard.ts");

  state.rankList = Array.from({ length: 55 }, (_, index) => ({
    rank: index + 1,
    score: 10_000 - index,
    nickname: `玩家${index + 1}`,
    avatar: `//i0.hdslb.com/avatar-${index + 1}.png`,
  }));
  const list = await sdk.readToyRankList({
    board: 1,
    period: "all",
    limit: 50,
  });
  assert.equal(list.status, "ok");
  assert.equal(list.items.length, 50);
  assert.deepEqual(calls.at(-1), [
    "getRankList",
    { board: 1, period: "all", limit: 50 },
  ]);

  state.myRank = { ranked: true, rank: 12, score: 9_989 };
  const mine = await sdk.readToyMyRank({ board: 1, period: "all" });
  assert.deepEqual(mine, {
    status: "ok",
    ranked: true,
    rank: 12,
    score: 9_989,
  });
  assert.deepEqual(calls.at(-1), [
    "getMyRank",
    { board: 1, period: "all" },
  ]);

  const submitted = await sdk.submitToyScore({
    board: 1,
    score: sdk.TOY_SCORE_MAX + 100,
  });
  assert.equal(submitted.status, "ok");
  assert.deepEqual(calls.at(-1), [
    "submitScore",
    { board: 1, score: sdk.TOY_SCORE_MAX },
  ]);

  state.myRank = { ranked: false, rank: 44, score: -8 };
  assert.deepEqual(await sdk.readToyMyRank({ board: 1, period: "all" }), {
    status: "ok",
    ranked: false,
    rank: 0,
    score: 0,
  });

  supportedAbilities.delete("getRankList");
  assert.deepEqual(
    await sdk.readToyRankList({ board: 1, period: "all", limit: 50 }),
    { status: "unavailable" },
  );
  supportedAbilities.add("getRankList");

  state.throwRankList = true;
  const originalWarn = console.warn;
  console.warn = () => {};
  assert.deepEqual(
    await sdk.readToyRankList({ board: 1, period: "all", limit: 50 }),
    { status: "error" },
  );
  console.warn = originalWarn;
  state.throwRankList = false;

  const queuedSubmissions = [];
  let resolveFirst;
  const queue = leaderboard.createLeaderboardScoreQueue(async (request) => {
    queuedSubmissions.push(request);
    if (queuedSubmissions.length === 1) {
      return await new Promise((resolve) => {
        resolveFirst = resolve;
      });
    }
    return { status: "ok", score: request.score };
  });
  queue.enqueue(100);
  queue.enqueue(250);
  resolveFirst({ status: "ok", score: 100 });
  await queue.whenIdle();
  assert.deepEqual(queuedSubmissions, [
    { board: 1, score: 100 },
    { board: 1, score: 250 },
  ]);

  const retriedSubmissions = [];
  const retryQueue = leaderboard.createLeaderboardScoreQueue(
    async (request) => {
      retriedSubmissions.push(request);
      return retriedSubmissions.length === 1
        ? { status: "error" }
        : { status: "ok", score: request.score };
    },
  );
  retryQueue.enqueue(300);
  await retryQueue.whenIdle();
  retryQueue.enqueue(100);
  await retryQueue.whenIdle();
  assert.deepEqual(retriedSubmissions, [
    { board: 1, score: 300 },
    { board: 1, score: 300 },
  ]);

  const boundedSubmissions = [];
  const boundedQueue = leaderboard.createLeaderboardScoreQueue(
    async (request) => {
      boundedSubmissions.push(request);
      return { status: "ok", score: request.score };
    },
  );
  boundedQueue.enqueue(Number.MAX_SAFE_INTEGER);
  await boundedQueue.whenIdle();
  assert.deepEqual(boundedSubmissions, [
    { board: 1, score: sdk.TOY_SCORE_MAX },
  ]);

  calls.length = 0;
  state.rankList = [];
  state.myRank = { ranked: false, rank: 0, score: 0 };
  const loaded = await leaderboard.loadLeaderboard();
  assert.equal(loaded.list.status, "ok");
  assert.deepEqual(loaded.list.items, []);
  assert.deepEqual(loaded.mine, {
    status: "ok",
    ranked: false,
    rank: 0,
    score: 0,
  });
  assert.ok(
    calls.some(
      ([name, request]) =>
        name === "getRankList" &&
        request.board === 1 &&
        request.period === "all" &&
        request.limit === 50,
    ),
  );

  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const scoreIndex = html.indexOf('id="score"');
  const leaderboardIndex = html.indexOf('id="leaderboard-button"');
  const settingsIndex = html.indexOf('id="settings-button"');
  assert.ok(scoreIndex >= 0 && scoreIndex < leaderboardIndex);
  assert.ok(leaderboardIndex < settingsIndex);
  assert.match(html, /id="leaderboard-dialog"/);
  assert.match(html, /id="my-rank"/);

  console.log("Leaderboard SDK, score queue, and markup checks passed.");
} finally {
  await server.close();
}
