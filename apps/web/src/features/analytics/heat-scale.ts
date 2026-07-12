/**
 * Activity-heatmap intensity scale (spec §4). The SINGLE source of the
 * review-count → level mapping, shared by the grid cells AND the legend so the
 * two can never disagree. Thresholds are FIXED (not quantile) → a day with 12
 * reviews is the same shade in 2026 and 2027 (inter-year comparability).
 */

export type HeatLevel = 0 | 1 | 2 | 3 | 4

/** Level = number of thresholds a count meets or exceeds. */
export const HEAT_THRESHOLDS = [1, 4, 9, 16] as const
// 0 → 0 (empty) · 1–3 → 1 · 4–8 → 2 · 9–15 → 3 · ≥16 → 4

export function heatLevel(reviews: number): HeatLevel {
  let level: HeatLevel = 0
  for (const t of HEAT_THRESHOLDS) {
    if (reviews >= t) level = (level + 1) as HeatLevel
    else break
  }
  return level
}

/** Literal Tailwind classes (never `bg-chart-heat-${n}` — that tree-shakes). */
export const HEAT_BG_CLASS: Record<HeatLevel, string> = {
  0: 'bg-chart-heat-0',
  1: 'bg-chart-heat-1',
  2: 'bg-chart-heat-2',
  3: 'bg-chart-heat-3',
  4: 'bg-chart-heat-4',
}

export const HEAT_LEVELS: readonly HeatLevel[] = [0, 1, 2, 3, 4]
