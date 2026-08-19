const TOY_SDK_URL =
  "//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js";
const TOY_SDK_SCRIPT_SELECTOR =
  'script[src*="/bfs/seed/toy/app/sdk/toy-sdk.js"]';
const TOY_SDK_LOAD_TIMEOUT_MS = 6_000;

const TOY_SCORE_MIN = -16_777_216;
const TOY_SCORE_MAX = 16_777_215;

export const TOY_RANK_VALUE_MIN = TOY_SCORE_MIN;
export const TOY_RANK_VALUE_MAX = TOY_SCORE_MAX;

export type ToyRankPeriod = "all" | "month" | "week" | "day";
export type ToyNavigationType = "video" | "space";

type ToyAbility =
  | "navigate"
  | "getAuthorVideos"
  | "getAuthorRelation"
  | "getVideoUserActions"
  | "getCloudStorage"
  | "setCloudStorage"
  | "submitScore"
  | "getRankList"
  | "getMyRank";

export interface ToyRankValueItem {
  readonly rank: number;
  readonly value: number;
  readonly nickname: string;
  readonly avatar: string;
}

interface ToySdk {
  isSupport(ability: ToyAbility): Promise<boolean>;
  navigate?(request: ToyNavigationRequest): Promise<void>;
  getAuthorVideos?(request: {
    videos: readonly { bvid: string }[];
  }): Promise<unknown>;
  getAuthorRelation?(): Promise<unknown>;
  getVideoUserActions?(request: {
    aids: readonly number[];
  }): Promise<unknown>;
  getCloudStorage?(keys?: string[]): Promise<Record<string, string>>;
  setCloudStorage?(items: Record<string, string>): Promise<void>;
  submitScore?(request: {
    board?: number;
    score: number;
  }): Promise<{ score: number }>;
  getRankList?(request?: {
    board?: number;
    period?: ToyRankPeriod;
    limit?: number;
  }): Promise<unknown>;
  getMyRank?(request?: {
    board?: number;
    period?: ToyRankPeriod;
  }): Promise<unknown>;
}

declare global {
  interface Window {
    toy?: ToySdk;
  }
}

type ToyFailureResult =
  | { readonly status: "unavailable" }
  | { readonly status: "error" };

export interface ToyNavigationRequest {
  readonly type: ToyNavigationType;
  readonly id: string;
}

export type ToyNavigationResult =
  | { readonly status: "ok" }
  | ToyFailureResult;

export interface ToyAuthorVideoRequestItem {
  readonly bvid: string;
}

export interface ToyAuthorVideosRequest {
  readonly videos: readonly ToyAuthorVideoRequestItem[];
}

export interface ToyAuthorVideo {
  readonly aid: number;
  readonly bvid: string;
  readonly title: string;
  readonly cover: string;
}

export type ToyAuthorVideosReadResult =
  | { readonly status: "ok"; readonly items: readonly ToyAuthorVideo[] }
  | ToyFailureResult;

export interface ToyAuthorRelation {
  readonly isFollowing: boolean;
}

export type ToyAuthorRelationFailureReason =
  | "not_logged_in"
  | "unexpected_response"
  | "request_failed";

export type ToyAuthorRelationReadResult =
  | { readonly status: "ok"; readonly data: ToyAuthorRelation }
  | { readonly status: "unavailable" }
  | {
      readonly status: "error";
      readonly reason: ToyAuthorRelationFailureReason;
    };

export interface ToyVideoUserActionsRequest {
  readonly aids: readonly number[];
}

export interface ToyVideoUserActions {
  readonly aid: number;
  readonly liked: boolean;
  readonly coinCount: number;
  readonly favorited: boolean;
}

export type ToyVideoUserActionsFailureReason =
  | "not_logged_in"
  | "video_unavailable"
  | "unexpected_response"
  | "request_failed";

export type ToyVideoUserActionsReadResult =
  | { readonly status: "ok"; readonly items: readonly ToyVideoUserActions[] }
  | { readonly status: "unavailable" }
  | {
      readonly status: "error";
      readonly reason: ToyVideoUserActionsFailureReason;
    };

