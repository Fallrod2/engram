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
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

// Fixed "now": Sunday 2026-07-12 10:00 local. Everything is expressed as an
// offset in days from this day so the assertions hold in any system timezone.
const NOW = new Date(2026, 6, 12, 10, 0)
const key = (off: number): string => localDayKey(new Date(2026, 6, 12 + off))
const due = (off: number, h = 12, m = 0): Date => new Date(2026, 6, 12 + off, h, m)
const findDay = (res: StudyPlanResponse, k: string) => res.days.find((d) => d.date === k)!
const sub = (res: StudyPlanResponse, k: string, subjectId: string) =>
  findDay(res, k).bySubject.find((s) => s.subjectId === subjectId)

const seedDueCards = async (
  db: DB,
  deckId: string,
  offsets: { off: number; h?: number }[],
): Promise<void> => {
  for (const o of offsets) await seedCard(db, deckId, { due: due(o.off, o.h ?? 12) })
}

describe('studyPlan — bucketing & window', () => {
  it('buckets_dues_by_local_day', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedDueCards(db, d.id, [{ off: 0 }, { off: 1 }, { off: 2 }])
    const res = await studyPlan(db, { from: key(0), to: key(5), now: NOW })
    expect(findDay(res, key(0)).dueCount).toBe(1)
    expect(findDay(res, key(1)).dueCount).toBe(1)
    expect(findDay(res, key(2)).dueCount).toBe(1)
    expect(findDay(res, key(3)).dueCount).toBe(0)
  })

  it('bucketing_is_local_not_utc', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: due(0, 23) }) // 23:00 today
    await seedCard(db, d.id, { due: new Date(2026, 6, 13, 0, 30) }) // 00:30 next day
    const res = await studyPlan(db, { from: key(0), to: key(2), now: NOW })
    expect(findDay(res, key(0)).dueCount).toBe(1)
    expect(findDay(res, key(1)).dueCount).toBe(1)
  })

  it('overdue_aggregated_onto_today', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: due(-2) })
    await seedCard(db, d.id, { due: due(-5) })
    const res = await studyPlan(db, { from: key(-7), to: key(5), now: NOW })
    expect(findDay(res, key(0)).dueCount).toBe(2)
    expect(findDay(res, key(0)).overdueCount).toBe(2)
    expect(findDay(res, key(-2)).dueCount).toBe(0)
    expect(findDay(res, key(-5)).dueCount).toBe(0)
  })

  it('overdue_split_by_subject', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    const d1 = await seedDeck(db, s1.id)
    const d2 = await seedDeck(db, s2.id)
    await seedDueCards(db, d1.id, [{ off: -1 }, { off: -3 }])
    await seedDueCards(db, d2.id, [{ off: -2 }])
    const res = await studyPlan(db, { from: key(-7), to: key(2), now: NOW })
    expect(sub(res, key(0), s1.id)!.overdueCount).toBe(2)
    expect(sub(res, key(0), s2.id)!.overdueCount).toBe(1)
    expect(findDay(res, key(0)).overdueCount).toBe(3)
  })

  it('future_dues_stay_on_their_day', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: due(3) })
    const res = await studyPlan(db, { from: key(0), to: key(5), now: NOW })
    expect(findDay(res, key(3)).dueCount).toBe(1)
    expect(findDay(res, key(0)).dueCount).toBe(0)
  })

  it('dues_after_to_excluded', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: new Date(2026, 6, 15, 0, 0) }) // exactly to+1 midnight
    const res = await studyPlan(db, { from: key(0), to: key(2), now: NOW })
    const total = res.days.reduce((sum, day) => sum + day.dueCount, 0)
    expect(total).toBe(0)
  })

  it('overdue_excluded_when_today_before_window', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: due(-1) })
    const res = await studyPlan(db, { from: key(2), to: key(5), now: NOW })
    const total = res.days.reduce((sum, day) => sum + day.dueCount, 0)
    expect(total).toBe(0)
  })

  it('archived_subject_excluded', async () => {
    const d = await seedDeck(db, (await seedSubject(db, { archived: true })).id)
    await seedCard(db, d.id, { due: due(0) })
    const res = await studyPlan(db, { from: key(-2), to: key(2), now: NOW })
    const total = res.days.reduce((sum, day) => sum + day.dueCount, 0)
    expect(total).toBe(0)
  })

  it('bySubject_splits_by_subject', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    await seedCard(db, (await seedDeck(db, s1.id)).id, { due: due(1) })
    await seedCard(db, (await seedDeck(db, s2.id)).id, { due: due(1) })
    const res = await studyPlan(db, { from: key(0), to: key(3), now: NOW })
    expect(findDay(res, key(1)).bySubject).toHaveLength(2)
    expect(findDay(res, key(1)).dueCount).toBe(2)
    expect(sub(res, key(1), s1.id)!.dueCount).toBe(1)
    expect(sub(res, key(1), s2.id)!.dueCount).toBe(1)
  })

  it('dense_days_zero_filled', async () => {
    const res = await studyPlan(db, { from: key(0), to: key(4), now: NOW })
    expect(res.days).toHaveLength(5)
    expect(res.days.every((d) => d.dueCount === 0 && d.total === 0)).toBe(true)
  })

  it('subject_filter_scopes_dues', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    await seedCard(db, (await seedDeck(db, s1.id)).id, { due: due(1) })
    await seedCard(db, (await seedDeck(db, s2.id)).id, { due: due(1) })
    const res = await studyPlan(db, { from: key(0), to: key(3), now: NOW, subjectId: s1.id })
    expect(sub(res, key(1), s1.id)!.dueCount).toBe(1)
    expect(sub(res, key(1), s2.id)).toBeUndefined()
    expect(findDay(res, key(1)).dueCount).toBe(1)
  })
})

