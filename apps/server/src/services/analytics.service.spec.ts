import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { eq } from 'drizzle-orm'
import { examReadinessResponseSchema, hardestCardsResponseSchema } from '@engram/shared'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { subject } from '../db/schema'
import { seedCard, seedDeck, seedExam, seedReviewLog, seedSubject } from '../test-support/harness'
import { localDayKey } from '../lib/day'
import { ValidationError } from '../http/errors'
import {
  MIN_REPS,
  PAST_EXAM_WINDOW_DAYS,
  deckSuccess,
  examReadiness,
  hardestCards,
  heatmap,
  retention,
  reviewVolume,
  streaks,
  studyTime,
} from './analytics.service'

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

// Fixed "now": Sunday 2026-07-12 10:00 local. Offsets are days from this day so
// assertions hold in any system timezone (local-component Date constructors).
const NOW = new Date(2026, 6, 12, 10, 0)
const at = (off: number, h = 12, m = 0): Date => new Date(2026, 6, 12 + off, h, m)
const key = (off: number): string => localDayKey(at(off))

/** Seed a subject → deck → card chain and return the card id. */
async function chain(
  db: DB,
  o: { archived?: boolean } = {},
): Promise<{ subjectId: string; deckId: string; cardId: string }> {
  const s = await seedSubject(db, o.archived !== undefined ? { archived: o.archived } : {})
  const d = await seedDeck(db, s.id)
  const c = await seedCard(db, d.id)
  return { subjectId: s.id, deckId: d.id, cardId: c.id }
}

// ---------------------------------------------------------------------------
describe('streaks', () => {
  it('current_streak_counts_today_and_back', async () => {
    const { cardId } = await chain(db)
    for (const off of [0, -1, -2]) await seedReviewLog(db, cardId, { review: at(off) })
    const r = await streaks(db, U, NOW)
    expect(r.current).toBe(3)
    expect(r.includesToday).toBe(true)
    expect(r.lastStudyDay).toBe(key(0))
    expect(r.totalStudyDays).toBe(3)
  })

  it('current_streak_includes_yesterday_when_today_empty', async () => {
    const { cardId } = await chain(db)
    for (const off of [-1, -2]) await seedReviewLog(db, cardId, { review: at(off) })
    const r = await streaks(db, U, NOW)
    expect(r.current).toBe(2)
    expect(r.includesToday).toBe(false)
  })

  it('current_streak_zero_when_gap_before_today', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(-2) })
    expect((await streaks(db, U, NOW)).current).toBe(0)
  })

  it('streak_broken_by_gap', async () => {
    const { cardId } = await chain(db)
    for (const off of [0, -1, -3, -4, -5]) await seedReviewLog(db, cardId, { review: at(off) })
    const r = await streaks(db, U, NOW)
    expect(r.current).toBe(2)
    expect(r.longest).toBe(3)
  })

  it('longest_streak_over_history', async () => {
    const { cardId } = await chain(db)
    for (const off of [-10, -9, -8, -7, -6]) await seedReviewLog(db, cardId, { review: at(off) })
    await seedReviewLog(db, cardId, { review: at(0) })
    const r = await streaks(db, U, NOW)
    expect(r.current).toBe(1)
    expect(r.longest).toBe(5)
  })

  it('multiple_reviews_same_day_count_one', async () => {
    const { cardId } = await chain(db)
    for (const h of [8, 12, 20]) await seedReviewLog(db, cardId, { review: at(0, h) })
    await seedReviewLog(db, cardId, { review: at(-1) })
    const r = await streaks(db, U, NOW)
    expect(r.current).toBe(2)
    expect(r.totalStudyDays).toBe(2)
  })

  it('streak_local_not_utc', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 12, 23, 0) }) // 23:00 Jul 12
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 13, 0, 30) }) // 00:30 Jul 13
    const r = await streaks(db, U, new Date(2026, 6, 13, 10, 0))
    expect(r.totalStudyDays).toBe(2)
    expect(r.current).toBe(2) // today Jul 13 + yesterday Jul 12
  })

  it('empty_history_streaks_zero', async () => {
    const r = await streaks(db, U, NOW)
    expect(r.current).toBe(0)
    expect(r.longest).toBe(0)
    expect(r.lastStudyDay).toBeNull()
    expect(r.totalStudyDays).toBe(0)
  })

  it('archived_subject_still_counts_in_streak', async () => {
    const { cardId } = await chain(db, { archived: true })
    await seedReviewLog(db, cardId, { review: at(0) })
    expect((await streaks(db, U, NOW)).current).toBe(1)
  })

  it('archiving_midway_does_not_shrink_history', async () => {
    const { subjectId, cardId } = await chain(db)
    for (const off of [-4, -3, -2, -1, 0]) await seedReviewLog(db, cardId, { review: at(off) })
    const before = await streaks(db, U, NOW)
    expect(before.longest).toBe(5)
    expect(before.current).toBe(5)
    await db.update(subject).set({ archived: true }).where(eq(subject.id, subjectId))
    const after = await streaks(db, U, NOW)
    expect(after.longest).toBe(5)
    expect(after.current).toBe(5)
  })

  it('manual_rating_zero_not_a_study_day', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0), rating: 0 })
    const r = await streaks(db, U, NOW)
    expect(r.current).toBe(0)
    expect(r.longest).toBe(0)
    expect(r.totalStudyDays).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('heatmap', () => {
  const find = (r: Awaited<ReturnType<typeof heatmap>>, k: string) =>
    r.days.find((d) => d.date === k)

  it('counts_reviews_per_local_day', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0, 9) })
    await seedReviewLog(db, cardId, { review: at(0, 15) })
    await seedReviewLog(db, cardId, { review: at(1) })
    const r = await heatmap(db, U, { now: NOW, from: key(0), to: key(2) })
    expect(find(r, key(0))?.count).toBe(2)
    expect(find(r, key(1))?.count).toBe(1)
  })

  it('dense_days_zero_filled', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0) })
    await seedReviewLog(db, cardId, { review: at(3) })
    const r = await heatmap(db, U, { now: NOW, from: key(0), to: key(9) })
    expect(r.days.length).toBe(10)
    expect(r.days.filter((d) => d.count === 0).length).toBe(8)
  })

  it('year_boundary', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: new Date(2025, 11, 31, 12) })
    await seedReviewLog(db, cardId, { review: new Date(2026, 0, 1, 12) })
    const r = await heatmap(db, U, { now: NOW, from: '2025-12-30', to: '2026-01-02' })
    expect(find(r, '2025-12-31')?.count).toBe(1)
    expect(find(r, '2026-01-01')?.count).toBe(1)
  })

  it('heatmap_local_not_utc', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 12, 23, 0) })
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 13, 0, 30) })
    const r = await heatmap(db, U, { now: NOW, from: '2026-07-12', to: '2026-07-13' })
    expect(find(r, '2026-07-12')?.count).toBe(1)
    expect(find(r, '2026-07-13')?.count).toBe(1)
  })

  it('default_trailing_365_when_no_window', async () => {
    const r = await heatmap(db, U, { now: NOW })
    expect(r.days.length).toBe(365)
    expect(r.to).toBe(key(0))
    expect(r.from).toBe(key(-364))
  })

  it('reviews_outside_window_excluded', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(-1) }) // before from
    await seedReviewLog(db, cardId, { review: at(0) })
    await seedReviewLog(db, cardId, { review: at(3) }) // after to
    const r = await heatmap(db, U, { now: NOW, from: key(0), to: key(2) })
    expect(r.total).toBe(1)
  })

  it('activeDays_and_max', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0, 8) })
    await seedReviewLog(db, cardId, { review: at(0, 9) })
    await seedReviewLog(db, cardId, { review: at(0, 10) })
    await seedReviewLog(db, cardId, { review: at(2) })
    const r = await heatmap(db, U, { now: NOW, from: key(0), to: key(4) })
    expect(r.activeDays).toBe(2)
    expect(r.max).toBe(3)
  })

  it('heatmap_excludes_manual_rating', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0), rating: 3 })
    await seedReviewLog(db, cardId, { review: at(0), rating: 1 })
    await seedReviewLog(db, cardId, { review: at(0), rating: 0 }) // Manual, excluded
    const r = await heatmap(db, U, { now: NOW, from: key(0), to: key(1) })
    expect(find(r, key(0))?.count).toBe(2)
    expect(r.total).toBe(2)
  })
})

