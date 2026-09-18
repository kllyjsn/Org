export const BIG_MAP_THRESHOLD = 150;

export function isBigMap(count: number): boolean {
  return count >= BIG_MAP_THRESHOLD;
}