export type ToyCloudStorageReadResult =
  | { readonly status: "ok"; readonly items: Record<string, string> }
  | ToyFailureResult;

export interface ToyRankValueSubmitRequest {
  readonly board: 1 | 2 | 3;
  readonly value: number;
}

export type ToyRankValueSubmitResult =
  | { readonly status: "ok"; readonly value: number }
  | ToyFailureResult;

export interface ToyRankListRequest {
  readonly board: 1 | 2 | 3;
  readonly period: ToyRankPeriod;
  readonly limit: number;
}

export type ToyRankListReadResult =
  | { readonly status: "ok"; readonly items: readonly ToyRankValueItem[] }
  | ToyFailureResult;

export interface ToyMyRankRequest {
  readonly board: 1 | 2 | 3;
  readonly period: ToyRankPeriod;
}

export type ToyMyRankReadResult =
  | {
      readonly status: "ok";
      readonly ranked: boolean;
      readonly rank: number;
      readonly value: number;
    }
  | ToyFailureResult;

let sdkLoadPromise: Promise<ToySdk | null> | null = null;
let navigationSdk: ToySdk | null = null;
let navigationPreparePromise: Promise<boolean> | null = null;

const isToySdk = (value: unknown): value is ToySdk =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Partial<ToySdk>).isSupport === "function",
  );

const canLoadRemoteSdk = (): boolean =>
  window.location.protocol === "https:" || window.location.protocol === "http:";

const loadToySdk = (): Promise<ToySdk | null> => {
  if (isToySdk(window.toy)) return Promise.resolve(window.toy);
  if (!canLoadRemoteSdk()) return Promise.resolve(null);
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise<ToySdk | null>((resolve) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      TOY_SDK_SCRIPT_SELECTOR,
    );
    const script = existingScript ?? document.createElement("script");
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      script.removeEventListener("load", finish);
      script.removeEventListener("error", finish);
      resolve(isToySdk(window.toy) ? window.toy : null);
    };

    const timeoutId = window.setTimeout(finish, TOY_SDK_LOAD_TIMEOUT_MS);
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", finish, { once: true });

    if (!existingScript) {
      script.src = TOY_SDK_URL;
      script.async = true;
      document.head.append(script);
    }
  });

  return sdkLoadPromise;
};

const getSupportedToySdk = async (
  ability: ToyAbility,
): Promise<ToySdk | null> => {
  const sdk = await loadToySdk();
  if (!sdk) return null;

  try {
    return (await sdk.isSupport(ability)) ? sdk : null;
  } catch {
    return null;
  }
};

const readInteger = (
  value: unknown,
  minimum = TOY_SCORE_MIN,
  maximum = TOY_SCORE_MAX,
): number | null => {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= minimum && value <= maximum ? value : null;
};

const clampScore = (score: number): number | null => {
  if (!Number.isFinite(score)) return null;
  return Math.min(TOY_SCORE_MAX, Math.max(TOY_SCORE_MIN, Math.trunc(score)));
};

const parseRankItem = (value: unknown): ToyRankValueItem | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    rank?: unknown;
    score?: unknown;
    nickname?: unknown;
    avatar?: unknown;
  };
  const rank = readInteger(candidate.rank, 1, Number.MAX_SAFE_INTEGER);
  const score = readInteger(candidate.score);
  if (rank === null || score === null) return null;

  return {
    rank,
    value: score,
    nickname: typeof candidate.nickname === "string" ? candidate.nickname : "",
    avatar: typeof candidate.avatar === "string" ? candidate.avatar : "",
  };
};