// ---------------------------------------------------------------------------
describe('study-time', () => {
  const bucket = (r: Awaited<ReturnType<typeof studyTime>>, k: string) =>
    r.buckets.find((b) => b.date === k)

  it('sums_non_null_durations', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0), durationMs: 1000 })
    await seedReviewLog(db, cardId, { review: at(0), durationMs: 2000 })
    const b = bucket(
      await studyTime(db, U, { now: NOW, granularity: 'day', from: key(0), to: key(0) }),
      key(0),
    )
    expect(b?.durationMs).toBe(3000)
    expect(b?.measuredCount).toBe(2)
    expect(b?.avgMs).toBe(1500)
  })

  it('null_duration_excluded_not_zero', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0), durationMs: 4000 })
    await seedReviewLog(db, cardId, { review: at(0), durationMs: null })
    await seedReviewLog(db, cardId, { review: at(0), durationMs: 2000 })
    const b = bucket(
      await studyTime(db, U, { now: NOW, granularity: 'day', from: key(0), to: key(0) }),
      key(0),
    )
    expect(b?.durationMs).toBe(6000)
    expect(b?.reviewCount).toBe(3)
    expect(b?.measuredCount).toBe(2)
    expect(b?.avgMs).toBe(3000) // not 2000 — the NULL is not a 0
  })

  it('all_null_bucket', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0), durationMs: null })
    await seedReviewLog(db, cardId, { review: at(0), durationMs: null })
    const b = bucket(
      await studyTime(db, U, { now: NOW, granularity: 'day', from: key(0), to: key(0) }),
      key(0),
    )
    expect(b?.durationMs).toBe(0)
    expect(b?.measuredCount).toBe(0)
    expect(b?.avgMs).toBeNull()
    expect(b?.reviewCount).toBe(2)
  })

  it('avg_ms_rounded_to_integer', async () => {
    const { cardId } = await chain(db)
    for (const ms of [1000, 2000, 2000])
      await seedReviewLog(db, cardId, { review: at(0), durationMs: ms })
    const b = bucket(
      await studyTime(db, U, { now: NOW, granularity: 'day', from: key(0), to: key(0) }),
      key(0),
    )
    expect(b?.durationMs).toBe(5000)
    expect(b?.measuredCount).toBe(3)
    expect(b?.avgMs).toBe(1667) // Math.round(5000/3), integer
  })

  it('weekly_granularity_buckets_by_monday', async () => {
    const { cardId } = await chain(db)
    // ISO week Mon 2026-07-13 .. Sun 2026-07-19
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 13, 12), durationMs: 100 }) // Mon
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 15, 12), durationMs: 100 }) // Wed
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 19, 12), durationMs: 100 }) // Sun
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 20, 12), durationMs: 100 }) // next Mon
    const r = await studyTime(db, U, {
      now: NOW,
      granularity: 'week',
      from: '2026-07-13',
      to: '2026-07-26',
    })
    expect(bucket(r, '2026-07-13')?.durationMs).toBe(300)
    expect(bucket(r, '2026-07-13')?.reviewCount).toBe(3)
    expect(bucket(r, '2026-07-20')?.durationMs).toBe(100)
  })

  it('dense_buckets_zero_filled', async () => {
    const r = await studyTime(db, U, { now: NOW, granularity: 'day', from: key(0), to: key(2) })
    expect(r.buckets.length).toBe(3)
    for (const b of r.buckets) {
      expect(b.durationMs).toBe(0)
      expect(b.avgMs).toBeNull()
      expect(b.daysInBucket).toBe(1)
    }
  })

  it('partial_edge_week_days_in_bucket', async () => {
    // from = Wednesday 2026-07-15 → first bucket (Mon 2026-07-13) has Wed..Sun = 5 days.
    const r = await studyTime(db, U, {
      now: NOW,
      granularity: 'week',
      from: '2026-07-15',
      to: '2026-07-31',
    })
    expect(bucket(r, '2026-07-13')?.daysInBucket).toBe(5)
    expect(bucket(r, '2026-07-20')?.daysInBucket).toBe(7) // full central week
    // In day granularity, all buckets are 1 day.
    const rDay = await studyTime(db, U, {
      now: NOW,
      granularity: 'day',
      from: '2026-07-15',
      to: '2026-07-31',
    })
    expect(rDay.buckets.every((b) => b.daysInBucket === 1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('retention', () => {
  const findSub = (r: Awaited<ReturnType<typeof retention>>, id: string) =>
    r.subjects.find((s) => s.subjectId === id)

  it('retention_only_review_state', async () => {
    const { subjectId, cardId } = await chain(db)
    for (let i = 0; i < 3; i++) await seedReviewLog(db, cardId, { state: 2, rating: 3 })
    await seedReviewLog(db, cardId, { state: 1, rating: 3 }) // Learning — excluded
    await seedReviewLog(db, cardId, { state: 3, rating: 3 }) // Relearning — excluded
    expect(findSub(await retention(db, U, {}), subjectId)?.maturedReviewed).toBe(3)
  })

  it('rating_ge_2_is_recall', async () => {
    const { subjectId, cardId } = await chain(db)
    await seedReviewLog(db, cardId, { state: 2, rating: 2 }) // Hard → recall
    await seedReviewLog(db, cardId, { state: 2, rating: 1 }) // Again → miss
    const s = findSub(await retention(db, U, {}), subjectId)
    expect(s?.maturedReviewed).toBe(2)
    expect(s?.recalled).toBe(1)
    // postgres-js serializes SUM(bigint) as a string; the service casts to Number.
    expect(typeof s?.recalled).toBe('number')
  })

  it('retention_null_below_min_sample', async () => {
    const { subjectId, cardId } = await chain(db)
    for (let i = 0; i < 3; i++) await seedReviewLog(db, cardId, { state: 2, rating: 4 })
    const s = findSub(await retention(db, U, {}), subjectId)
    expect(s?.maturedReviewed).toBe(3)
    expect(s?.recalled).toBe(3)
    expect(s?.retention).toBeNull()
  })

  it('retention_computed_above_min_sample', async () => {
    const { subjectId, cardId } = await chain(db)
    for (let i = 0; i < 9; i++) await seedReviewLog(db, cardId, { state: 2, rating: 3 })
    await seedReviewLog(db, cardId, { state: 2, rating: 1 }) // one miss → 9/10
    expect(findSub(await retention(db, U, {}), subjectId)?.retention).toBeCloseTo(0.9, 10)
  })

  it('retention_per_subject_split', async () => {
    const a = await chain(db)
    const b = await chain(db)
    for (let i = 0; i < 10; i++) await seedReviewLog(db, a.cardId, { state: 2, rating: 3 }) // 10/10
    for (let i = 0; i < 10; i++)
      await seedReviewLog(db, b.cardId, { state: 2, rating: i < 5 ? 3 : 1 }) // 5/10
    const r = await retention(db, U, {})
    expect(findSub(r, a.subjectId)?.retention).toBeCloseTo(1, 10)
    expect(findSub(r, b.subjectId)?.retention).toBeCloseTo(0.5, 10)
  })

  it('archived_subject_excluded', async () => {
    const arch = await chain(db, { archived: true })
    await seedReviewLog(db, arch.cardId, { state: 2, rating: 3 })
    expect(findSub(await retention(db, U, {}), arch.subjectId)).toBeUndefined()
  })

  it('zero_review_subject_present_null', async () => {
    const { subjectId } = await chain(db)
    const s = findSub(await retention(db, U, {}), subjectId)
    expect(s?.maturedReviewed).toBe(0)
    expect(s?.retention).toBeNull()
  })

  it('retention_window_filters', async () => {
    const { subjectId, cardId } = await chain(db)
    for (const off of [0, 1, 2])
      await seedReviewLog(db, cardId, { state: 2, rating: 3, review: at(off) })
    await seedReviewLog(db, cardId, { state: 2, rating: 3, review: at(-5) }) // out of window
    const s = findSub(await retention(db, U, { from: key(0), to: key(2) }), subjectId)
    expect(s?.maturedReviewed).toBe(3)
  })

  it('manual_rating_zero_excluded_from_denominator', async () => {
    const { subjectId, cardId } = await chain(db)
    for (let i = 0; i < 10; i++) await seedReviewLog(db, cardId, { state: 2, rating: 3 })
    await seedReviewLog(db, cardId, { state: 2, rating: 0 }) // Manual — must not inflate denominator
    const s = findSub(await retention(db, U, {}), subjectId)
    expect(s?.maturedReviewed).toBe(10)
    expect(s?.recalled).toBe(10)
    expect(s?.retention).toBeCloseTo(1, 10)
  })
})

// ---------------------------------------------------------------------------
describe('deck-success', () => {
  const findDeck = (r: Awaited<ReturnType<typeof deckSuccess>>, id: string) =>
    r.decks.find((d) => d.deckId === id)

  it('success_rate_all_states', async () => {
    const { deckId, cardId } = await chain(db)
    for (let i = 0; i < 6; i++) await seedReviewLog(db, cardId, { state: 1, rating: 3 }) // Learning counts
    for (let i = 0; i < 4; i++) await seedReviewLog(db, cardId, { state: 2, rating: 1 }) // misses
    const d = findDeck(await deckSuccess(db, U, {}), deckId)
    expect(d?.reviewed).toBe(10)
    expect(d?.passed).toBe(6)
    expect(typeof d?.passed).toBe('number') // postgres-js bigint → Number cast
    expect(d?.successRate).toBeCloseTo(0.6, 10)
  })

  it('success_null_below_min_sample', async () => {
    const { deckId, cardId } = await chain(db)
    for (let i = 0; i < 5; i++) await seedReviewLog(db, cardId, { state: 2, rating: 3 })
    const d = findDeck(await deckSuccess(db, U, {}), deckId)
    expect(d?.reviewed).toBe(5)
    expect(d?.passed).toBe(5)
    expect(d?.successRate).toBeNull()
  })

  it('zero_review_deck_present_null', async () => {
    const { deckId } = await chain(db)
    const d = findDeck(await deckSuccess(db, U, {}), deckId)
    expect(d?.reviewed).toBe(0)
    expect(d?.successRate).toBeNull()
  })

  it('archived_subject_decks_excluded', async () => {
    const arch = await chain(db, { archived: true })
    await seedReviewLog(db, arch.cardId, { state: 2, rating: 3 })
    expect(findDeck(await deckSuccess(db, U, {}), arch.deckId)).toBeUndefined()
  })

  it('deck_success_window_filters', async () => {
    const { deckId, cardId } = await chain(db)
    for (const off of [0, 1]) await seedReviewLog(db, cardId, { rating: 3, review: at(off) })
    await seedReviewLog(db, cardId, { rating: 3, review: at(-5) }) // out of window
    expect(findDeck(await deckSuccess(db, U, { from: key(0), to: key(2) }), deckId)?.reviewed).toBe(
      2,
    )
  })

  it('manual_rating_zero_excluded_from_denominator', async () => {
    const { deckId, cardId } = await chain(db)
    for (let i = 0; i < 10; i++) await seedReviewLog(db, cardId, { rating: 3 })
    await seedReviewLog(db, cardId, { rating: 0 }) // Manual
    expect(findDeck(await deckSuccess(db, U, {}), deckId)?.reviewed).toBe(10)
  })
})

// ---------------------------------------------------------------------------
describe('hardest-cards', () => {
  /** Seed a REVIEWED card: FSRS has written a difficulty and at least MIN_REPS. */
  const reviewed = (
    db: DB,
    deckId: string,
    o: { difficulty: number; reps?: number; lapses?: number; front?: string },
  ) =>
    seedCard(db, deckId, {
      difficulty: o.difficulty,
      reps: o.reps ?? MIN_REPS,
      lapses: o.lapses ?? 0,
      ...(o.front !== undefined ? { front: o.front } : {}),
    })

  it('ranks_the_hardest_card_of_a_subject_first', async () => {
    const { deckId, subjectId } = await chain(db)
    const easy = await reviewed(db, deckId, { difficulty: 2.5 })
    const hard = await reviewed(db, deckId, { difficulty: 8.4 })
    const mid = await reviewed(db, deckId, { difficulty: 5 })
    const r = await hardestCards(db, U, { limit: 5 })
    expect(r.cards.map((c) => c.cardId)).toEqual([hard.id, mid.id, easy.id])
    expect(r.cards.every((c) => c.subjectId === subjectId)).toBe(true)
    expect(r.cards[0]?.difficulty).toBeCloseTo(8.4, 10)
  })

  it('never_reviewed_card_absent_even_alone_in_its_subject', async () => {
    // difficulty defaults to 0 and ts-fsrs only writes it on the first review:
    // this card is UNKNOWN, not easy — it must not appear at all.
    const { deckId, subjectId } = await chain(db)
    await seedCard(db, deckId) // pristine: difficulty 0, reps 0
    const r = await hardestCards(db, U, { limit: 5 })
    expect(r.cards).toEqual([])
    expect(r.cards.some((c) => c.subjectId === subjectId)).toBe(false)
  })

  it('difficulty_zero_with_enough_reps_still_absent', async () => {
    // reps alone is not enough: a 0 difficulty is off-scale whatever the reps.
    const { deckId } = await chain(db)
    await reviewed(db, deckId, { difficulty: 0, reps: 20 })
    expect((await hardestCards(db, U, { limit: 5 })).cards).toEqual([])
  })

  it('card_below_min_reps_absent', async () => {
    const { deckId } = await chain(db)
    const shy = await reviewed(db, deckId, { difficulty: 9.9, reps: MIN_REPS - 1 })
    const kept = await reviewed(db, deckId, { difficulty: 4, reps: MIN_REPS })
    const r = await hardestCards(db, U, { limit: 5 })
    expect(r.cards.map((c) => c.cardId)).toEqual([kept.id])
    expect(r.cards.some((c) => c.cardId === shy.id)).toBe(false)
    expect(r.minReps).toBe(MIN_REPS)
  })

  it('limit_applies_per_subject_not_globally', async () => {
    const a = await chain(db)
    const b = await chain(db)
    for (const d of [7, 6, 5, 4]) await reviewed(db, a.deckId, { difficulty: d })
    for (const d of [9, 8, 3, 2]) await reviewed(db, b.deckId, { difficulty: d })
    const r = await hardestCards(db, U, { limit: 2 })
    expect(r.cards.length).toBe(4) // 2 subjects × 2, NOT a global top-2
    expect(r.cards.filter((c) => c.subjectId === a.subjectId).length).toBe(2)
    expect(r.cards.filter((c) => c.subjectId === b.subjectId).length).toBe(2)
    const byA = r.cards.filter((c) => c.subjectId === a.subjectId).map((c) => c.difficulty)
    expect(byA).toEqual([7, 6])
    expect(r.limit).toBe(2)
  })

  it('other_user_cards_absent', async () => {
    const mine = await chain(db)
    await reviewed(db, mine.deckId, { difficulty: 4 })
    const theirs = await seedSubject(db, { userId: 'user-other' })
    const theirDeck = await seedDeck(db, theirs.id, { userId: 'user-other' })
    await seedCard(db, theirDeck.id, {
      userId: 'user-other',
      difficulty: 10,
      reps: MIN_REPS,
    })
    const r = await hardestCards(db, U, { limit: 5 })
    expect(r.cards.length).toBe(1)
    expect(r.cards[0]?.subjectId).toBe(mine.subjectId)
  })

  it('archived_subject_cards_excluded', async () => {
    const arch = await chain(db, { archived: true })
    await reviewed(db, arch.deckId, { difficulty: 9 })
    expect((await hardestCards(db, U, { limit: 5 })).cards).toEqual([])
  })

  it('order_is_deterministic_on_difficulty_ties', async () => {
    const { deckId } = await chain(db)
    // Same difficulty: `lapses DESC` then `id ASC` must decide, identically at
    // every call — otherwise the `limit` cut would be a coin flip.
    await reviewed(db, deckId, { difficulty: 6, lapses: 1 })
    await reviewed(db, deckId, { difficulty: 6, lapses: 4 })
    await reviewed(db, deckId, { difficulty: 6, lapses: 1 })
    const first = await hardestCards(db, U, { limit: 5 })
    const second = await hardestCards(db, U, { limit: 5 })
    expect(first.cards.map((c) => c.cardId)).toEqual(second.cards.map((c) => c.cardId))
    expect(first.cards[0]?.lapses).toBe(4) // lapses breaks the difficulty tie
    const tied = first.cards.slice(1).map((c) => c.cardId)
    expect(tied).toEqual([...tied].sort()) // then id ASC
  })

  it('front_is_a_bounded_excerpt', async () => {
    const { deckId } = await chain(db)
    await reviewed(db, deckId, { difficulty: 5, front: '#'.repeat(400) })
    const r = await hardestCards(db, U, { limit: 5 })
    expect(r.cards[0]?.front.length).toBe(160)
  })

  it('response_matches_the_shared_contract', async () => {
    const { deckId } = await chain(db)
    await reviewed(db, deckId, { difficulty: 7.25, reps: 9, lapses: 2 })
    const r = await hardestCards(db, U, { limit: 5 })
    expect(hardestCardsResponseSchema.safeParse(r).success).toBe(true)
  })

  it('emits_one_sql_query', async () => {
    const { deckId } = await chain(db)
    for (const d of [3, 6, 9]) await reviewed(db, deckId, { difficulty: d })
    const spy = spyOn(t.client, 'query')
    const before = spy.mock.calls.length
    await hardestCards(db, U, { limit: 5 })
    const after = spy.mock.calls.length
    spy.mockRestore()
    expect(after - before).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('review-volume', () => {
  const bucket = (r: Awaited<ReturnType<typeof reviewVolume>>, k: string) =>
    r.buckets.find((b) => b.date === k)

  it('counts_by_rating_per_day', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0), rating: 1 })
    await seedReviewLog(db, cardId, { review: at(0), rating: 2 })
    await seedReviewLog(db, cardId, { review: at(0), rating: 2 })
    await seedReviewLog(db, cardId, { review: at(0), rating: 3 })
    await seedReviewLog(db, cardId, { review: at(0), rating: 4 })
    const b = bucket(
      await reviewVolume(db, U, { now: NOW, granularity: 'day', from: key(0), to: key(0) }),
      key(0),
    )
    expect(b).toMatchObject({ again: 1, hard: 2, good: 1, easy: 1, total: 5 })
  })

  it('stacked_total_equals_sum', async () => {
    const { cardId } = await chain(db)
    for (const rt of [1, 2, 3, 4, 3, 3])
      await seedReviewLog(db, cardId, { review: at(0), rating: rt })
    const r = await reviewVolume(db, U, { now: NOW, granularity: 'day', from: key(0), to: key(2) })
    for (const b of r.buckets) expect(b.total).toBe(b.again + b.hard + b.good + b.easy)
    expect(r.totals.total).toBe(r.totals.again + r.totals.hard + r.totals.good + r.totals.easy)
  })

  it('manual_rating_zero_excluded', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0), rating: 3 })
    await seedReviewLog(db, cardId, { review: at(0), rating: 0 }) // Manual
    const r = await reviewVolume(db, U, { now: NOW, granularity: 'day', from: key(0), to: key(0) })
    expect(r.totals.total).toBe(1)
    expect(r.totals.good).toBe(1)
  })

  it('review_volume_weekly', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 13, 12), rating: 3 }) // Mon
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 19, 12), rating: 4 }) // Sun same week
    const r = await reviewVolume(db, U, {
      now: NOW,
      granularity: 'week',
      from: '2026-07-13',
      to: '2026-07-19',
    })
    const b = bucket(r, '2026-07-13')
    expect(b?.good).toBe(1)
    expect(b?.easy).toBe(1)
    expect(b?.total).toBe(2)
  })

  it('review_volume_dense_zero_filled', async () => {
    const r = await reviewVolume(db, U, { now: NOW, granularity: 'day', from: key(0), to: key(3) })
    expect(r.buckets.length).toBe(4)
    expect(r.buckets.every((b) => b.total === 0)).toBe(true)
  })

  it('review_volume_partial_edge_week_days_in_bucket', async () => {
    const r = await reviewVolume(db, U, {
      now: NOW,
      granularity: 'week',
      from: '2026-07-15',
      to: '2026-07-31',
    })
    expect(bucket(r, '2026-07-13')?.daysInBucket).toBe(5)
    expect(bucket(r, '2026-07-20')?.daysInBucket).toBe(7)
  })
})

