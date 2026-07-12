import type { Grade, RatingResult } from './session-reducer'

/**
 * Client-side end-of-session stats (spec §10.1). No summary endpoint exists —
 * everything is derived from the `results` collected on each RATE_OK. Pure, so
 * it's testable and reused by the summary component.
 */
export interface SessionSummary {
  /** Cards graded this session (the one hero number). */
  viewed: number
  /** Count per grade 1..4. */
  byGrade: Record<Grade, number>
  /** Σ durationMs. */
  totalMs: number
  /** Σ / n, 0 when n = 0. */
  avgMs: number
  /** (Good + Easy) / n as a 0–100 integer — an indicative success proxy. */
  successRate: number
}

export function computeSummary(results: RatingResult[]): SessionSummary {
  const byGrade: Record<Grade, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  let totalMs = 0
  for (const r of results) {
    byGrade[r.grade] += 1
    totalMs += r.durationMs
  }
  const viewed = results.length
  const avgMs = viewed === 0 ? 0 : totalMs / viewed
  const successRate = viewed === 0 ? 0 : Math.round(((byGrade[3] + byGrade[4]) / viewed) * 100)
  return { viewed, byGrade, totalMs, avgMs, successRate }
}
