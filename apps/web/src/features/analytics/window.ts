/**
 * The analytics time window (spec §1.5). One filter rank scopes the tiles and
 * the three windowed charts. The heatmap is deliberately EXCLUDED — it is a
 * calendar (its own year stepper), not a windowed aggregate.
 *
 * The real API (`packages/shared`) speaks `from`/`to` LOCAL day keys, not a
 * `window=` enum, so this module maps a preset to the day bounds the endpoints
 * expect — computed against a stable client `now`, mirroring `lib/calendar`.
 */
import { addDays, localDayKey } from '@/lib/calendar'

export type AnalyticsWindow = '30d' | '90d' | '365d' | 'all'

export const ANALYTICS_WINDOWS: readonly AnalyticsWindow[] = ['30d', '90d', '365d', 'all']

/** The trailing day count of a preset; `all` has no fixed length. */
function windowDays(w: AnalyticsWindow): number | null {
  switch (w) {
    case '30d':
      return 30
    case '90d':
      return 90
    case '365d':
      return 365
    case 'all':
      return null
  }
}

/** Short FR label for a tile/card subtitle. */
export function windowLabel(w: AnalyticsWindow): string {
  switch (w) {
    case '30d':
      return '30 j'
    case '90d':
      return '90 j'
    case '365d':
      return '12 mois'
    case 'all':
      return 'tout'
  }
}

/** Segmented-control label (same wording, standalone). */
export function windowTabLabel(w: AnalyticsWindow): string {
  return w === 'all' ? 'Tout' : windowLabel(w)
}

export interface DayRange {
  from: string
  to: string
}

/**
 * SERIES bounds (heatmap-free: study-time, review-volume). Always concrete
 * `{from,to}` — a series endpoint caps at 366 days, so `all` collapses to the
 * trailing 365-day window (the largest a series can serve).
 */
export function seriesRange(w: AnalyticsWindow, now: Date): DayRange {
  const days = windowDays(w) ?? 365
  return { from: localDayKey(addDays(now, -(days - 1))), to: localDayKey(now) }
}

/**
 * RATE bounds (retention, deck-success). `all` → omit both bounds → true
 * all-time (the endpoint supports an unbounded window there); a preset → the
 * same trailing span as the series.
 */
export function rateRange(w: AnalyticsWindow, now: Date): Partial<DayRange> {
  if (w === 'all') return {}
  return seriesRange(w, now)
}

/**
 * The previous equivalent period, for tile deltas. `null` for `all` (no
 * meaningful "before all time") — the delta is then hidden.
 */
export function previousSeriesRange(w: AnalyticsWindow, now: Date): DayRange | null {
  const days = windowDays(w)
  if (days === null) return null
  const cur = seriesRange(w, now)
  const from = cur.from
  const [y, m, d] = from.split('-').map(Number) as [number, number, number]
  const curFrom = new Date(y, m - 1, d)
  return {
    from: localDayKey(addDays(curFrom, -days)),
    to: localDayKey(addDays(curFrom, -1)),
  }
}

/**
 * The bucket granularity a windowed chart uses: day for the short windows,
 * week once a year of daily columns would be unreadable (dataviz density rule).
 */
export function windowGranularity(w: AnalyticsWindow): 'day' | 'week' {
  return w === '365d' || w === 'all' ? 'week' : 'day'
}

/** Parse an untrusted `?window=` search value, defaulting to `30d`. */
export function parseWindow(value: unknown): AnalyticsWindow {
  return ANALYTICS_WINDOWS.includes(value as AnalyticsWindow) ? (value as AnalyticsWindow) : '30d'
}
