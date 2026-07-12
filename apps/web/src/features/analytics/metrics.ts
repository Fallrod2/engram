/**
 * Pure transforms for the analytics screen — rates, durations, deltas, the
 * streak sparkline. Kept side-effect-free and unit-tested (the thresholds and
 * the "never a misleading %" rule are the delicate parts).
 */
import type { HeatmapDay } from '@engram/shared'

/**
 * Below this denominator a headline rate is `null` — a "success %" from a
 * handful of reviews is misleading. Mirrors the server's `MIN_RATE_SAMPLE`.
 */
export const MIN_RATE_SAMPLE = 10

export interface RatingTotals {
  again: number
  hard: number
  good: number
  easy: number
  total: number
}

/** Passed = rating ≥ 2 (Again is the only miss), mirroring the server. */
export function passedCount(t: RatingTotals): number {
  return t.hard + t.good + t.easy
}

/** Overall pass rate over a rating-count total; `null` under the sample floor. */
export function successRate(t: RatingTotals): number | null {
  if (t.total < MIN_RATE_SAMPLE) return null
  return passedCount(t) / t.total
}

/** `0.862` → `86 %` (FR spacing, rounded). */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)} %`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * A study duration for a tile/tooltip: `3 h 42` · `42 min` · `45 s` · `0 min`.
 * Seconds under a minute (so a short day never reads as a misleading `0 min`),
 * whole minutes then hours above.
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 min'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec} s`
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${pad2(m)}`
}

/**
 * A Y-axis tick for a duration. A clock format (`m:ss`, or `h:mm` past an hour)
 * so ticks are ALWAYS distinct — whole-minute rounding collapses adjacent ticks
 * into duplicate labels when the daily magnitude is small.
 */
export function formatDurationAxis(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s === 0) return '0'
  if (s < 3600) return `${Math.floor(s / 60)}:${pad2(s % 60)}`
  return `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}`
}

/** Thousands-grouped integer for a count value (FR). */
export function formatCount(n: number): string {
  return n.toLocaleString('fr-FR')
}

/** `dd/MM` short axis label for a `YYYY-MM-DD` day key. */
export function formatAxisDay(dayKey: string): string {
  const [, m, d] = dayKey.split('-')
  return `${d}/${m}`
}

export type DeltaDirection = 'up' | 'down' | 'flat'

export interface Delta {
  /** Signed fraction vs the previous period, or `null` when it can't be shown. */
  pct: number | null
  direction: DeltaDirection
}

/**
 * Delta of `current` vs `previous`. `pct` is `null` when there is no previous
 * period (`previous` omitted) or it was zero (no `+∞`); the arrow still shows
 * the direction. Deltas are NEUTRAL — never colored red/green (that collides
 * with the reserved rating hues); the caller renders a ▲/▼ glyph in muted ink.
 */
export function computeDelta(current: number, previous: number | null): Delta {
  if (previous === null) return { pct: null, direction: 'flat' }
  const direction: DeltaDirection = current > previous ? 'up' : current < previous ? 'down' : 'flat'
  const pct = previous > 0 ? (current - previous) / previous : null
  return { pct, direction }
}

/** `+18 %` / `−4 %` (true minus sign), or `''` when there is no ratio. */
export function formatDelta(delta: Delta): string {
  if (delta.pct === null) return ''
  const rounded = Math.round(delta.pct * 100)
  if (rounded === 0) return '0 %'
  const sign = rounded > 0 ? '+' : '−'
  return `${sign}${Math.abs(rounded)} %`
}

/**
 * The 30-point streak sparkline: reviews/day over the last `length` days ending
 * at `todayKey`, derived from the dense (ordered, one-per-day) heatmap feed. The
 * window is left-padded with zeros when history is shorter than `length`.
 */
export function sparkFromHeatmap(
  days: readonly HeatmapDay[],
  todayKey: string,
  length = 30,
): number[] {
  const idx = days.findIndex((d) => d.date === todayKey)
  const end = idx === -1 ? days.length : idx + 1
  const slice = days.slice(Math.max(0, end - length), end).map((d) => d.count)
  while (slice.length < length) slice.unshift(0)
  return slice
}
