export type LauncherId =
  | "blackEagle"
  | "slingshot"
  | "humanCannon"
  | "missileTruck";

export type LauncherUnlockRequirement =
  | "always"
  | "liked"
  | "coined"
  | "following";

export interface LauncherUnlockState {
  readonly liked: boolean;
  readonly coinCount: number;
  readonly isFollowing: boolean;
}

export interface LauncherDefinition {
  readonly id: LauncherId;
  readonly name: string;
  readonly unlockRequirement: LauncherUnlockRequirement;
  readonly unlockHint: string;
  readonly iconPath: string;
  readonly implemented: boolean;
}

export const DEFAULT_LAUNCHER_ID: LauncherId = "blackEagle";

export const LAUNCHERS: readonly LauncherDefinition[] = [
  {
    id: "blackEagle",
    name: "神鹰黑手哥",
    unlockRequirement: "always",
    unlockHint: "默认装置",
    iconPath: "./assets/characters/batter/swing-01.png",
    implemented: true,
  },
  {
    id: "slingshot",
    name: "弹弓",
    unlockRequirement: "liked",
    unlockHint: "点赞视频解锁",
    iconPath: "./assets/characters/launchers/slingshot.png",
    implemented: true,
  },
  {
    id: "humanCannon",
    name: "人间大炮",
    unlockRequirement: "coined",
    unlockHint: "投币解锁",
    iconPath: "./assets/characters/launchers/human-cannon.png",
    implemented: true,
  },
  {
    id: "missileTruck",
    name: "东风快递发射车",
    unlockRequirement: "following",
    unlockHint: "关注火山哥哥解锁",
    iconPath: "./assets/characters/launchers/missile-truck.png",
    implemented: true,
  },
];

const launcherIds = new Set<LauncherId>(
  LAUNCHERS.map((launcher) => launcher.id),
);

export const isLauncherId = (value: unknown): value is LauncherId =>
  typeof value === "string" && launcherIds.has(value as LauncherId);

export const getLauncherDefinition = (
  launcherId: LauncherId,
): LauncherDefinition =>
  LAUNCHERS.find((launcher) => launcher.id === launcherId) ?? LAUNCHERS[0];

export const isLauncherUnlocked = (
  launcher: LauncherDefinition,
  unlockState: LauncherUnlockState | null,
): boolean => {
  switch (launcher.unlockRequirement) {
    case "always":
      return true;
    case "liked":
      return unlockState?.liked === true;
    case "coined":
      return (unlockState?.coinCount ?? 0) > 0;
    case "following":
      return unlockState?.isFollowing === true;
  }
};

export const isLauncherSelectable = (
  launcher: LauncherDefinition,
  unlockState: LauncherUnlockState | null,
): boolean =>
  launcher.implemented && isLauncherUnlocked(launcher, unlockState);
