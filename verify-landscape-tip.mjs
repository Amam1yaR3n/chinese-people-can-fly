import puppeteer from "puppeteer-core";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGE_URL = "file:///" + resolve("index.html").replaceAll("\\", "/");
const OUT_DIR =
  "C:/Users/19509/.codex/visualizations/2026/08/19/01a0194e-40cd-7c21-8ef6-9b61d9450909";

const sleep = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function launchBrowser() {
  const profile = mkdtempSync(join(tmpdir(), "landscape-tip-profile-"));
  let browser;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: true,
        userDataDir: profile,
        timeout: 60000,
        args: [
          "--allow-file-access-from-files",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-gpu",
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-sync",
          "--metrics-recording-only",
          "--no-sandbox",
        ],
      });
      break;
    } catch (error) {
      lastError = error;
      await sleep(800);
    }
  }
  if (!browser) throw lastError;
  return { browser, profile };
}

async function runFlow(width, height, label, rotateTest) {
  const { browser, profile } = await launchBrowser();
  console.log(`[${label}] chrome launched`);
  const page = await browser.newPage();
  console.log(`[${label}] page created`);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  try {
    await page.setViewport({ width, height });
    console.log(`[${label}] navigating...`);
    await page.goto(PAGE_URL, { waitUntil: "load" });
    console.log(`[${label}] page loaded`);
    await sleep(1200);

    const tutorialVisible = await page.evaluate(
      () => !document.querySelector("#tutorial-dialog").hidden,
    );
    await page.click("#tutorial-close");
    await sleep(700);

    const tipVisible = await page.evaluate(
      () => !document.querySelector("#landscape-tip").hidden,
    );
    const tipText = await page.evaluate(
      () => document.querySelector(".landscape-tip-line")?.textContent ?? null,
    );
    const tipStored = await page.evaluate(
      () =>
        localStorage.getItem("chinese-people-can-fly:landscape-tip-shown"),
    );
    const shot1 = join(OUT_DIR, `${label}-1.png`);
    writeFileSync(shot1, await page.screenshot({ fullPage: false }));
    await sleep(1000);
    const shot2 = join(OUT_DIR, `${label}-2.png`);
    writeFileSync(shot2, await page.screenshot({ fullPage: false }));

    let rotatedShot = null;
    let tipGoneAfterRotate = null;
    let tipStillHidden = null;
    if (rotateTest) {
      await page.setViewport({ width: 844, height: 390 });
      await sleep(700);
      tipGoneAfterRotate = await page.evaluate(
        () => document.querySelector("#landscape-tip").hidden,
      );
      rotatedShot = join(OUT_DIR, `${label}-rotated.png`);
      writeFileSync(rotatedShot, await page.screenshot({ fullPage: false }));

      await page.setViewport({ width: 390, height: 844 });
      await sleep(700);
      tipStillHidden = await page.evaluate(
        () => document.querySelector("#landscape-tip").hidden,
      );
    }

    console.log(`[${label}]`);
    console.log(`  tutorialVisible: ${tutorialVisible}`);
    console.log(`  tipVisible: ${tipVisible}`);
    console.log(`  tipText: ${JSON.stringify(tipText)}`);
    console.log(`  tipStored: ${JSON.stringify(tipStored)}`);
    console.log(`  tipGoneAfterRotate: ${tipGoneAfterRotate}`);
    console.log(`  tipStillHidden: ${tipStillHidden}`);
    console.log(
      `  screenshots: ${[shot1, shot2, rotatedShot].filter(Boolean).join(", ")}`,
    );
    console.log(`  pageErrors: ${JSON.stringify(pageErrors.length ? pageErrors : "none")}`);
  } finally {
    await browser.close();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Best-effort temp profile cleanup.
    }
  }
}

try {
  await runFlow(390, 844, "portrait", true);
  await runFlow(844, 390, "landscape", false);
} catch (error) {
  console.error("Verification failed:", error);
  process.exitCode = 1;
}
