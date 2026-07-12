import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import type { StudyPlanResponse } from '@engram/shared'
import { seedCard, seedDeck, seedExam, seedSubject } from '../test-support/harness'
import { localDayKey } from '../lib/day'
import { ValidationError } from '../http/errors'
import { dueCounts } from './review-queue.service'
import { studyPlan, studyToday } from './study-plan.service'

let t: TestDb
let db: DB
beforeEach(() => {
  t = createTestDb()
  db = t.db as DB
})
afterEach(() => t.cleanup())

// Fixed "now": Sunday 2026-07-12 10:00 local. Everything is expressed as an
// offset in days from this day so the assertions hold in any system timezone.
const NOW = new Date(2026, 6, 12, 10, 0)
const key = (off: number): string => localDayKey(new Date(2026, 6, 12 + off))
const due = (off: number, h = 12, m = 0): Date => new Date(2026, 6, 12 + off, h, m)
const findDay = (res: StudyPlanResponse, k: string) => res.days.find((d) => d.date === k)!
const sub = (res: StudyPlanResponse, k: string, subjectId: string) =>
  findDay(res, k).bySubject.find((s) => s.subjectId === subjectId)

const seedDueCards = (db: DB, deckId: string, offsets: { off: number; h?: number }[]): void => {
  for (const o of offsets) seedCard(db, deckId, { due: due(o.off, o.h ?? 12) })
}

describe('studyPlan — bucketing & window', () => {
  it('buckets_dues_by_local_day', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedDueCards(db, d.id, [{ off: 0 }, { off: 1 }, { off: 2 }])
    const res = studyPlan(db, { from: key(0), to: key(5), now: NOW })
    expect(findDay(res, key(0)).dueCount).toBe(1)
    expect(findDay(res, key(1)).dueCount).toBe(1)
    expect(findDay(res, key(2)).dueCount).toBe(1)
    expect(findDay(res, key(3)).dueCount).toBe(0)
  })

  it('bucketing_is_local_not_utc', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id, { due: due(0, 23) }) // 23:00 today
    seedCard(db, d.id, { due: new Date(2026, 6, 13, 0, 30) }) // 00:30 next day
    const res = studyPlan(db, { from: key(0), to: key(2), now: NOW })
    expect(findDay(res, key(0)).dueCount).toBe(1)
    expect(findDay(res, key(1)).dueCount).toBe(1)
  })

  it('overdue_aggregated_onto_today', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id, { due: due(-2) })
    seedCard(db, d.id, { due: due(-5) })
    const res = studyPlan(db, { from: key(-7), to: key(5), now: NOW })
    expect(findDay(res, key(0)).dueCount).toBe(2)
    expect(findDay(res, key(0)).overdueCount).toBe(2)
    expect(findDay(res, key(-2)).dueCount).toBe(0)
    expect(findDay(res, key(-5)).dueCount).toBe(0)
  })

  it('overdue_split_by_subject', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    const d1 = seedDeck(db, s1.id)
    const d2 = seedDeck(db, s2.id)
    seedDueCards(db, d1.id, [{ off: -1 }, { off: -3 }])
    seedDueCards(db, d2.id, [{ off: -2 }])
    const res = studyPlan(db, { from: key(-7), to: key(2), now: NOW })
    expect(sub(res, key(0), s1.id)!.overdueCount).toBe(2)
    expect(sub(res, key(0), s2.id)!.overdueCount).toBe(1)
    expect(findDay(res, key(0)).overdueCount).toBe(3)
  })

  it('future_dues_stay_on_their_day', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id, { due: due(3) })
    const res = studyPlan(db, { from: key(0), to: key(5), now: NOW })
    expect(findDay(res, key(3)).dueCount).toBe(1)
    expect(findDay(res, key(0)).dueCount).toBe(0)
  })

  it('dues_after_to_excluded', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id, { due: new Date(2026, 6, 15, 0, 0) }) // exactly to+1 midnight
    const res = studyPlan(db, { from: key(0), to: key(2), now: NOW })
    const total = res.days.reduce((sum, day) => sum + day.dueCount, 0)
    expect(total).toBe(0)
  })

  it('overdue_excluded_when_today_before_window', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id, { due: due(-1) })
    const res = studyPlan(db, { from: key(2), to: key(5), now: NOW })
    const total = res.days.reduce((sum, day) => sum + day.dueCount, 0)
    expect(total).toBe(0)
  })

  it('archived_subject_excluded', () => {
    const d = seedDeck(db, seedSubject(db, { archived: true }).id)
    seedCard(db, d.id, { due: due(0) })
    const res = studyPlan(db, { from: key(-2), to: key(2), now: NOW })
    const total = res.days.reduce((sum, day) => sum + day.dueCount, 0)
    expect(total).toBe(0)
  })

  it('bySubject_splits_by_subject', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    seedCard(db, seedDeck(db, s1.id).id, { due: due(1) })
    seedCard(db, seedDeck(db, s2.id).id, { due: due(1) })
    const res = studyPlan(db, { from: key(0), to: key(3), now: NOW })
    expect(findDay(res, key(1)).bySubject).toHaveLength(2)
    expect(findDay(res, key(1)).dueCount).toBe(2)
    expect(sub(res, key(1), s1.id)!.dueCount).toBe(1)
    expect(sub(res, key(1), s2.id)!.dueCount).toBe(1)
  })

  it('dense_days_zero_filled', () => {
    const res = studyPlan(db, { from: key(0), to: key(4), now: NOW })
    expect(res.days).toHaveLength(5)
    expect(res.days.every((d) => d.dueCount === 0 && d.total === 0)).toBe(true)
  })

  it('subject_filter_scopes_dues', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    seedCard(db, seedDeck(db, s1.id).id, { due: due(1) })
    seedCard(db, seedDeck(db, s2.id).id, { due: due(1) })
    const res = studyPlan(db, { from: key(0), to: key(3), now: NOW, subjectId: s1.id })
    expect(sub(res, key(1), s1.id)!.dueCount).toBe(1)
    expect(sub(res, key(1), s2.id)).toBeUndefined()
    expect(findDay(res, key(1)).dueCount).toBe(1)
  })
})

