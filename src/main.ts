import { AudioController } from "./game/audio";
import {
  loadCloudProgress,
  mergeProgress,
  queueCloudProgressSave,
} from "./game/cloud-progress";
import { GameConfig } from "./game/config";
import { Game } from "./game/game";
import {
  DEFAULT_LAUNCHER_ID,
  LAUNCHERS,
  getLauncherDefinition,
  isLauncherSelectable,
  isLauncherUnlocked,
  type LauncherId,
  type LauncherUnlockState,
} from "./game/launchers";
import {
  createLeaderboardDistanceQueue,
  loadLeaderboard,
  type LeaderboardMyRankReadResult,
  type LeaderboardRankItem,
} from "./game/leaderboard";
import {
  loadProgress,
  recordCompletedDistance,
  saveProgress,
  type ProgressV1,
} from "./game/progress";
import { formatResultMessage } from "./game/result-message";
import {
  loadBackgroundSprites,
  loadCharacterSprites,
  loadEffectSprites,
  loadHumanCannonSprites,
  loadMissileTruckSprites,
  loadSlingshotSprites,
} from "./game/sprites";
import type { GamePhase, Vec2 } from "./game/types";
import {
  navigateToy,
  prepareToyNavigation,
  readToyAuthorRelation,
  readToyAuthorVideos,
  readToyVideoUserActions,
  type ToyAuthorRelationFailureReason,
  type ToyNavigationRequest,
  type ToyVideoUserActionsFailureReason,
} from "./platform/toy-sdk";

interface VolumeSettings {
  music: number;
  effects: number;
}

type LauncherAccessStatus = "loading" | "ready" | "unavailable" | "error";
type LauncherAccessFailureReason =
  | ToyAuthorRelationFailureReason
  | ToyVideoUserActionsFailureReason;

const VOLUME_STORAGE_KEY = "chinese-people-can-fly:volume-settings";
const TUTORIAL_STORAGE_KEY = "chinese-people-can-fly:tutorial-shown";
const UNLOCK_NOTICE_STORAGE_KEY =
  "chinese-people-can-fly:interaction-unlock-notice-v1";
