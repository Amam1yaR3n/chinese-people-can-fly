import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { formatResultMessage, getDefeatPercentage } =
    await server.ssrLoadModule("/src/game/result-message.ts");

  assert.deepEqual(
    [-1, 0, 99, 100, 199, 200, 7999, 8000, 8099, 8100, 10000, 20000].map(
      getDefeatPercentage,
    ),
    [0, 0, 0, 0, 0, 1, 78, 79, 79, 80, 99, 99],
  );
  assert.equal(
    formatResultMessage(8000),
    "你击败了79％的中国人，再飞一次吧！",
  );
  assert.equal(
    formatResultMessage(10000),
    "你击败了99％的中国人，再飞一次吧！",
  );

  const [mainSource, offlineBundle] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../offline/game.js", import.meta.url), "utf8"),
  ]);
  assert.match(
    mainSource,
    /resultMessage\.textContent = formatResultMessage\(snapshot\.distance\)/,
  );
  assert.ok(offlineBundle.includes("你击败了"));
  for (const retiredCopy of [
    "难道中国人不能飞？",
    "下次可以飞得更远！",
    "击败了100％的美国人",
    "击败了100％的日本人",
  ]) {
    assert.ok(!mainSource.includes(retiredCopy));
    assert.ok(!offlineBundle.includes(retiredCopy));
  }

  console.log("Result message percentage and copy checks passed.");
} finally {
  await server.close();
}