describe('studyPlan — exams & boost', () => {
  it('exam_marker_on_its_day', () => {
    const s = seedSubject(db)
    seedExam(db, [s.id], { title: 'Mid', date: due(3, 0) })
    const res = studyPlan(db, { from: key(0), to: key(5), now: NOW })
    const marks = findDay(res, key(3)).exams
    expect(marks).toHaveLength(1)
    expect(marks[0]!.title).toBe('Mid')
    expect(marks[0]!.subjectIds).toEqual([s.id])
  })

  it('boost_applied_in_ramp_only', () => {
    const s = seedSubject(db)
    const d = seedDeck(db, s.id)
    for (let i = 0; i < 14; i++) seedCard(db, d.id, { due: due(100) }) // far future → no dueCount in window
    seedExam(db, [s.id], { date: due(10, 0) })
    const res = studyPlan(db, { from: key(0), to: key(14), now: NOW })
    for (let off = 3; off <= 9; off++) expect(findDay(res, key(off)).examBoost).toBe(2)
    expect(findDay(res, key(10)).examBoost).toBe(0) // exam day itself
    expect(findDay(res, key(2)).examBoost).toBe(0) // before ramp
  })

  it('boost_from_exam_after_window_bleeds_in', () => {
    const s = seedSubject(db)
    const d = seedDeck(db, s.id)
    for (let i = 0; i < 7; i++) seedCard(db, d.id, { due: due(100) })
    seedExam(db, [s.id], { date: due(7, 0) }) // to+2 (window ends at J+5)
    const res = studyPlan(db, { from: key(0), to: key(5), now: NOW })
    expect(findDay(res, key(5)).examBoost).toBe(1)
  })

  it('no_boost_on_past_ramp_days', () => {
    const s = seedSubject(db)
    const d = seedDeck(db, s.id)
    for (let i = 0; i < 7; i++) seedCard(db, d.id, { due: due(100) })
    seedExam(db, [s.id], { date: due(3, 0) }) // ramp reaches J-4..J+2
    const res = studyPlan(db, { from: key(-5), to: key(5), now: NOW })
    expect(findDay(res, key(-1)).examBoost).toBe(0)
    expect(findDay(res, key(1)).examBoost).toBe(1)
  })

  it('boost_scope_sums_over_exam_subjects', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    for (let i = 0; i < 7; i++) seedCard(db, seedDeck(db, s1.id).id, { due: due(100) })
    for (let i = 0; i < 7; i++) seedCard(db, seedDeck(db, s2.id).id, { due: due(100) })
    seedExam(db, [s1.id, s2.id], { date: due(10, 0) })
    const res = studyPlan(db, { from: key(0), to: key(14), now: NOW })
    expect(sub(res, key(5), s1.id)!.examBoost).toBe(1)
    expect(sub(res, key(5), s2.id)!.examBoost).toBe(1)
  })

  it('boost_respects_subject_filter', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    for (let i = 0; i < 7; i++) seedCard(db, seedDeck(db, s1.id).id, { due: due(100) })
    for (let i = 0; i < 7; i++) seedCard(db, seedDeck(db, s2.id).id, { due: due(100) })
    seedExam(db, [s1.id, s2.id], { date: due(10, 0) })
    const res = studyPlan(db, { from: key(0), to: key(14), now: NOW, subjectId: s1.id })
    expect(sub(res, key(5), s1.id)!.examBoost).toBe(1)
    expect(sub(res, key(5), s2.id)).toBeUndefined()
    // Marker keeps the full (unfiltered) subject list.
    expect(findDay(res, key(10)).exams[0]!.subjectIds.sort()).toEqual([s1.id, s2.id].sort())
  })

  it('two_exams_same_day_boost_adds', () => {
    const s = seedSubject(db)
    const d = seedDeck(db, s.id)
    for (let i = 0; i < 7; i++) seedCard(db, d.id, { due: due(100) })
    seedExam(db, [s.id], { date: due(10, 0) })
    seedExam(db, [s.id], { date: due(10, 0) })
    const res = studyPlan(db, { from: key(0), to: key(14), now: NOW })
    expect(findDay(res, key(5)).examBoost).toBe(2)
  })
})