const AUTHOR_ID = "137429365";
const FEATURED_VIDEO_BVID = "BV1VBbk6EEJP";
const FEATURED_VIDEO_AID = 117_098_575_566_525;
const NAVIGATION_STATUS_DURATION_MS = 3_000;
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
const leaderboardButton = document.querySelector<HTMLButtonElement>(
  "#leaderboard-button",
);
const audioButton = document.querySelector<HTMLButtonElement>("#audio-button");
const audioDialog = document.querySelector<HTMLElement>("#audio-dialog");
const audioClose = document.querySelector<HTMLButtonElement>("#audio-close");
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
const myRankDistance = document.querySelector<HTMLOutputElement>(
  "#my-rank-distance",
);
const resultPanel = document.querySelector<HTMLElement>("#result");
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
const launcherAccessStatus = document.querySelector<HTMLElement>(
  "#launcher-access-status",
);
const launcherAccessStatusText = document.querySelector<HTMLElement>(
  "#launcher-access-status-text",
);
const launcherAccessRetry = document.querySelector<HTMLButtonElement>(
  "#launcher-access-retry",
);
const bestDistanceOutput = document.querySelector<HTMLOutputElement>(
  "#best-distance",
);
const authorHomeButton = document.querySelector<HTMLButtonElement>(
  "#author-home-button",
);
const featuredVideoButton = document.querySelector<HTMLButtonElement>(
  "#featured-video-button",
);
const featuredVideoTitle = document.querySelector<HTMLElement>(
  "#featured-video-title",
);
const featuredVideoImage = document.querySelector<HTMLImageElement>(
  "#featured-video-image",
);
const promotionStatus = document.querySelector<HTMLElement>(
  "#promotion-status",
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
  !leaderboardButton ||
  !audioButton ||
  !audioDialog ||
  !audioClose ||
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
  !myRankDistance ||
  !resultPanel ||
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
  !launcherAccessStatus ||
  !launcherAccessStatusText ||
  !launcherAccessRetry ||
  !bestDistanceOutput ||
  !authorHomeButton ||
  !featuredVideoButton ||
  !featuredVideoTitle ||
  !featuredVideoImage ||
  !promotionStatus ||
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
const leaderboardDistanceQueue = createLeaderboardDistanceQueue();
leaderboardDistanceQueue.enqueue(progress.bestDistance);
let game: Game | null = null;
let accumulator = 0;
let lastTimestamp = performance.now();
let hidden = document.hidden;
let portraitPaused = false;
let settingsOpen = false;
let leaderboardOpen = false;
let audioOpen = false;
let tutorialOpen = false;
let unlockNoticePending = false;
let gameEnded = false;
let musicPreviewTimer: number | null = null;
let activeLauncherPointerId: number | null = null;
let pendingGameLauncher: LauncherId | null = null;
let roundHasInteraction = false;
let leaderboardRequestId = 0;
let promotionStatusTimer: number | null = null;
let featuredVideoMetadataPromise: Promise<void> | null = null;
let launcherAccessRefreshPromise: Promise<void> | null = null;
let launcherUnlockState: LauncherUnlockState | null = null;
let lastConfirmedUnlockState: LauncherUnlockState | null = null;
let launcherAccessState: LauncherAccessStatus = "loading";
let launcherAccessFailureReason: LauncherAccessFailureReason | null = null;

const updateAudioPause = (): void => {
  audio.setPaused(
    hidden ||
      portraitPaused ||
      settingsOpen ||
      leaderboardOpen ||
      audioOpen ||
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

const applyPendingGameLauncher = (): void => {
  if (
    !game ||
    !pendingGameLauncher ||
    roundHasInteraction ||
    game.getSnapshot().phase !== "ready"
  ) {
    return;
  }

  game.setLauncher(pendingGameLauncher);
  pendingGameLauncher = null;
};

const desiredLauncherId = (): LauncherId => {
  const preferredLauncher = getLauncherDefinition(progress.selectedLauncher);
  return isLauncherSelectable(preferredLauncher, launcherUnlockState)
    ? preferredLauncher.id
    : DEFAULT_LAUNCHER_ID;
};

const reconcileActiveLauncher = (): void => {
  const desiredLauncher = desiredLauncherId();
  if (!game) {
    pendingGameLauncher = desiredLauncher;
    return;
  }

  const snapshot = game.getSnapshot();
  if (snapshot.launcherId === desiredLauncher) {
    pendingGameLauncher = null;
    return;
  }

  if (snapshot.phase === "ready" && !roundHasInteraction) {
    game.setLauncher(desiredLauncher);
    pendingGameLauncher = null;
    return;
  }

  pendingGameLauncher = desiredLauncher;
};

const finishGameInput = (phaseBeforeInput: GamePhase): void => {
  if (!game) return;
  const resetFromResult =
    phaseBeforeInput === "ended" && game.getSnapshot().phase === "ready";
  roundHasInteraction = !resetFromResult;
  if (resetFromResult) applyPendingGameLauncher();
};

const renderLauncherAccessStatus = (): void => {
  launcherGrid.setAttribute(
    "aria-busy",
    String(launcherAccessState === "loading"),
  );

  if (launcherAccessState === "ready") {
    launcherAccessStatus.hidden = true;
    launcherAccessRetry.hidden = true;
    launcherAccessRetry.disabled = true;
    return;
  }

  launcherAccessStatus.hidden = false;
  if (launcherAccessState === "loading") {
    launcherAccessStatusText.textContent = "正在核验视频互动与关注状态…";
    launcherAccessRetry.hidden = true;
    launcherAccessRetry.disabled = true;
    return;
  }

  if (launcherAccessState === "unavailable") {
    launcherAccessStatusText.textContent = "当前环境不支持互动核验，请在 B站 App 或网页内打开";
  } else if (launcherAccessFailureReason === "not_logged_in") {
    launcherAccessStatusText.textContent = "请先登录 B站，再刷新互动状态";
  } else if (launcherAccessFailureReason === "video_unavailable") {
    launcherAccessStatusText.textContent =
      "该视频不属于当前 Toy 发布者；请使用火山哥哥账号发布此 Toy";
  } else if (launcherAccessFailureReason === "unexpected_response") {
    launcherAccessStatusText.textContent = "互动状态返回异常，请更新发布包后重试";
  } else {
    launcherAccessStatusText.textContent = "互动状态请求失败，请检查网络后重试";
  }
  launcherAccessRetry.hidden = false;
  launcherAccessRetry.disabled = false;
};

const renderLauncherGrid = (): void => {
  const confirmedUnlockState =
    launcherAccessState === "ready" ? launcherUnlockState : null;
  const activeLauncher =
    game?.getSnapshot().launcherId ?? DEFAULT_LAUNCHER_ID;
  const cards = LAUNCHERS.map((launcher) => {
    const unlocked = isLauncherUnlocked(launcher, confirmedUnlockState);
    const selectable = isLauncherSelectable(launcher, confirmedUnlockState);
    const selected = launcher.id === activeLauncher;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "launcher-card";
    card.dataset.launcherId = launcher.id;
    card.classList.toggle("is-locked", !unlocked);
    card.classList.toggle("is-unavailable", unlocked && !selectable);
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
    card.setAttribute("aria-disabled", String(!selectable));

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
    detail.textContent = !launcher.implemented
      ? "尚不可用"
      : !unlocked
        ? launcher.unlockHint
        : selected
          ? "当前使用"
          : launcher.unlockRequirement === "always"
            ? launcher.unlockHint
            : "已解锁";
    card.setAttribute(
      "aria-label",
      `${unlocked ? launcher.name : "未解锁装置"}，${detail.textContent}`,
    );

    card.append(iconArea, name, detail);
    card.addEventListener("click", () => {
      if (!selectable || selected) return;
      progress = saveProgress({
        ...progress,
        selectedLauncher: launcher.id,
      });
      pendingGameLauncher = null;
      roundHasInteraction = false;
      game?.setLauncher(progress.selectedLauncher);
      queueCloudProgressSave(progress);
      renderLauncherGrid();
      updateHud();
    });
    return card;
  });

  launcherGrid.replaceChildren(...cards);
  renderLauncherAccessStatus();
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
  if (!audioOpen || hidden || portraitPaused) return;
  if (musicPreviewTimer !== null) window.clearTimeout(musicPreviewTimer);
  audio.setPaused(false);
  musicPreviewTimer = window.setTimeout(() => {
    musicPreviewTimer = null;
    updateAudioPause();
  }, 700);
};

const formatRankDistance = (distance: number): string =>
  `${distance.toLocaleString("zh-CN")} 米`;

const normalizeRemoteUrl = (value: string): string | null => {
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

const fallbackVideoCoverUrl = new URL(
  featuredVideoImage.dataset.fallbackSrc ?? featuredVideoImage.src,
  document.baseURI,
).href;

featuredVideoImage.addEventListener("error", () => {
  if (featuredVideoImage.src !== fallbackVideoCoverUrl) {
    featuredVideoImage.src = fallbackVideoCoverUrl;
  }
});

const clearPromotionStatus = (): void => {
  if (promotionStatusTimer !== null) {
    window.clearTimeout(promotionStatusTimer);
    promotionStatusTimer = null;
  }
  promotionStatus.textContent = "";
  promotionStatus.hidden = true;
};

const showPromotionStatus = (message: string): void => {
  if (promotionStatusTimer !== null) {
    window.clearTimeout(promotionStatusTimer);
  }
  promotionStatus.textContent = message;
  promotionStatus.hidden = false;
  promotionStatusTimer = window.setTimeout(() => {
    promotionStatusTimer = null;
    promotionStatus.textContent = "";
    promotionStatus.hidden = true;
  }, NAVIGATION_STATUS_DURATION_MS);
};

const requestPromotionNavigation = (request: ToyNavigationRequest): void => {
  clearPromotionStatus();
  const navigation = navigateToy(request);
  void navigation.then((result) => {
    if (result.status !== "ok") {
      showPromotionStatus("请在 B站内打开后重试");
    }
  });
};

const refreshFeaturedVideoMetadata = (): Promise<void> => {
  if (featuredVideoMetadataPromise) return featuredVideoMetadataPromise;

  const request = (async (): Promise<void> => {
    const result = await readToyAuthorVideos({
      videos: [{ bvid: FEATURED_VIDEO_BVID }],
    });
    if (result.status !== "ok") return;

    const video = result.items.find(
      ({ bvid }) => bvid === FEATURED_VIDEO_BVID,
    );
    if (!video) return;
    if (video.aid !== FEATURED_VIDEO_AID) {
      console.warn("[ToySDK] 推荐视频的 BV 与 AID 不匹配，已保留本地配置。", video);
      return;
    }

    featuredVideoTitle.textContent = video.title;
    featuredVideoButton.setAttribute("aria-label", `播放：${video.title}`);
    const coverUrl = normalizeRemoteUrl(video.cover);
    if (coverUrl) featuredVideoImage.src = coverUrl;
  })();

  featuredVideoMetadataPromise = request;
  void request.then(() => {
    if (featuredVideoMetadataPromise === request) {
      featuredVideoMetadataPromise = null;
    }
  });
  return request;
};

const hasNewInteractionUnlock = (
  previous: LauncherUnlockState,
  next: LauncherUnlockState,
): boolean =>
  LAUNCHERS.some(
    (launcher) =>
      launcher.unlockRequirement !== "always" &&
      !isLauncherUnlocked(launcher, previous) &&
      isLauncherUnlocked(launcher, next),
  );

const refreshLauncherAccess = (): Promise<void> => {
  if (launcherAccessRefreshPromise) return launcherAccessRefreshPromise;

  launcherAccessState = "loading";
  launcherAccessFailureReason = null;
  renderLauncherGrid();
  const request = (async (): Promise<void> => {
    void refreshFeaturedVideoMetadata();

    const [actionResult, relationResult] = await Promise.all([
      readToyVideoUserActions({ aids: [FEATURED_VIDEO_AID] }),
      readToyAuthorRelation(),
    ]);
    if (actionResult.status !== "ok") {
      launcherAccessState = actionResult.status;
      launcherAccessFailureReason =
        actionResult.status === "error" ? actionResult.reason : null;
      launcherUnlockState = null;
      reconcileActiveLauncher();
      renderLauncherGrid();
      return;
    }

    if (relationResult.status !== "ok") {
      launcherAccessState = relationResult.status;
      launcherAccessFailureReason =
        relationResult.status === "error" ? relationResult.reason : null;
      launcherUnlockState = null;
      reconcileActiveLauncher();
      renderLauncherGrid();
      return;
    }

    const actions = actionResult.items.find(
      ({ aid }) => aid === FEATURED_VIDEO_AID,
    );
    if (!actions) {
      launcherAccessState = "error";
      launcherAccessFailureReason = "video_unavailable";
      launcherUnlockState = null;
      reconcileActiveLauncher();
      renderLauncherGrid();
      return;
    }

    const nextUnlockState: LauncherUnlockState = {
      liked: actions.liked,
      coinCount: actions.coinCount,
      isFollowing: relationResult.data.isFollowing,
    };
    if (
      lastConfirmedUnlockState &&
      hasNewInteractionUnlock(lastConfirmedUnlockState, nextUnlockState)
    ) {
      unlockNoticePending = true;
      saveUnlockNoticePending(true);
      setUnlockNoticeVisible(true);
    }

    lastConfirmedUnlockState = nextUnlockState;
    launcherUnlockState = nextUnlockState;
    launcherAccessState = "ready";
    launcherAccessFailureReason = null;
    reconcileActiveLauncher();
    renderLauncherGrid();
  })();

  launcherAccessRefreshPromise = request;
  void request.then(() => {
    if (launcherAccessRefreshPromise === request) {
      launcherAccessRefreshPromise = null;
    }
  });
  return request;
};

const renderMyRank = (result: LeaderboardMyRankReadResult | null): void => {
  if (!result) {
    myRankPosition.textContent = "加载中…";
    myRankDistance.value = "";
    myRankDistance.textContent = "";
    return;
  }

  if (result.status !== "ok") {
    myRankPosition.textContent = "登录后查看我的排名";
    myRankDistance.value = "—";
    myRankDistance.textContent = "—";
    return;
  }

  if (!result.ranked) {
    myRankPosition.textContent = "未上榜";
    myRankDistance.value = "0 米";
    myRankDistance.textContent = "0 米";
    return;
  }

  myRankPosition.textContent = `第 ${result.rank.toLocaleString("zh-CN")} 名`;
  const distance = formatRankDistance(result.distance);
  myRankDistance.value = distance;
  myRankDistance.textContent = distance;
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
  items: readonly LeaderboardRankItem[],
  mine: LeaderboardMyRankReadResult,
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

    const avatarUrl = normalizeRemoteUrl(item.avatar);
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

    const distance = document.createElement("span");
    distance.className = "rank-distance";
    distance.textContent = formatRankDistance(item.distance);
    row.append(rank, player, distance);
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
      "完成一局后，你的最远飞行距离就有机会出现在这里。",
      false,
    );
    return;
  }

  renderLeaderboardList(result.list.items, result.mine);
};

const setAudioOpen = (open: boolean, restoreFocus = true): void => {
  if (audioOpen === open) return;
  if (open) {
    if (settingsOpen) setSettingsOpen(false, false);
    if (leaderboardOpen) setLeaderboardOpen(false, false);
    cancelActiveLauncherGesture();
  }

  audioOpen = open;
  audioDialog.hidden = !open;
  audioButton.setAttribute("aria-expanded", String(open));
  audioButton.setAttribute(
    "aria-label",
    open ? "关闭声音设置" : "打开声音设置",
  );
  document.body.toggleAttribute("data-audio-open", open);
  accumulator = 0;
  stopMusicPreview();

  if (open) {
    void audio.unlock();
    audioClose.focus({ preventScroll: true });
    return;
  }

  if (restoreFocus) audioButton.focus({ preventScroll: true });
};

const setSettingsOpen = (open: boolean, restoreFocus = true): void => {
  if (settingsOpen === open) return;
  if (open) {
    if (audioOpen) setAudioOpen(false, false);
    if (leaderboardOpen) setLeaderboardOpen(false, false);
    cancelActiveLauncherGesture();
  }
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
    void refreshLauncherAccess();
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
    if (audioOpen) setAudioOpen(false, false);
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
  leaderboardDistanceQueue.enqueue(mergedProgress.bestDistance);
  const localNeedsUpdate = !progressMatches(progress, mergedProgress);

  if (localNeedsUpdate) {
    progress = saveProgress(mergedProgress);
    reconcileActiveLauncher();
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

const updateHud = (): void => {
  if (!game) return;
  const snapshot = game.getSnapshot();
  const endedChanged = gameEnded !== snapshot.ended;
  if (snapshot.ended && !gameEnded) {
    resultMessage.textContent = formatResultMessage(snapshot.distance);
    leaderboardDistanceQueue.enqueue(snapshot.distance);
  }
  if (snapshot.ended && !gameEnded) {
    const nextProgress = recordCompletedDistance(progress, snapshot.distance);
    if (nextProgress !== progress) {
      progress = nextProgress;
      queueCloudProgressSave(progress);
      renderLauncherGrid();
    }
  }
  gameEnded = snapshot.ended;
  const formattedDistance = `${snapshot.distance} 米`;
  updateOutput(distanceOutput, formattedDistance);
  resultPanel.hidden = !snapshot.ended;
  if (snapshot.ended) {
    resultDistance.textContent = formattedDistance;
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
    audioOpen ||
    tutorialOpen ||
    !game
  ) {
    return;
  }
  void audio.unlock();
  applyPendingGameLauncher();
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
      audioOpen ||
      tutorialOpen ||
      (target instanceof Element &&
        target.closest("#settings-button, #leaderboard-button, #audio-button"))
    ) {
      return;
    }
    if (hidden || portraitPaused || !game) return;
    event.preventDefault();
    void audio.unlock();
    applyPendingGameLauncher();
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
    (settingsOpen || leaderboardOpen || audioOpen || tutorialOpen)
  ) {
    event.preventDefault();
    if (tutorialOpen) {
      setTutorialOpen(false);
    } else if (leaderboardOpen) {
      setLeaderboardOpen(false);
    } else if (audioOpen) {
      setAudioOpen(false);
    } else {
      setSettingsOpen(false);
    }
    return;
  }
  if (event.code !== "Space" || event.repeat) return;
  if (
    settingsOpen ||
    leaderboardOpen ||
    audioOpen ||
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

leaderboardButton.addEventListener("click", () => {
  setLeaderboardOpen(!leaderboardOpen);
});

leaderboardClose.addEventListener("click", () => {
  setLeaderboardOpen(false);
});

audioButton.addEventListener("click", () => {
  setAudioOpen(!audioOpen);
});

audioClose.addEventListener("click", () => {
  setAudioOpen(false);
});

authorHomeButton.addEventListener("click", () => {
  requestPromotionNavigation({ type: "space", id: AUTHOR_ID });
});

featuredVideoButton.addEventListener("click", () => {
  requestPromotionNavigation({ type: "video", id: FEATURED_VIDEO_BVID });
});

launcherAccessRetry.addEventListener("click", () => {
  void refreshLauncherAccess();
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
  else void refreshLauncherAccess();
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
    !audioOpen &&
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
    DEFAULT_LAUNCHER_ID,
    effectSprites,
    backgroundSprites,
  );
  reconcileActiveLauncher();
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
void prepareToyNavigation();
void refreshLauncherAccess();
void startGame().catch((error: unknown) => {
  console.error("游戏初始化失败。", error);
  const message = document.createElement("section");
  message.setAttribute("role", "alert");
  message.style.cssText =
    "position:fixed;inset:50% auto auto 50%;z-index:1000;max-width:min(520px,calc(100vw - 48px));transform:translate(-50%,-50%);padding:24px 28px;border:4px solid #142033;border-radius:20px;background:#fffdf5;color:#142033;font:700 18px/1.6 system-ui;text-align:center;box-shadow:0 8px 0 #142033";
  message.textContent = "游戏资源加载失败，请刷新页面或重新上传完整发布包。";
  document.body.append(message);
});
