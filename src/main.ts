import { AudioController } from "./game/audio";
import {
  loadCloudProgress,
  mergeProgress,
  queueCloudProgressSave,
} from "./game/cloud-progress";
import { GameConfig } from "./game/config";
import { Game } from "./game/game";
import {
  LAUNCHERS,
  isLauncherSelectable,
  isLauncherUnlocked,
  type LauncherId,
} from "./game/launchers";
import {
  createLeaderboardScoreQueue,
  loadLeaderboard,
} from "./game/leaderboard";
import {
  loadProgress,
  recordCompletedDistance,
  saveProgress,
  type ProgressV1,
} from "./game/progress";
import {
  loadBackgroundSprites,
  loadCharacterSprites,
  loadEffectSprites,
  loadHumanCannonSprites,
  loadMissileTruckSprites,
  loadSlingshotSprites,
} from "./game/sprites";
import type { GamePhase, Vec2 } from "./game/types";
import type {
  ToyMyRankReadResult,
  ToyRankItem,
} from "./platform/toy-sdk";

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
const leaderboardButton = document.querySelector<HTMLButtonElement>(
  "#leaderboard-button",
);
const leaderboardDialog = document.querySelector<HTMLElement>(
  "#leaderboard-dialog",
);
const leaderboardClose = document.querySelector<HTMLButtonElement>(
  "#leaderboard-close",
);
const leaderboardContent = document.querySelector<HTMLElement>(
  "#leaderboard-content",
);
const leaderboardStatus = document.querySelector<HTMLElement>(
  "#leaderboard-status",
);
const leaderboardStatusTitle = document.querySelector<HTMLElement>(
  "#leaderboard-status-title",
);
const leaderboardStatusDetail = document.querySelector<HTMLElement>(
  "#leaderboard-status-detail",
);
const leaderboardRetry = document.querySelector<HTMLButtonElement>(
  "#leaderboard-retry",
);
const leaderboardTable = document.querySelector<HTMLElement>(
  "#leaderboard-table",
);
const leaderboardList = document.querySelector<HTMLOListElement>(
  "#leaderboard-list",
);
const myRankPosition = document.querySelector<HTMLElement>(
  "#my-rank-position",
);
const myRankScore = document.querySelector<HTMLOutputElement>(
  "#my-rank-score",
);
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
const bestDistanceOutput = document.querySelector<HTMLOutputElement>(
  "#best-distance",
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
  !leaderboardButton ||
  !leaderboardDialog ||
  !leaderboardClose ||
  !leaderboardContent ||
  !leaderboardStatus ||
  !leaderboardStatusTitle ||
  !leaderboardStatusDetail ||
  !leaderboardRetry ||
  !leaderboardTable ||
  !leaderboardList ||
  !myRankPosition ||
  !myRankScore ||
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
  !bestDistanceOutput ||
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
const leaderboardScoreQueue = createLeaderboardScoreQueue();
let game: Game | null = null;
let accumulator = 0;
let lastTimestamp = performance.now();
let hidden = document.hidden;
let portraitPaused = false;
let settingsOpen = false;
let leaderboardOpen = false;
let tutorialOpen = false;
let unlockNoticePending = false;
let gameEnded = false;
let musicPreviewTimer: number | null = null;
let activeLauncherPointerId: number | null = null;
let pendingCloudLauncher: LauncherId | null = null;
let roundHasInteraction = false;
let leaderboardRequestId = 0;

const updateAudioPause = (): void => {
  audio.setPaused(
    hidden ||
      portraitPaused ||
      settingsOpen ||
      leaderboardOpen ||
      tutorialOpen ||
      gameEnded,
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

const applyPendingCloudLauncher = (): void => {
  if (
    !game ||
    !pendingCloudLauncher ||
    roundHasInteraction ||
    game.getSnapshot().phase !== "ready"
  ) {
    return;
  }

  game.setLauncher(pendingCloudLauncher);
  pendingCloudLauncher = null;
};

const finishGameInput = (phaseBeforeInput: GamePhase): void => {
  if (!game) return;
  const resetFromResult =
    phaseBeforeInput === "ended" && game.getSnapshot().phase === "ready";
  roundHasInteraction = !resetFromResult;
  if (resetFromResult) applyPendingCloudLauncher();
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
      pendingCloudLauncher = null;
      roundHasInteraction = false;
      game?.setLauncher(progress.selectedLauncher);
      queueCloudProgressSave(progress);
      renderLauncherGrid();
      updateHud();
    });
    return card;
  });

  launcherGrid.replaceChildren(...cards);
  bestDistanceOutput.value = `${progress.bestDistance}米`;
  bestDistanceOutput.textContent = bestDistanceOutput.value;
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

const formatRankScore = (score: number): string =>
  `${score.toLocaleString("zh-CN")} 分`;

