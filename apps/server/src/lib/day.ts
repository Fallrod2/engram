/**
 * Calendar-day helpers. Per WS-B spec §1.9, day bucketing (heatmap, streaks,
 * per-day load) is done in JS using the LOCAL timezone — never in SQL and never
 * in UTC. The server process runs in the user's timezone (localhost,
 * single-user), so `Date`'s local accessors are the source of truth.
 */

/** Local calendar-day key `YYYY-MM-DD` for an instant. */
export function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Local midnight of a calendar day, e.g. for `exam.date`. Components are
 * interpreted in the system (= user) timezone; never use `Date.UTC`.
 */
export function localMidnight(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day)
}
