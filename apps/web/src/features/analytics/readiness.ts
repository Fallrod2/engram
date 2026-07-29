/**
 * Pure transforms for the exam-readiness gauge. Side-effect free and unit-tested,
 * because every delicate rule of this feature lives here:
 *
 *  1. `readiness` is NULLABLE and null is not zero. A subject with no card is
 *     neither 0 % nor 100 % ready — it is unanswerable, and the screen must say
 *     so rather than render `NaN %` or a comforting empty bar.
 *  2. A percentage alone is a lie by omission. The server publishes
 *     `neverReviewed` separately precisely so the UI can say "40 % ready, 6 cards
 *     never seen" — on the real subject that motivated this feature, dropping the
 *     new cards would have read "100 % ready". Hence `readinessSegments`, which
 *     always yields the THREE parts, so the composition is rendered, not hidden
 *     in a tooltip.
 *  3. A past exam has no projection at all (`status: 'past'`, `projection: null`).
 *     Nothing here fabricates one, and nothing drops the exam either.
 */
import type { ExamReadiness, ReadinessBreakdown, SubjectReadiness } from '@engram/shared'

/**
 * The three parts of a readiness figure, in a FROZEN order — best to worst, left
 * to right, so the bar reads as one axis of "how known is this".
 *
 * `toReview` is derived, not served: `notReady` COUNTS the never-reviewed cards
 * (they are a subset of it, never disjoint), so the middle segment is
 * `notReady - neverReviewed` — cards that were learned and have since decayed
 * below the threshold. Subtracting is the only way to make the three parts add
 * up to `cardTotal`.
 */
export type ReadinessSegmentKind = 'ready' | 'toReview' | 'neverReviewed'

export const READINESS_SEGMENT_ORDER = ['ready', 'toReview', 'neverReviewed'] as const

export interface ReadinessSegment {
  kind: ReadinessSegmentKind
  count: number
  /** Share of `cardTotal`, `0` when there is no card (never `NaN`). */
  share: number
}

/** The three parts of a breakdown, always all three, always summing to `cardTotal`. */
export function readinessSegments(b: ReadinessBreakdown): ReadinessSegment[] {
  const never = Math.min(b.neverReviewed, b.notReady)
  const toReview = Math.max(0, b.notReady - never)
  const total = b.cardTotal
  const share = (n: number) => (total > 0 ? n / total : 0)
  return [
    { kind: 'ready', count: b.ready, share: share(b.ready) },
    { kind: 'toReview', count: toReview, share: share(toReview) },
    { kind: 'neverReviewed', count: never, share: share(never) },
  ]
}

/** `0.357` → `36`. `null` stays `null` — the caller renders a dash, not a zero. */
export function readinessPercent(readiness: number | null): number | null {
  return readiness === null ? null : Math.round(readiness * 100)
}

/**
 * The projected figure read against today's, in PERCENTAGE POINTS (`-21` = "you
 * lose 21 points by exam day"). `null` when either side is unanswerable — a
 * delta against nothing is not zero.
 */
export function readinessDeltaPoints(
  today: ReadinessBreakdown,
  projection: ReadinessBreakdown | null,
): number | null {
  const from = readinessPercent(today.readiness)
  const to = projection ? readinessPercent(projection.readiness) : null
  if (from === null || to === null) return null
  return to - from
}

/**
 * Upcoming exams (today included) and past ones, split and ordered for reading.
 *
 * Upcoming ascend — the next deadline is the one that matters. Past ones descend,
 * most recent first: the one you just sat is the one you might still be looking
 * for. They are KEPT, not dropped; the screen shows them without a gauge.
 */
export function splitExams(exams: readonly ExamReadiness[]): {
  upcoming: ExamReadiness[]
  past: ExamReadiness[]
} {
  const upcoming = exams
    .filter((e) => e.status !== 'past')
    .sort((a, b) => a.daysUntil - b.daysUntil)
  const past = exams.filter((e) => e.status === 'past').sort((a, b) => b.daysUntil - a.daysUntil)
  return { upcoming, past }
}

/** One row of the cross-subject overview: a subject, and the exam it is closest to. */
export interface ReadinessOverviewRow {
  subjectId: string
  today: ReadinessBreakdown
  exam: ExamReadiness
}

/**
 * The cross-subject triage list: every UPCOMING exam of every subject in the
 * payload, soonest first, with the subject's baseline alongside.
 *
 * A subject with several exams contributes several rows — hiding all but the
 * next one would silently drop a partial two days later. Ties break on the worse
 * projection first (`no_cards`, whose readiness is null, sorts worst of all: it
 * is the case that must not be quietly ordered last).
 */
export function readinessOverviewRows(
  subjects: readonly SubjectReadiness[],
): ReadinessOverviewRow[] {
  const rows: ReadinessOverviewRow[] = []
  for (const s of subjects) {
    for (const exam of splitExams(s.exams).upcoming) {
      rows.push({ subjectId: s.subjectId, today: s.today, exam })
    }
  }
  return rows.sort(
    (a, b) =>
      a.exam.daysUntil - b.exam.daysUntil ||
      sortableReadiness(a.exam) - sortableReadiness(b.exam) ||
      a.exam.title.localeCompare(b.exam.title),
  )
}

/** `null` readiness (no card at all) sorts BELOW 0 %: it is the worst state, not a missing one. */
function sortableReadiness(exam: ExamReadiness): number {
  const r = exam.projection?.readiness
  return r === null || r === undefined ? -1 : r
}

/** Past exams of every subject, most recent first (the overview's muted tail). */
export function pastExamRows(subjects: readonly SubjectReadiness[]): ReadinessOverviewRow[] {
  const rows: ReadinessOverviewRow[] = []
  for (const s of subjects) {
    for (const exam of splitExams(s.exams).past) {
      rows.push({ subjectId: s.subjectId, today: s.today, exam })
    }
  }
  return rows.sort((a, b) => b.exam.daysUntil - a.exam.daysUntil)
}
