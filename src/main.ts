import { AudioController } from "./game/audio";
import { GameConfig } from "./game/config";
import { Game } from "./game/game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
const distanceOutput = document.querySelector<HTMLOutputElement>("#distance");
const resultPanel = document.querySelector<HTMLElement>("#result");
const resultDistance = document.querySelector<HTMLElement>("#result-distance");
const muteButton = document.querySelector<HTMLButtonElement>("#mute");
const portraitOverlay = document.querySelector<HTMLElement>("#portrait-overlay");

if (
  !canvas ||
  !distanceOutput ||
  !resultPanel ||
  !resultDistance ||
  !muteButton ||
  !portraitOverlay
) {
  throw new Error("游戏页面缺少必要的 DOM 元素。");
}

const context = canvas.getContext("2d");
if (!context) {
  throw new Error("当前浏览器不支持 Canvas 2D。");
}

const audio = new AudioController();
const game = new Game((event) => audio.play(event));
let accumulator = 0;
let lastTimestamp = performance.now();
let hidden = document.hidden;
let portraitPaused = false;

const resizeCanvas = (): void => {
  const pixelRatio = clampPixelRatio(window.devicePixelRatio || 1);
  const width = Math.round(GameConfig.logicalWidth * pixelRatio);
  const height = Math.round(GameConfig.logicalHeight * pixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.imageSmoothingEnabled = true;
  updateOrientationPause();
};

const clampPixelRatio = (ratio: number): number => Math.min(2, Math.max(1, ratio));

const updateOrientationPause = (): void => {
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  portraitPaused = coarsePointer && window.innerHeight > window.innerWidth;
  portraitOverlay.hidden = !portraitPaused;
  if (portraitPaused) accumulator = 0;
};

const updateHud = (): void => {
  const snapshot = game.getSnapshot();
  const formattedDistance = `${snapshot.distance} 米`;
  if (distanceOutput.value !== formattedDistance) {
    distanceOutput.value = formattedDistance;
    distanceOutput.textContent = formattedDistance;
  }
  resultPanel.hidden = !snapshot.ended;
  if (snapshot.ended) {
    resultDistance.textContent = formattedDistance;
  }
  document.body.dataset.phase = snapshot.phase;
};

const performAction = (): void => {
  void audio.unlock();
  if (hidden || portraitPaused) return;
  game.action();
  updateHud();
};

window.addEventListener(
  "pointerdown",
  (event) => {
    if ((event.target as Element | null)?.closest("#mute")) return;
    event.preventDefault();
    performAction();
  },
  { passive: false },
);

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat) return;
  event.preventDefault();
  performAction();
});

muteButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
});

muteButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  void audio.unlock();
  const muted = audio.toggleMuted();
  muteButton.textContent = muted ? "声音 关" : "声音 开";
  muteButton.setAttribute("aria-pressed", String(muted));
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  hidden = document.hidden;
  accumulator = 0;
  lastTimestamp = performance.now();
});

const frame = (timestamp: number): void => {
  const elapsed = Math.min(
    GameConfig.maxFrameDelta,
    Math.max(0, (timestamp - lastTimestamp) / 1000),
  );
  lastTimestamp = timestamp;

  if (!hidden && !portraitPaused) {
    accumulator += elapsed;
    while (accumulator >= GameConfig.fixedStep) {
      game.update(GameConfig.fixedStep);
      accumulator -= GameConfig.fixedStep;
    }
  }

  game.render(context);
  updateHud();
  requestAnimationFrame(frame);
};

resizeCanvas();
updateHud();
requestAnimationFrame(frame);
