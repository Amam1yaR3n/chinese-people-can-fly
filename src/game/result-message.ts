const METERS_PER_PERCENT = 100;
const MAX_DEFEAT_PERCENTAGE = 99;

export const getDefeatPercentage = (distance: number): number => {
  if (!Number.isFinite(distance)) return 0;

  return Math.min(
    MAX_DEFEAT_PERCENTAGE,
    Math.max(0, Math.floor(distance / METERS_PER_PERCENT) - 1),
  );
};

export const formatResultMessage = (distance: number): string =>
  `你击败了${getDefeatPercentage(distance)}％的中国人，再飞一次吧！`;
