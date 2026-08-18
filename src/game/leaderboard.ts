import {
  TOY_SCORE_MAX,
  TOY_SCORE_MIN,
  readToyMyRank,
  readToyRankList,
  submitToyScore,
  type ToyMyRankReadResult,
  type ToyRankListReadResult,
  type ToyScoreSubmitRequest,
  type ToyScoreSubmitResult,
} from "../platform/toy-sdk";

export const LEADERBOARD_BOARD = 1 as const;
export const LEADERBOARD_PERIOD = "all" as const;
export const LEADERBOARD_LIMIT = 50;

export interface LeaderboardLoadResult {
  readonly list: ToyRankListReadResult;
  readonly mine: ToyMyRankReadResult;
}

type SubmitScore = (
  request: ToyScoreSubmitRequest,
) => Promise<ToyScoreSubmitResult>;

export interface LeaderboardScoreQueue {
  enqueue(score: number): void;
  whenIdle(): Promise<void>;
}

export const loadLeaderboard = async (): Promise<LeaderboardLoadResult> => {
  const [list, mine] = await Promise.all([
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
  return { list, mine };
};

export const createLeaderboardScoreQueue = (
  submit: SubmitScore = submitToyScore,
): LeaderboardScoreQueue => {
  let pendingScore: number | null = null;
  let running: Promise<void> | null = null;

  const flush = async (): Promise<void> => {
    while (pendingScore !== null) {
      const score = pendingScore;
      const result = await submit({ board: LEADERBOARD_BOARD, score });
      if (result.status !== "ok") return;

      if (pendingScore !== null && result.score >= pendingScore) {
        pendingScore = null;
      } else if (pendingScore === score) {
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
    enqueue(score: number): void {
      if (!Number.isFinite(score)) return;
      const normalized = Math.min(
        TOY_SCORE_MAX,
        Math.max(TOY_SCORE_MIN, Math.trunc(score)),
      );
      pendingScore =
        pendingScore === null ? normalized : Math.max(pendingScore, normalized);
      start();
    },
    async whenIdle(): Promise<void> {
      while (running) await running;
    },
  };
};
