/**
 * Formatting helpers for measured data (dates, relative due). Pure functions,
 * unit-tested — mono/tabular rendering happens in the components.
 */

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