describe('studyPlan — exams & boost', () => {
  it('exam_marker_on_its_day', async () => {
    const s = await seedSubject(db)
    await seedExam(db, [s.id], { title: 'Mid', date: due(3, 0) })
    const res = await studyPlan(db, { from: key(0), to: key(5), now: NOW })
    const marks = findDay(res, key(3)).exams
    expect(marks).toHaveLength(1)
    expect(marks[0]!.title).toBe('Mid')
    expect(marks[0]!.subjectIds).toEqual([s.id])
  })

  it('boost_applied_in_ramp_only', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    for (let i = 0; i < 14; i++) await seedCard(db, d.id, { due: due(100) }) // far future → no dueCount in window
    await seedExam(db, [s.id], { date: due(10, 0) })
    const res = await studyPlan(db, { from: key(0), to: key(14), now: NOW })
    for (let off = 3; off <= 9; off++) expect(findDay(res, key(off)).examBoost).toBe(2)
    expect(findDay(res, key(10)).examBoost).toBe(0) // exam day itself
    expect(findDay(res, key(2)).examBoost).toBe(0) // before ramp
  })

  it('boost_from_exam_after_window_bleeds_in', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    for (let i = 0; i < 7; i++) await seedCard(db, d.id, { due: due(100) })
    await seedExam(db, [s.id], { date: due(7, 0) }) // to+2 (window ends at J+5)
    const res = await studyPlan(db, { from: key(0), to: key(5), now: NOW })
    expect(findDay(res, key(5)).examBoost).toBe(1)
  })

  it('no_boost_on_past_ramp_days', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    for (let i = 0; i < 7; i++) await seedCard(db, d.id, { due: due(100) })
    await seedExam(db, [s.id], { date: due(3, 0) }) // ramp reaches J-4..J+2
    const res = await studyPlan(db, { from: key(-5), to: key(5), now: NOW })
    expect(findDay(res, key(-1)).examBoost).toBe(0)
    expect(findDay(res, key(1)).examBoost).toBe(1)
  })

  it('boost_scope_sums_over_exam_subjects', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    for (let i = 0; i < 7; i++)
      await seedCard(db, (await seedDeck(db, s1.id)).id, { due: due(100) })
    for (let i = 0; i < 7; i++)
      await seedCard(db, (await seedDeck(db, s2.id)).id, { due: due(100) })
    await seedExam(db, [s1.id, s2.id], { date: due(10, 0) })
    const res = await studyPlan(db, { from: key(0), to: key(14), now: NOW })
    expect(sub(res, key(5), s1.id)!.examBoost).toBe(1)
    expect(sub(res, key(5), s2.id)!.examBoost).toBe(1)
  })

  it('boost_respects_subject_filter', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    for (let i = 0; i < 7; i++)
      await seedCard(db, (await seedDeck(db, s1.id)).id, { due: due(100) })
    for (let i = 0; i < 7; i++)
      await seedCard(db, (await seedDeck(db, s2.id)).id, { due: due(100) })
    await seedExam(db, [s1.id, s2.id], { date: due(10, 0) })
    const res = await studyPlan(db, { from: key(0), to: key(14), now: NOW, subjectId: s1.id })
    expect(sub(res, key(5), s1.id)!.examBoost).toBe(1)
    expect(sub(res, key(5), s2.id)).toBeUndefined()
    // Marker keeps the full (unfiltered) subject list.
    expect(findDay(res, key(10)).exams[0]!.subjectIds.sort()).toEqual([s1.id, s2.id].sort())
  })

  it('two_exams_same_day_boost_adds', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    for (let i = 0; i < 7; i++) await seedCard(db, d.id, { due: due(100) })
    await seedExam(db, [s.id], { date: due(10, 0) })
    await seedExam(db, [s.id], { date: due(10, 0) })
    const res = await studyPlan(db, { from: key(0), to: key(14), now: NOW })
    expect(findDay(res, key(5)).examBoost).toBe(2)
  })
})

