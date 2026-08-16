export type LauncherId =
  | "blackEagle"
  | "slingshot"
  | "humanCannon"
  | "missileTruck";

export interface LauncherDefinition {
  readonly id: LauncherId;
  readonly name: string;
  readonly unlockDistance: number;
  readonly iconPath: string;
  readonly implemented: boolean;
}

export const DEFAULT_LAUNCHER_ID: LauncherId = "blackEagle";

export const LAUNCHERS: readonly LauncherDefinition[] = [
  {
    id: "blackEagle",
    name: "神鹰黑手哥",
    unlockDistance: 0,
    iconPath: "./assets/characters/batter/swing-01.png",
    implemented: true,
  },
  {
    id: "slingshot",
    name: "弹弓",
    unlockDistance: 2_000,
    iconPath: "./assets/characters/launchers/slingshot.png",
    implemented: true,
  },
  {
    id: "humanCannon",
    name: "人间大炮",
    unlockDistance: 5_000,
    iconPath: "./assets/characters/launchers/human-cannon.png",
    implemented: true,
  },
  {
    id: "missileTruck",
    name: "东风导弹发射车",
    unlockDistance: 10_000,
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
  bestDistance: number,
): boolean => bestDistance >= launcher.unlockDistance;

export const isLauncherSelectable = (
  launcher: LauncherDefinition,
  bestDistance: number,
): boolean =>
  launcher.implemented && isLauncherUnlocked(launcher, bestDistance);
