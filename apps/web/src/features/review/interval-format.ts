/**
 * Format a projected FSRS interval for a rating button (spec §3.4). Pure, mono
 * `tabular-nums`-friendly output. Unit-tested (spec §16.1 items 10–11).
 *
 * - `scheduledDays >= 1` → days/months/years:
 *     1–29 → `X j` · 30–364 → `X mo` (round(d/30)) · ≥365 → `X a` (round(d/365)).
 * - `scheduledDays === 0` (learning/relearning steps) → derived from `due − now`:
 *     < 60 s → `< 1 min` · < 60 min → `X min` · else → `X h`.
 */
export function formatInterval(due: string, now: string, scheduledDays: number): string {
  if (scheduledDays >= 1) {
    if (scheduledDays < 30) return `${scheduledDays} j`
    if (scheduledDays < 365) return `${Math.round(scheduledDays / 30)} mo`
    return `${Math.round(scheduledDays / 365)} a`
  }

  const diffMs = new Date(due).getTime() - new Date(now).getTime()
  const diffSec = Math.max(0, diffMs) / 1000
  if (diffSec < 60) return '< 1 min'
  const diffMin = diffSec / 60
  if (diffMin < 60) return `${Math.round(diffMin)} min`
  return `${Math.round(diffMin / 60)} h`
}

/** `mm:ss` for a total duration (session summary, spec §10.1). */
export function formatDurationClock(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** `X s` for an average per-card duration (session summary, spec §10.1). */
export function formatSeconds(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))} s`
}
