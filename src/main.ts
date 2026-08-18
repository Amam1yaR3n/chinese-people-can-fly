import { AudioController } from "./game/audio";
import { GameConfig } from "./game/config";
import { Game } from "./game/game";
import {
  LAUNCHERS,
  isLauncherSelectable,
  isLauncherUnlocked,
} from "./game/launchers";
import {
  loadProgress,
  recordCompletedDistance,
  saveProgress,
  type ProgressV1,
} from "./game/progress";
import {
  loadCharacterSprites,
  loadEffectSprites,
  loadHumanCannonSprites,
  loadMissileTruckSprites,
  loadSlingshotSprites,
} from "./game/sprites";
import type { Vec2 } from "./game/types";

interface VolumeSettings {
  music: number;
  effects: number;
}

const VOLUME_STORAGE_KEY = "chinese-people-can-fly:volume-settings";
const TUTORIAL_STORAGE_KEY = "chinese-people-can-fly:tutorial-shown";
const UNLOCK_NOTICE_STORAGE_KEY =
  "chinese-people-can-fly:launcher-unlock-notice";
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

const hasSeenTutorial = (): boolean => {
  try {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const markTutorialSeen = (): void => {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "1");
  } catch {
    // The current session keeps the tutorial dismissed once closed.
  }
};

