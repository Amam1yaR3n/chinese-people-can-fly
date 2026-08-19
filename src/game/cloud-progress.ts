import {
  readToyCloudStorage,
  writeToyCloudStorage,
} from "../platform/toy-sdk";
import { sanitizeProgress, type ProgressV1 } from "./progress";

const CLOUD_PROGRESS_KEY = "chinese-people-can-fly-progress-v1";

export type CloudProgressLoadResult =
  | { readonly status: "loaded"; readonly progress: ProgressV1 }
  | { readonly status: "empty" }
  | { readonly status: "unavailable" }
  | { readonly status: "error" };

let pendingProgress: ProgressV1 | null = null;
let cloudWriteRunning = false;

const isProgressRecord = (value: unknown): boolean =>
  Boolean(
    value &&
      typeof value === "object" &&
      (value as Partial<ProgressV1>).version === 1,
  );

export const loadCloudProgress = async (): Promise<CloudProgressLoadResult> => {
  const result = await readToyCloudStorage([CLOUD_PROGRESS_KEY]);
  if (result.status !== "ok") return result;

  const stored = result.items[CLOUD_PROGRESS_KEY];
  if (stored === undefined) return { status: "empty" };

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isProgressRecord(parsed)) return { status: "error" };
    return { status: "loaded", progress: sanitizeProgress(parsed) };
  } catch {
    return { status: "error" };
  }
};

export const mergeProgress = (
  localProgress: ProgressV1,
  cloudProgress: ProgressV1,
  preferCurrentSelection: boolean,
): ProgressV1 => {
  const bestDistance = Math.max(
    localProgress.bestDistance,
    cloudProgress.bestDistance,
  );
  const preferLocal =
    preferCurrentSelection ||
    localProgress.bestDistance > cloudProgress.bestDistance;
  const selectedLauncher = preferLocal
    ? localProgress.selectedLauncher
    : cloudProgress.selectedLauncher;

  return { version: 1, bestDistance, selectedLauncher };
};

const flushCloudProgress = async (): Promise<void> => {
  if (cloudWriteRunning) return;
  cloudWriteRunning = true;

  try {
    while (pendingProgress) {
      const progress = pendingProgress;
      pendingProgress = null;
      await writeToyCloudStorage({
        [CLOUD_PROGRESS_KEY]: JSON.stringify(progress),
      });
    }
  } finally {
    cloudWriteRunning = false;
    if (pendingProgress) void flushCloudProgress();
  }
};

export const queueCloudProgressSave = (progress: ProgressV1): void => {
  pendingProgress = progress;
  void flushCloudProgress();
};
