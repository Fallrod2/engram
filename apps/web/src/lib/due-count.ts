/**
 * Due-count intensity encoding (design spec §6.1).
 *
 * The count reads as "pressure", never as an alert: urgency is encoded by
 * typographic weight, never by color. Red is reserved for danger/Again.
 *
 *   0     → retreating `·` (text-faint)
 *   1–20  → number in text-muted
 *   21–50 → number in text (primary)
 *   >50   → number in text + a 2px subject-tinted load bar under it
 */
export type DueTier = 'zero' | 'low' | 'mid' | 'high'

export function dueCountTier(count: number): DueTier {
  if (count <= 0) return 'zero'
  if (count <= 20) return 'low'
  if (count <= 50) return 'mid'
  return 'high'
}

/** Width (0–100%) of the load bar shown for the `high` tier; scales with backlog. */
export function dueBarWidth(count: number): number {
  return Math.min(100, Math.round((count / 200) * 100))
}