const loadUnlockNoticePending = (): boolean => {
  try {
    return window.localStorage.getItem(UNLOCK_NOTICE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const saveUnlockNoticePending = (pending: boolean): void => {
  try {
    if (pending) {
      window.localStorage.setItem(UNLOCK_NOTICE_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(UNLOCK_NOTICE_STORAGE_KEY);
    }
  } catch {
    // The current session still reflects the pending state in memory.
  }
};

const canvas = document.querySelector<HTMLCanvasElement>("#game");
const distanceOutput = document.querySelector<HTMLOutputElement>("#distance");
const scoreOutput = document.querySelector<HTMLOutputElement>("#score");
const resultPanel = document.querySelector<HTMLElement>("#result");
const resultScore = document.querySelector<HTMLElement>("#result-score");
const resultDistance = document.querySelector<HTMLElement>("#result-distance");
const resultMessage = document.querySelector<HTMLElement>("#result-message");
const portraitOverlay = document.querySelector<HTMLElement>("#portrait-overlay");
const tutorialDialog = document.querySelector<HTMLElement>("#tutorial-dialog");
const tutorialClose = document.querySelector<HTMLButtonElement>(
  "#tutorial-close",
);
const unlockNotice = document.querySelector<HTMLElement>("#unlock-notice");
const settingsButton = document.querySelector<HTMLButtonElement>(
  "#settings-button",
);
const settingsDialog = document.querySelector<HTMLElement>("#settings-dialog");
const settingsClose = document.querySelector<HTMLButtonElement>(
  "#settings-close",
);
const launcherGrid = document.querySelector<HTMLElement>("#launcher-grid");
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
  !resultMessage ||
  !portraitOverlay ||
  !tutorialDialog ||
  !tutorialClose ||
  !unlockNotice ||
  !settingsButton ||
  !settingsDialog ||
  !settingsClose ||
  !launcherGrid ||
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
let progress: ProgressV1 = loadProgress();
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
let tutorialOpen = false;
let unlockNoticePending = false;
let gameEnded = false;
let musicPreviewTimer: number | null = null;
let activeLauncherPointerId: number | null = null;

const updateAudioPause = (): void => {
  audio.setPaused(
    hidden || portraitPaused || settingsOpen || tutorialOpen || gameEnded,
  );
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

const releaseLauncherPointerCapture = (pointerId: number): void => {
  try {
    if (canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  } catch {
    // The pointer may already have been released by the browser.
  }
};

const cancelActiveLauncherGesture = (): void => {
  game?.cancelLauncherGesture();
  if (activeLauncherPointerId !== null) {
    releaseLauncherPointerCapture(activeLauncherPointerId);
    activeLauncherPointerId = null;
  }
};

const renderLauncherGrid = (): void => {
  const cards = LAUNCHERS.map((launcher) => {
    const unlocked = isLauncherUnlocked(launcher, progress.bestDistance);
    const selectable = isLauncherSelectable(launcher, progress.bestDistance);
    const selected = launcher.id === progress.selectedLauncher;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "launcher-card";
    card.dataset.launcherId = launcher.id;
    card.classList.toggle("is-locked", !unlocked);
    card.classList.toggle("is-unavailable", unlocked && !selectable);
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
    card.setAttribute("aria-disabled", String(!selectable));
    card.setAttribute(
      "aria-label",
      unlocked
        ? `${launcher.name}${selectable ? "" : "，尚不可用"}`
        : `未解锁，${launcher.unlockDistance} 米解锁`,
    );

    const iconArea = document.createElement("span");
    iconArea.className = "launcher-card-icon";
    const icon = document.createElement("img");
    icon.src = launcher.iconPath;
    icon.alt = "";
    icon.draggable = false;
    iconArea.append(icon);

    const name = document.createElement("strong");
    name.className = "launcher-card-name";
    name.textContent = unlocked ? launcher.name : "？？？";

    const detail = document.createElement("small");
    detail.className = "launcher-card-detail";
    detail.textContent = unlocked
      ? "\u00a0"
      : `${launcher.unlockDistance}m 解锁`;

    card.append(iconArea, name, detail);
    card.addEventListener("click", () => {
      if (!selectable || selected) return;
      progress = saveProgress({
        ...progress,
        selectedLauncher: launcher.id,
      });
      game?.setLauncher(progress.selectedLauncher);
      renderLauncherGrid();
      updateHud();
    });
    return card;
  });

  launcherGrid.replaceChildren(...cards);
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
  if (open) cancelActiveLauncherGesture();
  settingsOpen = open;
  settingsDialog.hidden = !open;
  settingsButton.setAttribute("aria-expanded", String(open));
  settingsButton.setAttribute(
    "aria-label",
    open ? "关闭游戏设置" : "打开游戏设置",
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

const setTutorialOpen = (open: boolean): void => {
  if (tutorialOpen === open) return;
  tutorialOpen = open;
  tutorialDialog.hidden = !open;
  document.body.toggleAttribute("data-tutorial-open", open);
  accumulator = 0;

  if (open) {
    tutorialClose.focus({ preventScroll: true });
    return;
  }

  markTutorialSeen();
  settingsButton.focus({ preventScroll: true });
};

const hasNewlyUnlockedLauncher = (
  previousBestDistance: number,
  nextBestDistance: number,
): boolean =>
  LAUNCHERS.some(
    (launcher) =>
      launcher.unlockDistance > previousBestDistance &&
      launcher.unlockDistance <= nextBestDistance,
  );

const setUnlockNoticeVisible = (visible: boolean): void => {
  unlockNotice.hidden = !visible;
};

const dismissUnlockNotice = (): void => {
  if (!unlockNoticePending) return;
  unlockNoticePending = false;
  saveUnlockNoticePending(false);
  setUnlockNoticeVisible(false);
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
renderLauncherGrid();

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
  if (portraitPaused) {
    accumulator = 0;
    cancelActiveLauncherGesture();
  }
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

const RESULT_MESSAGES: readonly {
  readonly min: number;
  readonly max: number;
  readonly options: readonly string[];
}[] = [
  {
    min: 0,
    max: 2000,
    options: ["难道中国人不能飞？", "！？区区？！", "飞到八分钱了"],
  },
  { min: 2000, max: 5000, options: ["下次可以飞得更远！"] },
  {
    min: 5000,
    max: Number.POSITIVE_INFINITY,
    options: [
      "这么强？！",
      "击败了99.9％的中国人",
      "击败了100％的美国人",
      "击败了100％的日本人",
    ],
  },
];

const pickResultMessage = (distance: number): string => {
  const range =
    RESULT_MESSAGES.find(
      (entry) => distance >= entry.min && distance < entry.max,
    ) ?? RESULT_MESSAGES[RESULT_MESSAGES.length - 1];
  return range.options[Math.floor(Math.random() * range.options.length)];
};

const updateHud = (): void => {
  if (!game) return;
  const snapshot = game.getSnapshot();
  const endedChanged = gameEnded !== snapshot.ended;
  if (snapshot.ended && !gameEnded) {
    resultMessage.textContent = pickResultMessage(snapshot.distance);
  }
  if (snapshot.ended && !gameEnded) {
    const previousBestDistance = progress.bestDistance;
    const nextProgress = recordCompletedDistance(progress, snapshot.distance);
    if (nextProgress !== progress) {
      progress = nextProgress;
      if (
        hasNewlyUnlockedLauncher(
          previousBestDistance,
          progress.bestDistance,
        )
      ) {
        unlockNoticePending = true;
        saveUnlockNoticePending(true);
        setUnlockNoticeVisible(true);
      }
      renderLauncherGrid();
    }
  }
  gameEnded = snapshot.ended;
  const formattedDistance = `${snapshot.distance} 米`;
  const formattedScore = `${snapshot.score} 分`;
  updateOutput(distanceOutput, formattedDistance);
  updateOutput(scoreOutput, formattedScore);
  resultPanel.hidden = !snapshot.ended;
  if (snapshot.ended) {
    resultScore.textContent = formattedScore;
    resultDistance.textContent = `你飞了${snapshot.distance}米`;
  }
  document.body.dataset.phase = snapshot.phase;
  if (endedChanged) updateAudioPause();
};

const performAction = (): void => {
  if (hidden || portraitPaused || settingsOpen || tutorialOpen || !game) return;
  void audio.unlock();
  game.action();
  updateHud();
};

const pointerToLogicalPosition = (event: PointerEvent): Vec2 => {
  const bounds = canvas.getBoundingClientRect();
  return {
    x:
      ((event.clientX - bounds.left) / Math.max(1, bounds.width)) *
      GameConfig.logicalWidth,
    y:
      ((event.clientY - bounds.top) / Math.max(1, bounds.height)) *
      GameConfig.logicalHeight,
  };
};

window.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target;
    if (
      settingsOpen ||
      tutorialOpen ||
      (target instanceof Element && target.closest("#settings-button"))
    ) {
      return;
    }
    if (hidden || portraitPaused || !game) return;
    event.preventDefault();
    void audio.unlock();
    const beganLauncherDrag = game.pointerDown(
      pointerToLogicalPosition(event),
    );
    if (beganLauncherDrag) {
      activeLauncherPointerId = event.pointerId;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Window-level move/up handlers still provide a safe fallback.
      }
    }
    updateHud();
  },
  { passive: false },
);

window.addEventListener(
  "pointermove",
  (event) => {
    if (event.pointerId !== activeLauncherPointerId || !game) return;
    event.preventDefault();
    game.pointerMove(pointerToLogicalPosition(event));
  },
  { passive: false },
);

window.addEventListener(
  "pointerup",
  (event) => {
    if (event.pointerId !== activeLauncherPointerId || !game) return;
    event.preventDefault();
    game.pointerUp(pointerToLogicalPosition(event));
    releaseLauncherPointerCapture(event.pointerId);
    activeLauncherPointerId = null;
    updateHud();
  },
  { passive: false },
);

window.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== activeLauncherPointerId) return;
  cancelActiveLauncherGesture();
});

canvas.addEventListener("lostpointercapture", (event) => {
  if (event.pointerId !== activeLauncherPointerId) return;
  activeLauncherPointerId = null;
  game?.cancelLauncherGesture();
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && (settingsOpen || tutorialOpen)) {
    event.preventDefault();
    if (tutorialOpen) {
      setTutorialOpen(false);
    } else {
      setSettingsOpen(false);
    }
    return;
  }
  if (event.code !== "Space" || event.repeat) return;
  if (
    settingsOpen ||
    tutorialOpen ||
    (event.target instanceof Element &&
      event.target.closest("button, input"))
  ) {
    return;
  }
  event.preventDefault();
  performAction();
});

settingsButton.addEventListener("click", () => {
  dismissUnlockNotice();
  setSettingsOpen(!settingsOpen);
});

settingsClose.addEventListener("click", () => {
  setSettingsOpen(false);
});

tutorialClose.addEventListener("click", () => {
  setTutorialOpen(false);
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
  if (hidden) cancelActiveLauncherGesture();
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

  if (!hidden && !portraitPaused && !settingsOpen && !tutorialOpen) {
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
  const [
    sprites,
    slingshotSprites,
    humanCannonSprites,
    missileTruckSprites,
    effectSprites,
  ] =
    await Promise.all([
      loadCharacterSprites(),
      loadSlingshotSprites(),
      loadHumanCannonSprites(),
      loadMissileTruckSprites(),
      loadEffectSprites(),
    ]);
  game = new Game(
    (event) => audio.play(event),
    sprites,
    slingshotSprites,
    humanCannonSprites,
    missileTruckSprites,
    progress.selectedLauncher,
    effectSprites,
  );
  lastTimestamp = performance.now();
  resizeCanvas();
  updateHud();
  requestAnimationFrame(frame);
};

if (!hasSeenTutorial()) {
  setTutorialOpen(true);
}

unlockNoticePending = loadUnlockNoticePending();
setUnlockNoticeVisible(unlockNoticePending);

void startGame();