// ---------------------------------------------------------------------------
describe('window guards', () => {
  it('from_after_to_400', async () => {
    await expect(heatmap(db, U, { now: NOW, from: key(2), to: key(0) })).rejects.toThrow(
      ValidationError,
    )
    await expect(retention(db, U, { from: key(2), to: key(0) })).rejects.toThrow(ValidationError)
  })

  it('window_too_large_400', async () => {
    await expect(
      heatmap(db, U, { now: NOW, from: '2026-01-01', to: '2027-12-31' }),
    ).rejects.toThrow(ValidationError)
    await expect(retention(db, U, { from: '2026-01-01', to: '2027-12-31' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('only_from_without_to_400', async () => {
    await expect(heatmap(db, U, { now: NOW, from: key(0) })).rejects.toThrow(ValidationError)
    await expect(heatmap(db, U, { now: NOW, to: key(0) })).rejects.toThrow(ValidationError)
    await expect(retention(db, U, { from: key(0) })).rejects.toThrow(ValidationError)
    await expect(retention(db, U, { to: key(0) })).rejects.toThrow(ValidationError)
  })
})

// ---------------------------------------------------------------------------
describe('cross-lens consistency', () => {
  it('cross_lens_consistency', async () => {
    // Active subject + an archived one, plus a Manual(0) row. The three series
    // must agree on the counted total (Manual excluded, archived included).
    const active = await chain(db)
    const arch = await chain(db, { archived: true })
    for (const off of [0, 1, 2]) {
      await seedReviewLog(db, active.cardId, { review: at(off), rating: 3, durationMs: 500 })
      await seedReviewLog(db, arch.cardId, { review: at(off), rating: 2, durationMs: 300 })
    }
    await seedReviewLog(db, active.cardId, { review: at(1), rating: 0 }) // Manual — excluded everywhere

    const win = { now: NOW, from: key(0), to: key(2) }
    const h = await heatmap(db, U, win)
    const st = await studyTime(db, U, { ...win, granularity: 'day' })
    const rv = await reviewVolume(db, U, { ...win, granularity: 'day' })

    const stReviewCount = st.buckets.reduce((n, b) => n + b.reviewCount, 0)
    expect(h.total).toBe(6)
    expect(h.total).toBe(stReviewCount)
    expect(h.total).toBe(rv.totals.total)
  })
})

// ---------------------------------------------------------------------------
describe('one query per endpoint', () => {
  /** Seed ≥3 subjects × ≥2 decks × several reviews to expose any N+1. */
  async function seedFanOut(db: DB): Promise<void> {
    for (let s = 0; s < 3; s++) {
      const subj = await seedSubject(db)
      for (let d = 0; d < 2; d++) {
        const dk = await seedDeck(db, subj.id)
        const c = await seedCard(db, dk.id)
        for (let i = 0; i < 4; i++)
          await seedReviewLog(db, c.id, { state: 2, rating: 3, review: at(-i) })
      }
    }
  }

  /**
   * drizzle-orm/pglite calls `client.query()` exactly once per executed
   * statement, so this counts real round-trips (an N+1 shows up as > 1).
   */
  async function countQueries(fn: () => Promise<unknown>): Promise<number> {
    const spy = spyOn(t.client, 'query')
    const before = spy.mock.calls.length
    await fn()
    const after = spy.mock.calls.length
    spy.mockRestore()
    return after - before
  }

  it('emits exactly one SQL query per endpoint', async () => {
    await seedFanOut(db)
    const win = { now: NOW, from: key(-30), to: key(0) }
    expect(await countQueries(() => heatmap(db, U, win))).toBe(1)
    expect(await countQueries(() => streaks(db, U, NOW))).toBe(1)
    expect(await countQueries(() => studyTime(db, U, { ...win, granularity: 'week' }))).toBe(1)
    expect(await countQueries(() => reviewVolume(db, U, { ...win, granularity: 'day' }))).toBe(1)
    expect(await countQueries(() => retention(db, U, {}))).toBe(1)
    expect(await countQueries(() => deckSuccess(db, U, {}))).toBe(1)
  })

  it('narrowing by subject costs no extra round-trip', async () => {
    // The subject predicate is a SEMI-JOIN inside the same statement, never a
    // "fetch the card ids, then scan" two-step.
    await seedFanOut(db)
    const s = (await db.select({ id: subject.id }).from(subject))[0]!.id
    const win = { now: NOW, from: key(-30), to: key(0), subjectId: s }
    expect(await countQueries(() => heatmap(db, U, win))).toBe(1)
    expect(await countQueries(() => studyTime(db, U, { ...win, granularity: 'day' }))).toBe(1)
    expect(await countQueries(() => reviewVolume(db, U, { ...win, granularity: 'day' }))).toBe(1)
    expect(await countQueries(() => retention(db, U, { subjectId: s }))).toBe(1)
    expect(await countQueries(() => deckSuccess(db, U, { subjectId: s }))).toBe(1)
    expect(await countQueries(() => hardestCards(db, U, { limit: 5, subjectId: s }))).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('per-subject narrowing', () => {
  /** Two independent subjects, each with one card, so every lens can be split. */
  async function twoSubjects() {
    const a = await chain(db)
    const b = await chain(db)
    return { a, b }
  }

  it('heatmap_counts_only_the_named_subject', async () => {
    const { a, b } = await twoSubjects()
    await seedReviewLog(db, a.cardId, { review: at(0) })
    await seedReviewLog(db, a.cardId, { review: at(-1) })
    await seedReviewLog(db, b.cardId, { review: at(0) })
    const win = { now: NOW, from: key(-2), to: key(0) }
    expect((await heatmap(db, U, win)).total).toBe(3)
    expect((await heatmap(db, U, { ...win, subjectId: a.subjectId })).total).toBe(2)
    expect((await heatmap(db, U, { ...win, subjectId: b.subjectId })).total).toBe(1)
  })

  it('study_time_and_review_volume_split_by_subject', async () => {
    const { a, b } = await twoSubjects()
    await seedReviewLog(db, a.cardId, { review: at(0), rating: 3, durationMs: 1000 })
    await seedReviewLog(db, b.cardId, { review: at(0), rating: 1, durationMs: 4000 })
    const win = { now: NOW, from: key(0), to: key(0), granularity: 'day' as const }
    expect((await studyTime(db, U, { ...win, subjectId: a.subjectId })).totalMs).toBe(1000)
    expect((await studyTime(db, U, { ...win, subjectId: b.subjectId })).totalMs).toBe(4000)
    expect((await studyTime(db, U, win)).totalMs).toBe(5000)
    const rvA = await reviewVolume(db, U, { ...win, subjectId: a.subjectId })
    expect(rvA.totals).toMatchObject({ good: 1, again: 0, total: 1 })
  })

  it('retention_deck_success_hardest_cards_narrow_to_one_subject', async () => {
    const { a, b } = await twoSubjects()
    for (let i = 0; i < 12; i++) {
      await seedReviewLog(db, a.cardId, { state: 2, rating: 3 })
      await seedReviewLog(db, b.cardId, { state: 2, rating: 1 })
    }
    const ret = await retention(db, U, { subjectId: a.subjectId })
    expect(ret.subjects).toHaveLength(1)
    expect(ret.subjects[0]?.subjectId).toBe(a.subjectId)
    expect(ret.subjects[0]?.retention).toBe(1)

    const ds = await deckSuccess(db, U, { subjectId: b.subjectId })
    expect(ds.decks).toHaveLength(1)
    expect(ds.decks[0]?.successRate).toBe(0)

    const dk = await seedDeck(db, a.subjectId)
    await seedCard(db, dk.id, { difficulty: 9, reps: 5 })
    const hc = await hardestCards(db, U, { limit: 5, subjectId: a.subjectId })
    expect(hc.cards).toHaveLength(1)
    expect(hc.cards[0]?.subjectId).toBe(a.subjectId)
  })

  it('an_archived_subject_asked_for_by_id_is_returned', async () => {
    // Archiving hides a subject from lists nobody asked for; it does not erase
    // the history of one asked for BY ID.
    const arch = await chain(db, { archived: true })
    for (let i = 0; i < 12; i++) await seedReviewLog(db, arch.cardId, { state: 2, rating: 3 })
    expect((await retention(db, U, {})).subjects).toHaveLength(0)
    const scoped = await retention(db, U, { subjectId: arch.subjectId })
    expect(scoped.subjects).toHaveLength(1)
    expect(scoped.subjects[0]?.maturedReviewed).toBe(12)
  })

  it('an_unknown_or_foreign_subject_reads_empty_never_another_user_data', async () => {
    const OTHER = 'user-other'
    const s = await seedSubject(db, { userId: OTHER })
    const d = await seedDeck(db, s.id, { userId: OTHER })
    const c = await seedCard(db, d.id, { userId: OTHER, difficulty: 9, reps: 5 })
    for (let i = 0; i < 12; i++)
      await seedReviewLog(db, c.id, { userId: OTHER, state: 2, rating: 3, review: at(0) })

    const win = { now: NOW, from: key(0), to: key(0) }
    // U asking for another user's subject id: empty everywhere, never a leak.
    expect((await heatmap(db, U, { ...win, subjectId: s.id })).total).toBe(0)
    expect((await retention(db, U, { subjectId: s.id })).subjects).toHaveLength(0)
    expect((await deckSuccess(db, U, { subjectId: s.id })).decks).toHaveLength(0)
    expect((await hardestCards(db, U, { limit: 5, subjectId: s.id })).cards).toHaveLength(0)
    expect((await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects).toHaveLength(0)
    // A wholly unknown id behaves identically (no existence oracle).
    expect((await heatmap(db, U, { ...win, subjectId: 'nope' })).total).toBe(0)
    // The owner still sees their own data.
    expect((await retention(db, OTHER, { subjectId: s.id })).subjects).toHaveLength(1)
  })

  it('subject_filter_does_not_widen_the_user_scope', async () => {
    // The filter is applied ON TOP of the user scope: even naming a subject
    // that genuinely exists, the caller only ever sees their own rows.
    const OTHER = 'user-other'
    const s = await seedSubject(db, { userId: OTHER })
    const d = await seedDeck(db, s.id, { userId: OTHER })
    const c = await seedCard(db, d.id, { userId: OTHER })
    await seedReviewLog(db, c.id, { userId: OTHER, review: at(0) })
    const r = await heatmap(db, U, { now: NOW, from: key(0), to: key(0), subjectId: s.id })
    expect(r.total).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('exam readiness', () => {
  const DAY_MS = 86_400_000
  /** Local midnight `off` days from NOW — the convention exams are stored at. */
  const day = (off: number) => new Date(2026, 6, 12 + off)

  /**
   * Pose a LEARNED card: FSRS reads `stability` (memory strength, in days) and
   * `lastReview`. Reviewed `agoDays` before NOW, so recall at NOW is high and
   * decays from there.
   */
  const learnedCard = (deckId: string, stability: number, agoDays: number) =>
    seedCard(db, deckId, {
      state: 2,
      reps: 3,
      difficulty: 5,
      stability,
      lastReview: new Date(NOW.getTime() - agoDays * DAY_MS),
      due: new Date(NOW.getTime() + (stability - agoDays) * DAY_MS),
    })

  it('projects_each_card_to_the_exam_day_and_counts_those_above_the_threshold', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await learnedCard(d.id, 200, 0) // strong: still ~known in 10 days
    await learnedCard(d.id, 1, 0) // weak: long forgotten by then
    await seedExam(db, [s.id], { date: day(10), title: 'Partiel' })

    const r = await examReadiness(db, U, { now: NOW, subjectId: s.id })
    expect(r.threshold).toBe(0.9)
    const [subj] = r.subjects
    expect(subj?.exams).toHaveLength(1)
    const e = subj!.exams[0]!
    expect(e.title).toBe('Partiel')
    expect(e.status).toBe('forecast')
    expect(e.daysUntil).toBe(10)
    expect(e.projection).toMatchObject({ cardTotal: 2, ready: 1, notReady: 1, neverReviewed: 0 })
    expect(e.projection?.readiness).toBe(0.5)
  })

  it('readiness_decays_as_the_exam_moves_further_away', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await learnedCard(d.id, 20, 0)
    await seedExam(db, [s.id], { date: day(1), title: 'Proche' })
    await seedExam(db, [s.id], { date: day(60), title: 'Lointain' })
    const [subj] = (await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects
    const [near, far] = subj!.exams // ordered by date asc
    expect(near?.title).toBe('Proche')
    expect(near?.projection?.readiness).toBe(1)
    expect(far?.projection?.readiness).toBe(0)
    expect(far!.projection!.meanRecall!).toBeLessThan(near!.projection!.meanRecall!)
    expect(far!.projection!.meanRecall!).toBeGreaterThan(0)
  })

  // --- the trap: never-reviewed cards --------------------------------------

  it('never_reviewed_cards_are_counted_as_not_ready_never_dropped', async () => {
    // The scenario the metric exists to refuse: 4 studied cards, 6 untouched.
    // Excluding the untouched ones would read "100 % prêt"; the honest answer is
    // 40 %, with the 6 named so the UI can say why.
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    for (let i = 0; i < 4; i++) await learnedCard(d.id, 200, 0)
    for (let i = 0; i < 6; i++) await seedCard(db, d.id) // pristine: state New
    await seedExam(db, [s.id], { date: day(7) })

    const p = (await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects[0]!.exams[0]!
      .projection!
    expect(p.cardTotal).toBe(10)
    expect(p.ready).toBe(4)
    expect(p.notReady).toBe(6)
    expect(p.neverReviewed).toBe(6)
    expect(p.readiness).toBeCloseTo(0.4, 10)
    // A never-reviewed card contributes 0 to the mean, so the mean can never be
    // dragged up by cards nobody has seen.
    expect(p.meanRecall!).toBeLessThan(0.4 + 0.6 * 0.0001 + 0.4)
    expect(p.meanRecall!).toBeGreaterThan(0.3)
  })

  it('never_reviewed_is_a_subset_of_not_ready_not_a_separate_bucket', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id)
    await learnedCard(d.id, 1, 30) // learned then thoroughly forgotten
    await seedExam(db, [s.id], { date: day(3) })
    const p = (await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects[0]!.exams[0]!
      .projection!
    expect(p.notReady).toBe(2)
    expect(p.neverReviewed).toBe(1) // the forgotten card is NOT "never reviewed"
    expect(p.ready + p.notReady).toBe(p.cardTotal)
  })

  it('a_card_in_a_state_without_a_last_review_counts_as_never_reviewed', async () => {
    // Defensive: ts-fsrs throws on a null last_review. A restored backup must
    // degrade to "not ready", never take the endpoint down.
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id, { state: 2, reps: 4, stability: 50, lastReview: null })
    await seedExam(db, [s.id], { date: day(5) })
    const p = (await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects[0]!.exams[0]!
      .projection!
    expect(p).toMatchObject({ cardTotal: 1, ready: 0, notReady: 1, neverReviewed: 1 })
    expect(p.readiness).toBe(0)
  })

  // --- degenerate cases ----------------------------------------------------

  it('a_subject_with_an_exam_and_ZERO_cards_says_so_instead_of_nothing', async () => {
    // The tester's exact case: an exam three weeks out on an empty subject.
    const s = await seedSubject(db)
    await seedExam(db, [s.id], { date: day(21), title: 'Partiel TL' })
    const [subj] = (await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects
    const e = subj!.exams[0]!
    expect(e.status).toBe('no_cards')
    expect(e.daysUntil).toBe(21)
    expect(e.projectedAt).not.toBeNull()
    // 0 ready out of 0 is NOT 100 % — and not 0 % either. It is undefined.
    expect(e.projection).toMatchObject({ cardTotal: 0, ready: 0, notReady: 0, neverReviewed: 0 })
    expect(e.projection?.readiness).toBeNull()
    expect(e.projection?.meanRecall).toBeNull()
    expect(subj?.today.readiness).toBeNull()
  })

  it('a_subject_with_no_exam_still_reports_where_it_stands_today', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await learnedCard(d.id, 200, 0)
    await seedCard(db, d.id)
    const [subj] = (await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects
    expect(subj?.exams).toEqual([])
    expect(subj?.today).toMatchObject({ cardTotal: 2, ready: 1, notReady: 1, neverReviewed: 1 })
    expect(subj?.today.readiness).toBe(0.5)
  })

  it('a_past_exam_is_reported_without_a_forecast', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await learnedCard(d.id, 200, 0)
    await seedExam(db, [s.id], { date: day(-3), title: 'Déjà passé' })
    const e = (await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects[0]!.exams[0]!
    expect(e.status).toBe('past')
    expect(e.daysUntil).toBe(-3)
    expect(e.projection).toBeNull() // a forecast for a past date is a contradiction
    expect(e.projectedAt).toBeNull()
    expect(e.title).toBe('Déjà passé')
  })

  it('past_exams_are_reported_only_within_the_bounded_tail', async () => {
    const s = await seedSubject(db)
    await seedExam(db, [s.id], { date: day(-(PAST_EXAM_WINDOW_DAYS - 1)), title: 'récent' })
    await seedExam(db, [s.id], { date: day(-(PAST_EXAM_WINDOW_DAYS + 1)), title: 'ancien' })
    const r = await examReadiness(db, U, { now: NOW, subjectId: s.id })
    expect(r.pastWindowDays).toBe(PAST_EXAM_WINDOW_DAYS)
    expect(r.subjects[0]?.exams.map((e) => e.title)).toEqual(['récent'])
  })

  it('an_account_with_no_subject_returns_an_empty_list_not_a_throw', async () => {
    const r = await examReadiness(db, U, { now: NOW })
    expect(r.subjects).toEqual([])
    expect(r.threshold).toBe(0.9)
  })

  // --- day boundaries ------------------------------------------------------

  it('an_exam_today_is_a_forecast_projected_from_now_not_from_a_past_midnight', async () => {
    // An exam is a DAY. Its stored instant is this morning's midnight, already
    // behind NOW (10:00) — projecting there would read the card as fresher than
    // it is. The projection instant is floored at NOW.
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await learnedCard(d.id, 20, 0)
    await seedExam(db, [s.id], { date: day(0) })
    const e = (await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects[0]!.exams[0]!
    expect(e.status).toBe('forecast')
    expect(e.daysUntil).toBe(0)
    expect(e.projectedAt).toBe(NOW.toISOString())
  })

  it('the_day_boundary_is_local_midnight_not_an_instant_comparison', async () => {
    // An exam stored at local midnight today is NOT "past" at 10:00, and one
    // stored at local midnight yesterday IS — the cut is the calendar day, the
    // same convention lib/day.ts imposes everywhere else.
    const s = await seedSubject(db)
    await learnedCard((await seedDeck(db, s.id)).id, 30, 0)
    await seedExam(db, [s.id], { date: day(0), title: 'today' })
    await seedExam(db, [s.id], { date: day(-1), title: 'yesterday' })
    const byTitle = new Map(
      (await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects[0]!.exams.map((e) => [
        e.title,
        e,
      ]),
    )
    expect(byTitle.get('today')?.status).toBe('forecast')
    expect(byTitle.get('yesterday')?.status).toBe('past')
    // The reported date is renormalised to the exam day's local midnight.
    expect(byTitle.get('today')?.date).toBe(day(0).toISOString())
  })

  it('an_exam_stored_mid_day_is_still_read_as_that_whole_day', async () => {
    const s = await seedSubject(db)
    await seedExam(db, [s.id], { date: new Date(2026, 6, 12, 23, 30) }) // today, late
    const e = (await examReadiness(db, U, { now: NOW, subjectId: s.id })).subjects[0]!.exams[0]!
    expect(e.daysUntil).toBe(0)
    expect(e.date).toBe(day(0).toISOString())
  })

  // --- scoping and shape ---------------------------------------------------

  it('an_exam_shared_by_two_subjects_is_scored_against_each_one_separately', async () => {
    const a = await seedSubject(db)
    const b = await seedSubject(db)
    const da = await seedDeck(db, a.id)
    await learnedCard(da.id, 200, 0)
    const dbk = await seedDeck(db, b.id)
    await seedCard(db, dbk.id) // never reviewed
    await seedExam(db, [a.id, b.id], { date: day(5), title: 'Commun' })
    const r = await examReadiness(db, U, { now: NOW })
    const byId = new Map(r.subjects.map((s) => [s.subjectId, s]))
    expect(byId.get(a.id)?.exams[0]?.projection?.readiness).toBe(1)
    expect(byId.get(b.id)?.exams[0]?.projection?.readiness).toBe(0)
    expect(byId.get(b.id)?.exams[0]?.projection?.neverReviewed).toBe(1)
  })

  it('unfiltered_readiness_lists_every_non_archived_subject_including_exam_less_ones', async () => {
    const withExam = await seedSubject(db)
    const without = await seedSubject(db)
    await seedSubject(db, { archived: true })
    await seedExam(db, [withExam.id], { date: day(4) })
    const r = await examReadiness(db, U, { now: NOW })
    expect(r.subjects).toHaveLength(2)
    expect(r.subjects.find((s) => s.subjectId === without.id)?.exams).toEqual([])
  })

  it('readiness_never_crosses_users', async () => {
    const OTHER = 'user-other'
    const mine = await seedSubject(db)
    const theirs = await seedSubject(db, { userId: OTHER })
    const theirDeck = await seedDeck(db, theirs.id, { userId: OTHER })
    await seedCard(db, theirDeck.id, { userId: OTHER })
    await seedExam(db, [theirs.id], { date: day(2), userId: OTHER })
    await seedExam(db, [mine.id], { date: day(2) })

    const r = await examReadiness(db, U, { now: NOW })
    expect(r.subjects.map((s) => s.subjectId)).toEqual([mine.id])
    expect(r.subjects[0]?.exams).toHaveLength(1)
    const other = await examReadiness(db, OTHER, { now: NOW })
    expect(other.subjects.map((s) => s.subjectId)).toEqual([theirs.id])
    expect(other.subjects[0]?.today.cardTotal).toBe(1)
  })

  it('another_user_exam_can_never_attach_to_my_subject', async () => {
    // Defence in depth: even if the junction row pointed at my subject, the
    // exam query is scoped by `exam.user_id`.
    const OTHER = 'user-other'
    const mine = await seedSubject(db)
    await seedExam(db, [mine.id], { date: day(2), userId: OTHER, title: 'not mine' })
    const r = await examReadiness(db, U, { now: NOW, subjectId: mine.id })
    expect(r.subjects[0]?.exams).toEqual([])
  })

  it('contract_valid_for_every_status', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await learnedCard(d.id, 30, 0)
    await seedExam(db, [s.id], { date: day(-2) })
    await seedExam(db, [s.id], { date: day(9) })
    const empty = await seedSubject(db)
    await seedExam(db, [empty.id], { date: day(9) })
    const parsed = examReadinessResponseSchema.safeParse(await examReadiness(db, U, { now: NOW }))
    expect(parsed.success).toBe(true)
  })

  it('cost_is_three_queries_whatever_the_card_count', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    for (let i = 0; i < 60; i++) await learnedCard(d.id, 10 + i, i % 7)
    for (const off of [3, 10, 21]) await seedExam(db, [s.id], { date: day(off) })
    const spy = spyOn(t.client, 'query')
    const before = spy.mock.calls.length
    await examReadiness(db, U, { now: NOW, subjectId: s.id })
    const n = spy.mock.calls.length - before
    spy.mockRestore()
    // subjects + cards + exams. Never one per card, never one per exam.
    expect(n).toBe(3)
  })
})
