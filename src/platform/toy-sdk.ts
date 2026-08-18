const TOY_SDK_URL =
  "https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js";
const TOY_SDK_SCRIPT_SELECTOR =
  'script[src*="/bfs/seed/toy/app/sdk/toy-sdk.js"]';
const TOY_SDK_LOAD_TIMEOUT_MS = 6_000;

export const TOY_SCORE_MIN = -16_777_216;
export const TOY_SCORE_MAX = 16_777_215;

export type ToyRankPeriod = "all" | "month" | "week" | "day";

type ToyAbility =
  | "getCloudStorage"
  | "setCloudStorage"
  | "submitScore"
  | "getRankList"
  | "getMyRank";

export interface ToyRankItem {
  readonly rank: number;
  readonly score: number;
  readonly nickname: string;
  readonly avatar: string;
}

interface ToySdk {
  isSupport(ability: ToyAbility): Promise<boolean>;
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

export type ToyCloudStorageReadResult =
  | { readonly status: "ok"; readonly items: Record<string, string> }
  | ToyFailureResult;

export interface ToyScoreSubmitRequest {
  readonly board: 1 | 2 | 3;
  readonly score: number;
}

export type ToyScoreSubmitResult =
  | { readonly status: "ok"; readonly score: number }
  | ToyFailureResult;

export interface ToyRankListRequest {
  readonly board: 1 | 2 | 3;
  readonly period: ToyRankPeriod;
  readonly limit: number;
}

export type ToyRankListReadResult =
  | { readonly status: "ok"; readonly items: readonly ToyRankItem[] }
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
      readonly score: number;
    }
  | ToyFailureResult;

let sdkLoadPromise: Promise<ToySdk | null> | null = null;

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

const parseRankItem = (value: unknown): ToyRankItem | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ToyRankItem>;
  const rank = readInteger(candidate.rank, 1, Number.MAX_SAFE_INTEGER);
  const score = readInteger(candidate.score);
  if (rank === null || score === null) return null;

  return {
    rank,
    score,
    nickname: typeof candidate.nickname === "string" ? candidate.nickname : "",
    avatar: typeof candidate.avatar === "string" ? candidate.avatar : "",
  };
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

export const submitToyScore = async (
  request: ToyScoreSubmitRequest,
): Promise<ToyScoreSubmitResult> => {
  const score = clampScore(request.score);
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
      : { status: "ok", score: submittedScore };
  } catch (error) {
    console.warn("[ToySDK] 排行榜分数提交失败，本局游戏不受影响。", error);
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
      .filter((item): item is ToyRankItem => item !== null)
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
      return { status: "ok", ranked: false, rank: 0, score: 0 };
    }

    const rank = readInteger(candidate.rank, 1, Number.MAX_SAFE_INTEGER);
    const score = readInteger(candidate.score);
    return rank === null || score === null
      ? { status: "error" }
      : { status: "ok", ranked: true, rank, score };
  } catch (error) {
    console.warn("[ToySDK] 我的排行榜名次读取失败。", error);
    return { status: "error" };
  }
};
