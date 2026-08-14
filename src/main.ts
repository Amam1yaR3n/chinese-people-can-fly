import { AudioController } from "./game/audio";
import { GameConfig } from "./game/config";
import { Game } from "./game/game";
import { loadCharacterSprites } from "./game/sprites";

interface VolumeSettings {
  music: number;
  effects: number;
}

const VOLUME_STORAGE_KEY = "chinese-people-can-fly:volume-settings";
const DEFAULT_VOLUME_SETTINGS: VolumeSettings = {
  music: 48,
  effects: 72,
};

const clampVolumePercent = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(100, Math.max(0, parsed)));
};

const loadVolumeSettings = (): VolumeSettings => {
  try {
    const stored = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_VOLUME_SETTINGS };
    const parsed = JSON.parse(stored) as Partial<VolumeSettings>;
    return {
      music: clampVolumePercent(
        parsed.music,
        DEFAULT_VOLUME_SETTINGS.music,
      ),
      effects: clampVolumePercent(
        parsed.effects,
        DEFAULT_VOLUME_SETTINGS.effects,
      ),
    };
  } catch {
    return { ...DEFAULT_VOLUME_SETTINGS };
  }
};

const saveVolumeSettings = (settings: VolumeSettings): void => {
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The game remains usable when storage is unavailable (for example, file URLs).
  }
};

const canvas = document.querySelector<HTMLCanvasElement>("#game");
const distanceOutput = document.querySelector<HTMLOutputElement>("#distance");
const scoreOutput = document.querySelector<HTMLOutputElement>("#score");
const resultPanel = document.querySelector<HTMLElement>("#result");
const resultScore = document.querySelector<HTMLElement>("#result-score");
const resultDistance = document.querySelector<HTMLElement>("#result-distance");
const portraitOverlay = document.querySelector<HTMLElement>("#portrait-overlay");
const settingsButton = document.querySelector<HTMLButtonElement>(
  "#settings-button",
);
const settingsDialog = document.querySelector<HTMLElement>("#settings-dialog");
const settingsClose = document.querySelector<HTMLButtonElement>(
  "#settings-close",
);
const musicVolumeInput = document.querySelector<HTMLInputElement>(
  "#music-volume",
);
const musicVolumeOutput = document.querySelector<HTMLOutputElement>(
  "#music-volume-value",
);
const effectsVolumeInput = document.querySelector<HTMLInputElement>(
  "#effects-volume",
);
const effectsVolumeOutput = document.querySelector<HTMLOutputElement>(
  "#effects-volume-value",
);

if (
  !canvas ||
  !distanceOutput ||
  !scoreOutput ||
  !resultPanel ||
  !resultScore ||
  !resultDistance ||
  !portraitOverlay ||
  !settingsButton ||
  !settingsDialog ||
  !settingsClose ||
  !musicVolumeInput ||
  !musicVolumeOutput ||
  !effectsVolumeInput ||
  !effectsVolumeOutput
) {
  throw new Error("游戏页面缺少必要的 DOM 元素。");
}

const context = canvas.getContext("2d");
if (!context) {
  throw new Error("当前浏览器不支持 Canvas 2D。");
}

const volumeSettings = loadVolumeSettings();
const audio = new AudioController(
  volumeSettings.music / 100,
  volumeSettings.effects / 100,
);
let game: Game | null = null;
let accumulator = 0;
let lastTimestamp = performance.now();
let hidden = document.hidden;
let portraitPaused = false;
let settingsOpen = false;
let gameEnded = false;
let musicPreviewTimer: number | null = null;

const updateAudioPause = (): void => {
  audio.setPaused(hidden || portraitPaused || settingsOpen || gameEnded);
};

const renderVolumeControl = (
  input: HTMLInputElement,
  output: HTMLOutputElement,
  value: number,
): void => {
  const formatted = `${value}%`;
  input.value = String(value);
  input.style.setProperty("--volume", formatted);
  output.value = formatted;
  output.textContent = formatted;
};

const stopMusicPreview = (): void => {
  if (musicPreviewTimer !== null) {
    window.clearTimeout(musicPreviewTimer);
    musicPreviewTimer = null;
  }
  updateAudioPause();
};

const previewMusic = async (): Promise<void> => {
  await audio.unlock();
  if (!settingsOpen || hidden || portraitPaused) return;
  if (musicPreviewTimer !== null) window.clearTimeout(musicPreviewTimer);
  audio.setPaused(false);
  musicPreviewTimer = window.setTimeout(() => {
    musicPreviewTimer = null;
    updateAudioPause();
  }, 700);
};