describe('studyPlan — guards & invariants', () => {
  it('from_after_to_400', async () => {
    await expect(studyPlan(db, { from: key(5), to: key(0), now: NOW })).rejects.toThrow(
      ValidationError,
    )
  })

  it('window_too_large_400', async () => {
    await expect(studyPlan(db, { from: '2026-01-01', to: '2027-12-31', now: NOW })).rejects.toThrow(
      ValidationError,
    )
  })

  it('total_equals_due_plus_boost', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id, { due: due(1) })
    for (let i = 0; i < 7; i++) await seedCard(db, d.id, { due: due(100) })
    await seedExam(db, [s.id], { date: due(5, 0) })
    const res = await studyPlan(db, { from: key(0), to: key(6), now: NOW })
    for (const day of res.days) expect(day.total).toBe(day.dueCount + day.examBoost)
  })
})

describe('studyToday', () => {
  it('today_total_matches_review_counts', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: due(-1) })
    await seedCard(db, d.id, { due: due(0, 8) })
    const res = await studyToday(db, NOW)
    expect(res.total).toBe((await dueCounts(db, NOW)).total)
  })

  it('today_vs_study_plan_cross_consistency_strict', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: due(0, 8) }) // earlier today → due now
    await seedCard(db, d.id, { due: due(0, 18) }) // later today → not due now, same calendar day
    const today = await studyToday(db, NOW)
    const plan = await studyPlan(db, { from: key(0), to: key(1), now: NOW })
    expect(today.total).toBe(1)
    expect(findDay(plan, key(0)).dueCount).toBe(2)
    expect(today.total).toBeLessThan(findDay(plan, key(0)).dueCount)
  })

  it('today_vs_study_plan_cross_consistency_equal', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: due(0, 8) }) // only earlier-today cards
    const today = await studyToday(db, NOW)
    const plan = await studyPlan(db, { from: key(0), to: key(1), now: NOW })
    expect(today.total).toBe(findDay(plan, key(0)).dueCount)
  })

  it('overdue_count_correct', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: due(-1) }) // overdue
    await seedCard(db, d.id, { due: due(-2) }) // overdue
    await seedCard(db, d.id, { due: due(0, 8) }) // due today, not overdue
    const res = await studyToday(db, NOW)
    expect(res.overdueCount).toBe(2)
  })

  it('ranked_by_priority_exam_first', async () => {
    const a = await seedSubject(db, { name: 'A' })
    const b = await seedSubject(db, { name: 'B' })
    await seedDueCards(db, (await seedDeck(db, a.id)).id, [
      { off: 0, h: 8 },
      { off: 0, h: 8 },
    ]) // 2 dues
    const bDeck = await seedDeck(db, b.id)
    for (let i = 0; i < 20; i++) await seedCard(db, bDeck.id, { due: due(0, 8) }) // 20 dues, no exam
    await seedExam(db, [a.id], { date: due(1, 0) }) // imminent exam for A
    const res = await studyToday(db, NOW)
    expect(res.subjects[0]!.subjectId).toBe(a.id)
    expect(res.subjects[1]!.subjectId).toBe(b.id)
  })

  it('next_exam_days_until', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    await seedCard(db, (await seedDeck(db, s1.id)).id, { due: due(0, 8) })
    await seedCard(db, (await seedDeck(db, s2.id)).id, { due: due(0, 8) })
    await seedExam(db, [s1.id], { date: due(0, 0) }) // today
    await seedExam(db, [s2.id], { date: due(3, 0) }) // in 3 days
    await seedExam(db, [s1.id], { date: due(-2, 0) }) // past → ignored
    const res = await studyToday(db, NOW)
    const e1 = res.subjects.find((x) => x.subjectId === s1.id)!
    const e2 = res.subjects.find((x) => x.subjectId === s2.id)!
    expect(e1.nextExam!.daysUntil).toBe(0)
    expect(e2.nextExam!.daysUntil).toBe(3)
  })

  it('next_exam_batched_no_n_plus_1', async () => {
    const subs = [await seedSubject(db), await seedSubject(db), await seedSubject(db)]
    for (const [i, s] of subs.entries()) {
      await seedCard(db, (await seedDeck(db, s.id)).id, { due: due(0, 8) })
      await seedExam(db, [s.id], { date: due(i + 1, 0) }) // nearest per subject
      await seedExam(db, [s.id], { date: due(i + 5, 0) }) // a farther one too
    }
    const res = await studyToday(db, NOW)
    for (const [i, s] of subs.entries()) {
      const entry = res.subjects.find((x) => x.subjectId === s.id)!
      expect(entry.nextExam!.daysUntil).toBe(i + 1)
    }
  })

  it('subject_without_due_and_without_imminent_exam_excluded', async () => {
    const withDue = await seedSubject(db)
    const idle = await seedSubject(db) // no dues, no exam
    await seedCard(db, (await seedDeck(db, withDue.id)).id, { due: due(0, 8) })
    await seedDeck(db, idle.id)
    const res = await studyToday(db, NOW)
    expect(res.subjects.map((s) => s.subjectId)).not.toContain(idle.id)
    expect(res.subjects.map((s) => s.subjectId)).toContain(withDue.id)
  })
})
