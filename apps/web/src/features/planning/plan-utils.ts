import type { StudyPlanDay, StudyPlanResponse, Subject } from '@engram/shared'
import type { CompositionSegment } from '@/components/subject-composition-bar'

/** Index the plan's dense day array by local day key for O(1) cell lookup. */
export function indexDays(plan: StudyPlanResponse | undefined): Map<string, StudyPlanDay> {
  const m = new Map<string, StudyPlanDay>()
  if (!plan) return m
  for (const d of plan.days) m.set(d.date, d)
  return m
}

/**
 * Meter `max` relative to the visible window (spec §7.1): pressure reads within
 * the displayed month/week. Floored at 20 so a light window doesn't exaggerate.
 */
export function windowMax(plan: StudyPlanResponse | undefined): number {
  let peak = 0
  for (const d of plan?.days ?? []) peak = Math.max(peak, d.total)
  return Math.max(20, peak)
}

/** `subjectId → Subject` lookup from the cached subjects list. */
export function subjectsById(subjects: Subject[] | undefined): Map<string, Subject> {
  const m = new Map<string, Subject>()
  for (const s of subjects ?? []) m.set(s.id, s)
  return m
}

/**
 * Per-subject contribution to a day's total (dues + exam ramp boost), resolved
 * to composition segments for `<SubjectCompositionBar>`. Skips archived/unknown
 * subjects gracefully (falls back to a neutral hex).
 */
export function daySegments(
  day: StudyPlanDay | undefined,
  byId: Map<string, Subject>,
): CompositionSegment[] {
  if (!day) return []
  return day.bySubject
    .map((s) => ({
      subjectId: s.subjectId,
      count: s.dueCount + s.examBoost,
      colorHex: byId.get(s.subjectId)?.color ?? '#7999f5',
    }))
    .filter((s) => s.count > 0)
}