const setSettingsOpen = (open: boolean): void => {
  if (settingsOpen === open) return;
  settingsOpen = open;
  settingsDialog.hidden = !open;
  settingsButton.setAttribute("aria-expanded", String(open));
  settingsButton.setAttribute(
    "aria-label",
    open ? "关闭声音设置" : "打开声音设置",
  );
  document.body.toggleAttribute("data-settings-open", open);
  accumulator = 0;
  stopMusicPreview();

  if (open) {
    void audio.unlock();
    settingsClose.focus({ preventScroll: true });
    return;
  }

  settingsButton.focus({ preventScroll: true });
};

renderVolumeControl(
  musicVolumeInput,
  musicVolumeOutput,
  volumeSettings.music,
);
renderVolumeControl(
  effectsVolumeInput,
  effectsVolumeOutput,
  volumeSettings.effects,
);

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
  updateAudioPause();
};

const updateOutput = (
  output: HTMLOutputElement,
  value: string,
): void => {
  if (output.value === value) return;
  output.value = value;
  output.textContent = value;
};

const updateHud = (): void => {
  if (!game) return;
  const snapshot = game.getSnapshot();
  const endedChanged = gameEnded !== snapshot.ended;
  gameEnded = snapshot.ended;
  const formattedDistance = `${snapshot.distance} 米`;
  const formattedScore = `${snapshot.score} 分`;
  updateOutput(distanceOutput, formattedDistance);
  updateOutput(scoreOutput, formattedScore);
  resultPanel.hidden = !snapshot.ended;
  if (snapshot.ended) {
    resultScore.textContent = formattedScore;
    resultDistance.textContent = `最远距离 ${formattedDistance}`;
  }
  document.body.dataset.phase = snapshot.phase;
  if (endedChanged) updateAudioPause();
};

const performAction = (): void => {
  if (hidden || portraitPaused || settingsOpen || !game) return;
  void audio.unlock();
  game.action();
  updateHud();
};

window.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target;
    if (
      settingsOpen ||
      (target instanceof Element && target.closest("#settings-button"))
    ) {
      return;
    }
    event.preventDefault();
    performAction();
  },
  { passive: false },
);

window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && settingsOpen) {
    event.preventDefault();
    setSettingsOpen(false);
    return;
  }
  if (event.code !== "Space" || event.repeat) return;
  if (
    settingsOpen ||
    (event.target instanceof Element &&
      event.target.closest("button, input"))
  ) {
    return;
  }
  event.preventDefault();
  performAction();
});

settingsButton.addEventListener("click", () => {
  setSettingsOpen(!settingsOpen);
});

settingsClose.addEventListener("click", () => {
  setSettingsOpen(false);
});

musicVolumeInput.addEventListener("input", () => {
  volumeSettings.music = clampVolumePercent(
    musicVolumeInput.value,
    volumeSettings.music,
  );
  audio.setMusicVolume(volumeSettings.music / 100);
  renderVolumeControl(
    musicVolumeInput,
    musicVolumeOutput,
    volumeSettings.music,
  );
  saveVolumeSettings(volumeSettings);
  void previewMusic();
});

effectsVolumeInput.addEventListener("input", () => {
  volumeSettings.effects = clampVolumePercent(
    effectsVolumeInput.value,
    volumeSettings.effects,
  );
  audio.setEffectsVolume(volumeSettings.effects / 100);
  renderVolumeControl(
    effectsVolumeInput,
    effectsVolumeOutput,
    volumeSettings.effects,
  );
  saveVolumeSettings(volumeSettings);
});

effectsVolumeInput.addEventListener("change", async () => {
  await audio.unlock();
  audio.previewEffect();
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  hidden = document.hidden;
  accumulator = 0;
  lastTimestamp = performance.now();
  updateAudioPause();
});

const frame = (timestamp: number): void => {
  if (!game) return;
  const elapsed = Math.min(
    GameConfig.maxFrameDelta,
    Math.max(0, (timestamp - lastTimestamp) / 1000),
  );
  lastTimestamp = timestamp;

  if (!hidden && !portraitPaused && !settingsOpen) {
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

const startGame = async (): Promise<void> => {
  const sprites = await loadCharacterSprites();
  game = new Game((event) => audio.play(event), sprites);
  lastTimestamp = performance.now();
  resizeCanvas();
  updateHud();
  requestAnimationFrame(frame);
};

void startGame();