const parseAuthorVideo = (
  value: unknown,
  requestedBvids: ReadonlySet<string>,
): ToyAuthorVideo | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    status?: unknown;
    ref?: { bvid?: unknown };
    data?: {
      aid?: unknown;
      bvid?: unknown;
      title?: unknown;
      cover?: unknown;
    };
  };
  if (candidate.status !== "ok" || !candidate.data) return null;

  const referenceBvid = candidate.ref?.bvid;
  const { aid, bvid, title, cover } = candidate.data;
  if (
    typeof referenceBvid !== "string" ||
    typeof bvid !== "string" ||
    referenceBvid !== bvid ||
    !requestedBvids.has(bvid) ||
    typeof aid !== "number" ||
    !Number.isSafeInteger(aid) ||
    aid <= 0 ||
    typeof title !== "string" ||
    !title.trim() ||
    typeof cover !== "string" ||
    !cover.trim()
  ) {
    return null;
  }

  return {
    aid,
    bvid,
    title: title.trim(),
    cover: cover.trim(),
  };
};

const parseVideoUserActions = (
  value: unknown,
  requestedAids: ReadonlySet<number>,
): ToyVideoUserActions | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    aid?: unknown;
    status?: unknown;
    liked?: unknown;
    coinCount?: unknown;
    favorited?: unknown;
  };
  const aid = readInteger(candidate.aid, 1, Number.MAX_SAFE_INTEGER);
  const coinCount = readInteger(candidate.coinCount, 0, Number.MAX_SAFE_INTEGER);
  if (
    candidate.status !== "ok" ||
    aid === null ||
    !requestedAids.has(aid) ||
    typeof candidate.liked !== "boolean" ||
    coinCount === null ||
    typeof candidate.favorited !== "boolean"
  ) {
    return null;
  }

  return {
    aid,
    liked: candidate.liked,
    coinCount,
    favorited: candidate.favorited,
  };
};

const readToyErrorType = (error: unknown): string => {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { type?: unknown; code?: unknown };
  if (typeof candidate.type === "string") return candidate.type;
  return candidate.code === -101 ? "not_logged_in" : "";
};

const readResponseStatus = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const isNotLoggedInStatus = (status: string): boolean =>
  status === "not_logged_in" || status === "not_login" || status === "unauthorized";

export const prepareToyNavigation = (): Promise<boolean> => {
  if (navigationPreparePromise) return navigationPreparePromise;

  navigationPreparePromise = getSupportedToySdk("navigate").then((sdk) => {
    navigationSdk =
      sdk && typeof sdk.navigate === "function" ? sdk : null;
    return navigationSdk !== null;
  });
  return navigationPreparePromise;
};

export const navigateToy = (
  request: ToyNavigationRequest,
): Promise<ToyNavigationResult> => {
  const sdk = navigationSdk;
  if (!sdk || typeof sdk.navigate !== "function") {
    return Promise.resolve({ status: "unavailable" });
  }

  try {
    const navigation = sdk.navigate(request);
    return navigation.then(
      () => ({ status: "ok" as const }),
      (error) => {
        console.warn("[ToySDK] 页面跳转失败。", error);
        return { status: "error" as const };
      },
    );
  } catch (error) {
    console.warn("[ToySDK] 页面跳转失败。", error);
    return Promise.resolve({ status: "error" });
  }
};

export const readToyAuthorVideos = async (
  request: ToyAuthorVideosRequest,
): Promise<ToyAuthorVideosReadResult> => {
  const sdk = await getSupportedToySdk("getAuthorVideos");
  if (!sdk || typeof sdk.getAuthorVideos !== "function") {
    return { status: "unavailable" };
  }

  const requestedBvids = new Set(
    request.videos.map(({ bvid }) => bvid.trim()).filter(Boolean),
  );
  if (requestedBvids.size === 0) return { status: "error" };

  try {
    const response = await sdk.getAuthorVideos({
      videos: Array.from(requestedBvids, (bvid) => ({ bvid })),
    });
    if (!response || typeof response !== "object") return { status: "error" };
    const candidate = response as { status?: unknown; items?: unknown };
    if (candidate.status !== "ok" || !Array.isArray(candidate.items)) {
      return { status: "error" };
    }

    return {
      status: "ok",
      items: candidate.items
        .map((item) => parseAuthorVideo(item, requestedBvids))
        .filter((item): item is ToyAuthorVideo => item !== null),
    };
  } catch (error) {
    console.warn("[ToySDK] 作者视频读取失败，继续使用本地展示内容。", error);
    return { status: "error" };
  }
};

