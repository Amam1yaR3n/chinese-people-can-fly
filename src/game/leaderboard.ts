import {
  TOY_RANK_VALUE_MAX,
  readToyMyRank,
  readToyRankList,
  submitToyRankValue,
  type ToyRankValueSubmitRequest,
  type ToyRankValueSubmitResult,
} from "../platform/toy-sdk";

export const LEADERBOARD_BOARD = 1 as const;
export const LEADERBOARD_PERIOD = "all" as const;
export const LEADERBOARD_LIMIT = 50;

type LeaderboardFailureResult =
  | { readonly status: "unavailable" }
  | { readonly status: "error" };

export interface LeaderboardRankItem {
  readonly rank: number;
  readonly distance: number;
  readonly nickname: string;
  readonly avatar: string;
}

export type LeaderboardRankListReadResult =
  | { readonly status: "ok"; readonly items: readonly LeaderboardRankItem[] }
  | LeaderboardFailureResult;

export type LeaderboardMyRankReadResult =
  | {
      readonly status: "ok";
      readonly ranked: boolean;
      readonly rank: number;
      readonly distance: number;
    }
  | LeaderboardFailureResult;

export interface LeaderboardLoadResult {
  readonly list: LeaderboardRankListReadResult;
  readonly mine: LeaderboardMyRankReadResult;
}

type SubmitDistance = (
  request: ToyRankValueSubmitRequest,
) => Promise<ToyRankValueSubmitResult>;

export interface LeaderboardDistanceQueue {
  enqueue(distance: number): void;
  whenIdle(): Promise<void>;
}

export const loadLeaderboard = async (): Promise<LeaderboardLoadResult> => {
  const [rawList, rawMine] = await Promise.all([
    readToyRankList({
      board: LEADERBOARD_BOARD,
      period: LEADERBOARD_PERIOD,
      limit: LEADERBOARD_LIMIT,
    }),
    readToyMyRank({
      board: LEADERBOARD_BOARD,
      period: LEADERBOARD_PERIOD,
    }),
  ]);
  const list: LeaderboardRankListReadResult =
    rawList.status === "ok"
      ? {
          status: "ok",
          items: rawList.items.map((item) => ({
            rank: item.rank,
            distance: item.value,
            nickname: item.nickname,
            avatar: item.avatar,
          })),
        }
      : rawList;
  const mine: LeaderboardMyRankReadResult =
    rawMine.status === "ok"
      ? {
          status: "ok",
          ranked: rawMine.ranked,
          rank: rawMine.rank,
          distance: rawMine.value,
        }
      : rawMine;

  return { list, mine };
};

export const createLeaderboardDistanceQueue = (
  submit: SubmitDistance = submitToyRankValue,
): LeaderboardDistanceQueue => {
  let pendingDistance: number | null = null;
  let running: Promise<void> | null = null;

  const flush = async (): Promise<void> => {
    while (pendingDistance !== null) {
      const distance = pendingDistance;
      const result = await submit({
        board: LEADERBOARD_BOARD,
        value: distance,
      });
      if (result.status !== "ok") return;

      if (pendingDistance !== null && result.value >= pendingDistance) {
        pendingDistance = null;
      } else if (pendingDistance === distance) {
        return;
      }
    }
  };

  const start = (): void => {
    if (running) return;
    running = flush().finally(() => {
      running = null;
    });
  };

  return {
    enqueue(distance: number): void {
      if (!Number.isFinite(distance) || distance <= 0) return;
      const normalized = Math.min(
        TOY_RANK_VALUE_MAX,
        Math.max(0, Math.trunc(distance)),
      );
      pendingDistance =
        pendingDistance === null
          ? normalized
          : Math.max(pendingDistance, normalized);
      start();
    },
    async whenIdle(): Promise<void> {
      while (running) await running;
    },
  };
};