const normalizeAvatarUrl = (value: string): string | null => {
  const candidate = value.trim();
  if (!candidate) return null;
  if (candidate.startsWith("//")) return `https:${candidate}`;

  try {
    const url = new URL(candidate, window.location.href);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const renderMyRank = (result: ToyMyRankReadResult | null): void => {
  if (!result) {
    myRankPosition.textContent = "加载中…";
    myRankScore.value = "";
    myRankScore.textContent = "";
    return;
  }

  if (result.status !== "ok") {
    myRankPosition.textContent = "登录后查看我的排名";
    myRankScore.value = "—";
    myRankScore.textContent = "—";
    return;
  }

  if (!result.ranked) {
    myRankPosition.textContent = "未上榜";
    myRankScore.value = "0 分";
    myRankScore.textContent = "0 分";
    return;
  }

  myRankPosition.textContent = `第 ${result.rank.toLocaleString("zh-CN")} 名`;
  const score = formatRankScore(result.score);
  myRankScore.value = score;
  myRankScore.textContent = score;
};

const showLeaderboardStatus = (
  title: string,
  detail: string,
  retry: boolean,
): void => {
  leaderboardTable.hidden = true;
  leaderboardStatus.hidden = false;
  leaderboardStatusTitle.textContent = title;
  leaderboardStatusDetail.textContent = detail;
  leaderboardRetry.hidden = !retry;
};

const renderLeaderboardList = (
  items: readonly ToyRankItem[],
  mine: ToyMyRankReadResult,
): void => {
  leaderboardList.replaceChildren();

  for (const item of items) {
    const nickname = item.nickname.trim() || "神秘飞行员";
    const row = document.createElement("li");
    row.className = "rank-row";
    if (item.rank >= 1 && item.rank <= 3) {
      row.classList.add(`is-top-${item.rank}`);
    }
    if (mine.status === "ok" && mine.ranked && mine.rank === item.rank) {
      row.classList.add("is-mine");
      row.setAttribute("aria-current", "true");
    }

    const rank = document.createElement("span");
    rank.className = "rank-position";
    rank.textContent = item.rank.toLocaleString("zh-CN");

    const player = document.createElement("span");
    player.className = "rank-player";
    const avatar = document.createElement("span");
    avatar.className = "rank-avatar";
    avatar.setAttribute("aria-hidden", "true");
    const avatarFallback = document.createElement("span");
    avatarFallback.textContent = Array.from(nickname)[0] ?? "飞";
    avatar.append(avatarFallback);

    const avatarUrl = normalizeAvatarUrl(item.avatar);
    if (avatarUrl) {
      const image = document.createElement("img");
      image.src = avatarUrl;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove(), { once: true });
      avatar.append(image);
    }

    const name = document.createElement("span");
    name.className = "rank-nickname";
    name.textContent = nickname;
    player.append(avatar, name);

    const score = document.createElement("span");
    score.className = "rank-score";
    score.textContent = formatRankScore(item.score);
    row.append(rank, player, score);
    leaderboardList.append(row);
  }

  leaderboardStatus.hidden = true;
  leaderboardRetry.hidden = true;
  leaderboardTable.hidden = false;
};

const refreshLeaderboard = async (): Promise<void> => {
  const requestId = ++leaderboardRequestId;
  leaderboardContent.setAttribute("aria-busy", "true");
  leaderboardList.replaceChildren();
  renderMyRank(null);
  showLeaderboardStatus(
    "正在加载排行榜…",
    "正在连接 B站 Toy 排行榜",
    false,
  );

  const result = await loadLeaderboard();
  if (!leaderboardOpen || requestId !== leaderboardRequestId) return;

  leaderboardContent.setAttribute("aria-busy", "false");
  renderMyRank(result.mine);
  if (result.list.status !== "ok") {
    showLeaderboardStatus(
      "排行榜暂不可用",
      "请在 B站内打开本游戏后重试，当前游戏进度不受影响。",
      true,
    );
    return;
  }

  if (result.list.items.length === 0) {
    showLeaderboardStatus(
      "还没有玩家上榜",
      "完成一局后，你的最高单局分就有机会出现在这里。",
      false,
    );
    return;
  }

  renderLeaderboardList(result.list.items, result.mine);
};

const setSettingsOpen = (open: boolean, restoreFocus = true): void => {
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

  if (restoreFocus) settingsButton.focus({ preventScroll: true });
};

const setLeaderboardOpen = (open: boolean, restoreFocus = true): void => {
  if (leaderboardOpen === open) return;
  if (open) {
    leaderboardOpen = true;
    if (settingsOpen) setSettingsOpen(false, false);
    cancelActiveLauncherGesture();
  } else {
    leaderboardOpen = false;
  }

  leaderboardDialog.hidden = !open;
  leaderboardButton.setAttribute("aria-expanded", String(open));
  leaderboardButton.setAttribute(
    "aria-label",
    open ? "关闭排行榜" : "打开排行榜",
  );
  document.body.toggleAttribute("data-leaderboard-open", open);
  accumulator = 0;
  updateAudioPause();

  if (open) {
    leaderboardClose.focus({ preventScroll: true });
    void refreshLeaderboard();
    return;
  }

  leaderboardRequestId += 1;
  leaderboardContent.setAttribute("aria-busy", "false");
  if (restoreFocus) leaderboardButton.focus({ preventScroll: true });
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

const progressMatches = (
  first: ProgressV1,
  second: ProgressV1,
): boolean =>
  first.bestDistance === second.bestDistance &&
  first.selectedLauncher === second.selectedLauncher;

const syncProgressFromCloud = async (
  progressAtSyncStart: ProgressV1,
): Promise<void> => {
  const result = await loadCloudProgress();
  if (result.status === "empty") {
    queueCloudProgressSave(progress);
    return;
  }
  if (result.status !== "loaded") return;

  const mergedProgress = mergeProgress(
    progress,
    result.progress,
    progress !== progressAtSyncStart,
  );
  const localNeedsUpdate = !progressMatches(progress, mergedProgress);

  if (localNeedsUpdate) {
    progress = saveProgress(mergedProgress);
    if (game) {
      pendingCloudLauncher = progress.selectedLauncher;
      applyPendingCloudLauncher();
    }
    renderLauncherGrid();
    updateHud();
  }

  if (!progressMatches(result.progress, mergedProgress)) {
    queueCloudProgressSave(mergedProgress);
  }
};

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
    leaderboardScoreQueue.enqueue(snapshot.score);
  }
  if (snapshot.ended && !gameEnded) {
    const previousBestDistance = progress.bestDistance;
    const nextProgress = recordCompletedDistance(progress, snapshot.distance);
    if (nextProgress !== progress) {
      progress = nextProgress;
      queueCloudProgressSave(progress);
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
  if (
    hidden ||
    portraitPaused ||
    settingsOpen ||
    leaderboardOpen ||
    tutorialOpen ||
    !game
  ) {
    return;
  }
  void audio.unlock();
  applyPendingCloudLauncher();
  const phaseBeforeInput = game.getSnapshot().phase;
  game.action();
  finishGameInput(phaseBeforeInput);
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
      leaderboardOpen ||
      tutorialOpen ||
      (target instanceof Element &&
        target.closest("#settings-button, #leaderboard-button"))
    ) {
      return;
    }
    if (hidden || portraitPaused || !game) return;
    event.preventDefault();
    void audio.unlock();
    applyPendingCloudLauncher();
    const phaseBeforeInput = game.getSnapshot().phase;
    const beganLauncherDrag = game.pointerDown(
      pointerToLogicalPosition(event),
    );
    finishGameInput(phaseBeforeInput);
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
  if (
    event.code === "Escape" &&
    (settingsOpen || leaderboardOpen || tutorialOpen)
  ) {
    event.preventDefault();
    if (tutorialOpen) {
      setTutorialOpen(false);
    } else if (leaderboardOpen) {
      setLeaderboardOpen(false);
    } else {
      setSettingsOpen(false);
    }
    return;
  }
  if (event.code !== "Space" || event.repeat) return;
  if (
    settingsOpen ||
    leaderboardOpen ||
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
  if (leaderboardOpen) setLeaderboardOpen(false, false);
  setSettingsOpen(!settingsOpen);
});

settingsClose.addEventListener("click", () => {
  setSettingsOpen(false);
});

leaderboardButton.addEventListener("click", () => {
  setLeaderboardOpen(!leaderboardOpen);
});

leaderboardClose.addEventListener("click", () => {
  setLeaderboardOpen(false);
});

leaderboardRetry.addEventListener("click", () => {
  void refreshLeaderboard();
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

  if (
    !hidden &&
    !portraitPaused &&
    !settingsOpen &&
    !leaderboardOpen &&
    !tutorialOpen
  ) {
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
    backgroundSprites,
  ] =
    await Promise.all([
      loadCharacterSprites(),
      loadSlingshotSprites(),
      loadHumanCannonSprites(),
      loadMissileTruckSprites(),
      loadEffectSprites(),
      loadBackgroundSprites(),
    ]);
  game = new Game(
    (event) => audio.play(event),
    sprites,
    slingshotSprites,
    humanCannonSprites,
    missileTruckSprites,
    progress.selectedLauncher,
    effectSprites,
    backgroundSprites,
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

const progressAtCloudSyncStart = progress;
void syncProgressFromCloud(progressAtCloudSyncStart);
void startGame();