describe('studyPlan — guards & invariants', () => {
  it('from_after_to_400', () => {
    expect(() => studyPlan(db, { from: key(5), to: key(0), now: NOW })).toThrow(ValidationError)
  })

  it('window_too_large_400', () => {
    expect(() => studyPlan(db, { from: '2026-01-01', to: '2027-12-31', now: NOW })).toThrow(
      ValidationError,
    )
  })

  it('total_equals_due_plus_boost', () => {
    const s = seedSubject(db)
    const d = seedDeck(db, s.id)
    seedCard(db, d.id, { due: due(1) })
    for (let i = 0; i < 7; i++) seedCard(db, d.id, { due: due(100) })
    seedExam(db, [s.id], { date: due(5, 0) })
    const res = studyPlan(db, { from: key(0), to: key(6), now: NOW })
    for (const day of res.days) expect(day.total).toBe(day.dueCount + day.examBoost)
  })
})

describe('studyToday', () => {
  it('today_total_matches_review_counts', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id, { due: due(-1) })
    seedCard(db, d.id, { due: due(0, 8) })
    const res = studyToday(db, NOW)
    expect(res.total).toBe(dueCounts(db, NOW).total)
  })

  it('today_vs_study_plan_cross_consistency_strict', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id, { due: due(0, 8) }) // earlier today → due now
    seedCard(db, d.id, { due: due(0, 18) }) // later today → not due now, same calendar day
    const today = studyToday(db, NOW)
    const plan = studyPlan(db, { from: key(0), to: key(1), now: NOW })
    expect(today.total).toBe(1)
    expect(findDay(plan, key(0)).dueCount).toBe(2)
    expect(today.total).toBeLessThan(findDay(plan, key(0)).dueCount)
  })

  it('today_vs_study_plan_cross_consistency_equal', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id, { due: due(0, 8) }) // only earlier-today cards
    const today = studyToday(db, NOW)
    const plan = studyPlan(db, { from: key(0), to: key(1), now: NOW })
    expect(today.total).toBe(findDay(plan, key(0)).dueCount)
  })

  it('overdue_count_correct', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id, { due: due(-1) }) // overdue
    seedCard(db, d.id, { due: due(-2) }) // overdue
    seedCard(db, d.id, { due: due(0, 8) }) // due today, not overdue
    const res = studyToday(db, NOW)
    expect(res.overdueCount).toBe(2)
  })

  it('ranked_by_priority_exam_first', () => {
    const a = seedSubject(db, { name: 'A' })
    const b = seedSubject(db, { name: 'B' })
    seedDueCards(db, seedDeck(db, a.id).id, [
      { off: 0, h: 8 },
      { off: 0, h: 8 },
    ]) // 2 dues
    const bDeck = seedDeck(db, b.id)
    for (let i = 0; i < 20; i++) seedCard(db, bDeck.id, { due: due(0, 8) }) // 20 dues, no exam
    seedExam(db, [a.id], { date: due(1, 0) }) // imminent exam for A
    const res = studyToday(db, NOW)
    expect(res.subjects[0]!.subjectId).toBe(a.id)
    expect(res.subjects[1]!.subjectId).toBe(b.id)
  })

  it('next_exam_days_until', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    seedCard(db, seedDeck(db, s1.id).id, { due: due(0, 8) })
    seedCard(db, seedDeck(db, s2.id).id, { due: due(0, 8) })
    seedExam(db, [s1.id], { date: due(0, 0) }) // today
    seedExam(db, [s2.id], { date: due(3, 0) }) // in 3 days
    seedExam(db, [s1.id], { date: due(-2, 0) }) // past → ignored
    const res = studyToday(db, NOW)
    const e1 = res.subjects.find((x) => x.subjectId === s1.id)!
    const e2 = res.subjects.find((x) => x.subjectId === s2.id)!
    expect(e1.nextExam!.daysUntil).toBe(0)
    expect(e2.nextExam!.daysUntil).toBe(3)
  })

  it('next_exam_batched_no_n_plus_1', () => {
    const subs = [seedSubject(db), seedSubject(db), seedSubject(db)]
    subs.forEach((s, i) => {
      seedCard(db, seedDeck(db, s.id).id, { due: due(0, 8) })
      seedExam(db, [s.id], { date: due(i + 1, 0) }) // nearest per subject
      seedExam(db, [s.id], { date: due(i + 5, 0) }) // a farther one too
    })
    const res = studyToday(db, NOW)
    subs.forEach((s, i) => {
      const entry = res.subjects.find((x) => x.subjectId === s.id)!
      expect(entry.nextExam!.daysUntil).toBe(i + 1)
    })
  })

  it('subject_without_due_and_without_imminent_exam_excluded', () => {
    const withDue = seedSubject(db)
    const idle = seedSubject(db) // no dues, no exam
    seedCard(db, seedDeck(db, withDue.id).id, { due: due(0, 8) })
    seedDeck(db, idle.id)
    const res = studyToday(db, NOW)
    expect(res.subjects.map((s) => s.subjectId)).not.toContain(idle.id)
    expect(res.subjects.map((s) => s.subjectId)).toContain(withDue.id)
  })
})
