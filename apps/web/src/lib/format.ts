/**
 * Formatting helpers for measured data (dates, relative due). Pure functions,
 * unit-tested — mono/tabular rendering happens in the components.
 */

import { addDays, dayDiff, parseDayKey, startOfWeekMonday } from './calendar'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Active locale for date/number formatting (spec §9.3). Set by the i18n
 * `LangProvider` via `setLocale`; defaults to `fr-FR` so the pure functions stay
 * unit-testable without a provider (the existing tests assert the FR output).
 * This module stays free of the i18n dict (no React, no cycle): the few textual
 * words switch on the locale prefix here.
 */
let currentLocale = 'fr-FR'
export function setLocale(locale: string): void {
  currentLocale = locale
}
/** Whether the active locale is English (drives the few inline textual words). */
export const isEn = (): boolean => currentLocale.startsWith('en')

/** Start-of-day epoch for a date (local time). */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Relative due label (spec §4). Whole-day granularity, calm wording — overdue
 * is never colored red, urgency reads from density.
 *   past   → `en retard 2j` (or `en retard` for < 1 day late)
 *   today  → `auj.`
 *   future → `J+3`
 */
export function formatDue(dueIso: string, now: Date = new Date()): string {
  const due = new Date(dueIso)
  const diffDays = Math.round((startOfDay(due) - startOfDay(now)) / DAY_MS)
  if (diffDays < 0) {
    const late = Math.abs(diffDays)
    return isEn() ? `${late}d late` : `en retard ${late}j`
  }
  if (diffDays === 0) return isEn() ? 'today' : 'auj.'
  return isEn() ? `+${diffDays}d` : `J+${diffDays}`
}

/** Exact date/time for a tooltip, e.g. `12 juil. 2026, 14:03`. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(currentLocale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `reps·lapses`, e.g. `12·1`. */
export function formatReps(reps: number, lapses: number): string {
  return `${reps}·${lapses}`
}

// --- Planning (spec §1.5) --------------------------------------------------
// Calm wording, whole calendar days — urgency reads from proximity, NEVER red.

/**
 * Exam countdown from an ISO instant (spec §1.8). Whole local-day diff:
 *   future → `J-3` · today → `aujourd'hui` · past → `passé`.
 */
export function formatCountdown(dateIso: string, now: Date = new Date()): string {
  const diff = dayDiff(now, new Date(dateIso))
  if (diff > 0) return isEn() ? `${diff}d left` : `J-${diff}`
  if (diff === 0) return isEn() ? 'today' : "aujourd'hui"
  return isEn() ? 'past' : 'passé'
}

/**
 * Relative label for a day KEY (`YYYY-MM-DD`) in the detail panel (spec §2.5):
 *   `aujourd'hui` / `demain` / `hier` / `dans N jours` / `il y a N jours`.
 */
export function formatRelativeDay(dayKey: string, now: Date = new Date()): string {
  const diff = dayDiff(now, parseDayKey(dayKey))
  if (diff === 0) return isEn() ? 'today' : "aujourd'hui"
  if (diff === 1) return isEn() ? 'tomorrow' : 'demain'
  if (diff === -1) return isEn() ? 'yesterday' : 'hier'
  if (diff > 1) return isEn() ? `in ${diff} days` : `dans ${diff} jours`
  const ago = Math.abs(diff)
  return isEn() ? `${ago} days ago` : `il y a ${ago} jours`
}

/** Long day label for a day KEY, e.g. `dim. 12 juil. 2026`. */
export function formatLongDay(dayKey: string): string {
  return parseDayKey(dayKey).toLocaleDateString(currentLocale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Monday-first, uppercase short weekday labels for the active locale — the
 * calendar column headers (spec §2/§3). FR → `LUN…DIM`, EN → `MON…SUN`. Derived
 * from `Intl` so the grid header follows the language instead of hard-coding FR.
 */
export function weekdayAbbrevs(): string[] {
  const monday = new Date(2023, 0, 2) // 2 Jan 2023 is a Monday
  return Array.from({ length: 7 }, (_, i) =>
    addDays(monday, i)
      .toLocaleDateString(currentLocale, { weekday: 'short' })
      .replace(/\.$/, '')
      .toUpperCase(),
  )
}

/** Month + year label for the month toolbar, e.g. `juillet 2026`. */
export function formatMonthLabel(anchor: Date): string {
  return anchor.toLocaleDateString(currentLocale, { month: 'long', year: 'numeric' })
}

/** Compact week span for the week toolbar, e.g. `6–12 juil. 2026`. */
export function formatWeekLabel(anchor: Date): string {
  const monday = startOfWeekMonday(anchor)
  const sunday = addDays(monday, 6)
  const year = sunday.getFullYear()
  const monShort = (d: Date) => d.toLocaleDateString(currentLocale, { month: 'short' })
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()}–${sunday.getDate()} ${monShort(sunday)} ${year}`
  }
  return `${monday.getDate()} ${monShort(monday)} – ${sunday.getDate()} ${monShort(sunday)} ${year}`
}
