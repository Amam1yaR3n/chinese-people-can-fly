import {
  DEFAULT_LAUNCHER_ID,
  isLauncherId,
  type LauncherId,
} from "./launchers";

export interface ProgressV1 {
  readonly version: 1;
  readonly bestDistance: number;
  readonly selectedLauncher: LauncherId;
}

const PROGRESS_STORAGE_KEY = "chinese-people-can-fly:progress";

const DEFAULT_PROGRESS: ProgressV1 = {
  version: 1,
  bestDistance: 0,
  selectedLauncher: DEFAULT_LAUNCHER_ID,
};

let memoryProgress: ProgressV1 = DEFAULT_PROGRESS;

const sanitizeDistance = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

export const sanitizeProgress = (value: unknown): ProgressV1 => {
  if (!value || typeof value !== "object") return DEFAULT_PROGRESS;

  const candidate = value as Partial<ProgressV1>;
  if (candidate.version !== 1) return DEFAULT_PROGRESS;
  const bestDistance = sanitizeDistance(candidate.bestDistance);
  const requestedLauncher = isLauncherId(candidate.selectedLauncher)
    ? candidate.selectedLauncher
    : DEFAULT_LAUNCHER_ID;

  return {
    version: 1,
    bestDistance,
    selectedLauncher: requestedLauncher,
  };
};

export const loadProgress = (): ProgressV1 => {
  try {
    const stored = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!stored) return memoryProgress;
    memoryProgress = sanitizeProgress(JSON.parse(stored));
  } catch {
    // Keep the in-memory record when storage is blocked or contains invalid JSON.
  }
  return memoryProgress;
};

export const saveProgress = (progress: ProgressV1): ProgressV1 => {
  memoryProgress = sanitizeProgress(progress);
  try {
    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify(memoryProgress),
    );
  } catch {
    // The current session still retains the in-memory record.
  }
  return memoryProgress;
};

export const recordCompletedDistance = (
  progress: ProgressV1,
  completedDistance: number,
): ProgressV1 => {
  const bestDistance = Math.max(
    progress.bestDistance,
    sanitizeDistance(completedDistance),
  );
  if (bestDistance === progress.bestDistance) return progress;
  return saveProgress({ ...progress, bestDistance });
};