export const readToyAuthorRelation = async (): Promise<
  ToyAuthorRelationReadResult
> => {
  const sdk = await getSupportedToySdk("getAuthorRelation");
  if (!sdk || typeof sdk.getAuthorRelation !== "function") {
    return { status: "unavailable" };
  }

  try {
    const response = await sdk.getAuthorRelation();
    if (!response || typeof response !== "object") {
      return { status: "error", reason: "unexpected_response" };
    }

    const candidate = response as {
      status?: unknown;
      data?: { isFollowing?: unknown };
    };
    const responseStatus = readResponseStatus(candidate.status);
    if (responseStatus === "unsupported") return { status: "unavailable" };
    if (isNotLoggedInStatus(responseStatus)) {
      return { status: "error", reason: "not_logged_in" };
    }
    if (responseStatus !== "ok") {
      return { status: "error", reason: "request_failed" };
    }
    if (typeof candidate.data?.isFollowing !== "boolean") {
      return { status: "error", reason: "unexpected_response" };
    }

    return {
      status: "ok",
      data: { isFollowing: candidate.data.isFollowing },
    };
  } catch (error) {
    console.warn("[ToySDK] 作者关注状态读取失败。", error);
    const errorType = readToyErrorType(error);
    if (errorType === "unsupported") return { status: "unavailable" };
    return {
      status: "error",
      reason: isNotLoggedInStatus(errorType)
        ? "not_logged_in"
        : "request_failed",
    };
  }
};

export const readToyVideoUserActions = async (
  request: ToyVideoUserActionsRequest,
): Promise<ToyVideoUserActionsReadResult> => {
  if (
    request.aids.length === 0 ||
    request.aids.length > 50 ||
    request.aids.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)
  ) {
    return { status: "error", reason: "unexpected_response" };
  }
  const requestedAids = new Set(request.aids);

  const sdk = await getSupportedToySdk("getVideoUserActions");
  if (!sdk || typeof sdk.getVideoUserActions !== "function") {
    return { status: "unavailable" };
  }

  try {
    const response = await sdk.getVideoUserActions({
      aids: Array.from(requestedAids),
    });
    if (!response || typeof response !== "object") {
      return { status: "error", reason: "unexpected_response" };
    }
    const candidate = response as { status?: unknown; items?: unknown };
    const responseStatus = readResponseStatus(candidate.status);
    if (responseStatus === "unsupported") return { status: "unavailable" };
    if (isNotLoggedInStatus(responseStatus)) {
      return { status: "error", reason: "not_logged_in" };
    }
    if (responseStatus && responseStatus !== "ok") {
      return { status: "error", reason: "video_unavailable" };
    }
    if (!Array.isArray(candidate.items)) {
      return { status: "error", reason: "unexpected_response" };
    }

    const failedStatus = candidate.items
      .map((item) =>
        item && typeof item === "object"
          ? readResponseStatus((item as { status?: unknown }).status)
          : "",
      )
      .find((status) => status && status !== "ok");
    if (failedStatus === "unsupported") return { status: "unavailable" };
    if (failedStatus && isNotLoggedInStatus(failedStatus)) {
      return { status: "error", reason: "not_logged_in" };
    }
    if (failedStatus) {
      return { status: "error", reason: "video_unavailable" };
    }

    const parsedItems = candidate.items.map((item) =>
      parseVideoUserActions(item, requestedAids),
    );
    if (parsedItems.some((item) => item === null)) {
      return { status: "error", reason: "unexpected_response" };
    }
    const items = parsedItems as ToyVideoUserActions[];
    if (
      items.length !== requestedAids.size ||
      new Set(items.map(({ aid }) => aid)).size !== requestedAids.size
    ) {
      return { status: "error", reason: "video_unavailable" };
    }

    return { status: "ok", items };
  } catch (error) {
    console.warn("[ToySDK] 视频互动状态读取失败。", error);
    const errorType = readToyErrorType(error);
    if (errorType === "unsupported") return { status: "unavailable" };
    return {
      status: "error",
      reason: isNotLoggedInStatus(errorType)
        ? "not_logged_in"
        : "request_failed",
    };
  }
};

