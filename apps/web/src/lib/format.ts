/**
 * Formatting helpers for measured data (dates, relative due). Pure functions,
 * unit-tested — mono/tabular rendering happens in the components.
 */

import { addDays, dayDiff, parseDayKey, startOfWeekMonday } from './calendar'

const DAY_MS = 24 * 60 * 60 * 1000

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
    return `en retard ${late}j`
  }
  if (diffDays === 0) return 'auj.'
  return `J+${diffDays}`
}

/** Exact date/time for a tooltip, e.g. `12 juil. 2026, 14:03`. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
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
  if (diff > 0) return `J-${diff}`
  if (diff === 0) return "aujourd'hui"
  return 'passé'
}

/**
 * Relative label for a day KEY (`YYYY-MM-DD`) in the detail panel (spec §2.5):
 *   `aujourd'hui` / `demain` / `hier` / `dans N jours` / `il y a N jours`.
 */
export function formatRelativeDay(dayKey: string, now: Date = new Date()): string {
  const diff = dayDiff(now, parseDayKey(dayKey))
  if (diff === 0) return "aujourd'hui"
  if (diff === 1) return 'demain'
  if (diff === -1) return 'hier'
  if (diff > 1) return `dans ${diff} jours`
  return `il y a ${Math.abs(diff)} jours`
}

/** Long day label for a day KEY, e.g. `dim. 12 juil. 2026`. */
export function formatLongDay(dayKey: string): string {
  return parseDayKey(dayKey).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Month + year label for the month toolbar, e.g. `juillet 2026`. */
export function formatMonthLabel(anchor: Date): string {
  return anchor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

/** Compact week span for the week toolbar, e.g. `6–12 juil. 2026`. */
export function formatWeekLabel(anchor: Date): string {
  const monday = startOfWeekMonday(anchor)
  const sunday = addDays(monday, 6)
  const year = sunday.getFullYear()
  const monShort = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'short' })
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()}–${sunday.getDate()} ${monShort(sunday)} ${year}`
  }
  return `${monday.getDate()} ${monShort(monday)} – ${sunday.getDate()} ${monShort(sunday)} ${year}`
}