export const readToyCloudStorage = async (
  keys: string[],
): Promise<ToyCloudStorageReadResult> => {
  const sdk = await getSupportedToySdk("getCloudStorage");
  if (!sdk || typeof sdk.getCloudStorage !== "function") {
    return { status: "unavailable" };
  }

  try {
    return { status: "ok", items: await sdk.getCloudStorage(keys) };
  } catch (error) {
    console.warn("[ToySDK] 云存储读取失败，继续使用本地存档。", error);
    return { status: "error" };
  }
};

export const writeToyCloudStorage = async (
  items: Record<string, string>,
): Promise<boolean> => {
  const sdk = await getSupportedToySdk("setCloudStorage");
  if (!sdk || typeof sdk.setCloudStorage !== "function") return false;

  try {
    await sdk.setCloudStorage(items);
    return true;
  } catch (error) {
    console.warn("[ToySDK] 云存储写入失败，本地存档不受影响。", error);
    return false;
  }
};

export const submitToyRankValue = async (
  request: ToyRankValueSubmitRequest,
): Promise<ToyRankValueSubmitResult> => {
  const score = clampScore(request.value);
  if (score === null) return { status: "error" };

  const sdk = await getSupportedToySdk("submitScore");
  if (!sdk || typeof sdk.submitScore !== "function") {
    return { status: "unavailable" };
  }

  try {
    const response = await sdk.submitScore({ board: request.board, score });
    const submittedScore = readInteger(response?.score);
    return submittedScore === null
      ? { status: "error" }
      : { status: "ok", value: submittedScore };
  } catch (error) {
    console.warn("[ToySDK] 排行榜成绩提交失败，本局游戏不受影响。", error);
    return { status: "error" };
  }
};

export const readToyRankList = async (
  request: ToyRankListRequest,
): Promise<ToyRankListReadResult> => {
  const sdk = await getSupportedToySdk("getRankList");
  if (!sdk || typeof sdk.getRankList !== "function") {
    return { status: "unavailable" };
  }

  try {
    const response = await sdk.getRankList(request);
    if (!Array.isArray(response)) return { status: "error" };
    const limit = Math.max(1, Math.trunc(request.limit));
    const items = response
      .map(parseRankItem)
      .filter((item): item is ToyRankValueItem => item !== null)
      .slice(0, limit);
    return { status: "ok", items };
  } catch (error) {
    console.warn("[ToySDK] 排行榜读取失败。", error);
    return { status: "error" };
  }
};

export const readToyMyRank = async (
  request: ToyMyRankRequest,
): Promise<ToyMyRankReadResult> => {
  const sdk = await getSupportedToySdk("getMyRank");
  if (!sdk || typeof sdk.getMyRank !== "function") {
    return { status: "unavailable" };
  }

  try {
    const response = await sdk.getMyRank(request);
    if (!response || typeof response !== "object") return { status: "error" };
    const candidate = response as {
      ranked?: unknown;
      rank?: unknown;
      score?: unknown;
    };
    if (typeof candidate.ranked !== "boolean") return { status: "error" };
    if (!candidate.ranked) {
      return { status: "ok", ranked: false, rank: 0, value: 0 };
    }

    const rank = readInteger(candidate.rank, 1, Number.MAX_SAFE_INTEGER);
    const score = readInteger(candidate.score);
    return rank === null || score === null
      ? { status: "error" }
      : { status: "ok", ranked: true, rank, value: score };
  } catch (error) {
    console.warn("[ToySDK] 我的排行榜名次读取失败。", error);
    return { status: "error" };
  }
};
