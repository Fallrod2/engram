import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { subject } from '../db/schema'
import { seedCard, seedDeck, seedReviewLog, seedSubject } from '../test-support/harness'
import { localDayKey } from '../lib/day'
import { ValidationError } from '../http/errors'
import {
  deckSuccess,
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
    const r = await streaks(db, NOW)
    expect(r.current).toBe(3)
    expect(r.includesToday).toBe(true)
    expect(r.lastStudyDay).toBe(key(0))
    expect(r.totalStudyDays).toBe(3)
  })

  it('current_streak_includes_yesterday_when_today_empty', async () => {
    const { cardId } = await chain(db)
    for (const off of [-1, -2]) await seedReviewLog(db, cardId, { review: at(off) })
    const r = await streaks(db, NOW)
    expect(r.current).toBe(2)
    expect(r.includesToday).toBe(false)
  })

  it('current_streak_zero_when_gap_before_today', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(-2) })
    expect((await streaks(db, NOW)).current).toBe(0)
  })

  it('streak_broken_by_gap', async () => {
    const { cardId } = await chain(db)
    for (const off of [0, -1, -3, -4, -5]) await seedReviewLog(db, cardId, { review: at(off) })
    const r = await streaks(db, NOW)
    expect(r.current).toBe(2)
    expect(r.longest).toBe(3)
  })

  it('longest_streak_over_history', async () => {
    const { cardId } = await chain(db)
    for (const off of [-10, -9, -8, -7, -6]) await seedReviewLog(db, cardId, { review: at(off) })
    await seedReviewLog(db, cardId, { review: at(0) })
    const r = await streaks(db, NOW)
    expect(r.current).toBe(1)
    expect(r.longest).toBe(5)
  })

  it('multiple_reviews_same_day_count_one', async () => {
    const { cardId } = await chain(db)
    for (const h of [8, 12, 20]) await seedReviewLog(db, cardId, { review: at(0, h) })
    await seedReviewLog(db, cardId, { review: at(-1) })
    const r = await streaks(db, NOW)
    expect(r.current).toBe(2)
    expect(r.totalStudyDays).toBe(2)
  })

  it('streak_local_not_utc', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 12, 23, 0) }) // 23:00 Jul 12
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 13, 0, 30) }) // 00:30 Jul 13
    const r = await streaks(db, new Date(2026, 6, 13, 10, 0))
    expect(r.totalStudyDays).toBe(2)
    expect(r.current).toBe(2) // today Jul 13 + yesterday Jul 12
  })

  it('empty_history_streaks_zero', async () => {
    const r = await streaks(db, NOW)
    expect(r.current).toBe(0)
    expect(r.longest).toBe(0)
    expect(r.lastStudyDay).toBeNull()
    expect(r.totalStudyDays).toBe(0)
  })

  it('archived_subject_still_counts_in_streak', async () => {
    const { cardId } = await chain(db, { archived: true })
    await seedReviewLog(db, cardId, { review: at(0) })
    expect((await streaks(db, NOW)).current).toBe(1)
  })

  it('archiving_midway_does_not_shrink_history', async () => {
    const { subjectId, cardId } = await chain(db)
    for (const off of [-4, -3, -2, -1, 0]) await seedReviewLog(db, cardId, { review: at(off) })
    const before = await streaks(db, NOW)
    expect(before.longest).toBe(5)
    expect(before.current).toBe(5)
    await db.update(subject).set({ archived: true }).where(eq(subject.id, subjectId))
    const after = await streaks(db, NOW)
    expect(after.longest).toBe(5)
    expect(after.current).toBe(5)
  })

  it('manual_rating_zero_not_a_study_day', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0), rating: 0 })
    const r = await streaks(db, NOW)
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
    const r = await heatmap(db, { now: NOW, from: key(0), to: key(2) })
    expect(find(r, key(0))?.count).toBe(2)
    expect(find(r, key(1))?.count).toBe(1)
  })

  it('dense_days_zero_filled', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0) })
    await seedReviewLog(db, cardId, { review: at(3) })
    const r = await heatmap(db, { now: NOW, from: key(0), to: key(9) })
    expect(r.days.length).toBe(10)
    expect(r.days.filter((d) => d.count === 0).length).toBe(8)
  })

  it('year_boundary', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: new Date(2025, 11, 31, 12) })
    await seedReviewLog(db, cardId, { review: new Date(2026, 0, 1, 12) })
    const r = await heatmap(db, { now: NOW, from: '2025-12-30', to: '2026-01-02' })
    expect(find(r, '2025-12-31')?.count).toBe(1)
    expect(find(r, '2026-01-01')?.count).toBe(1)
  })

  it('heatmap_local_not_utc', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 12, 23, 0) })
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 13, 0, 30) })
    const r = await heatmap(db, { now: NOW, from: '2026-07-12', to: '2026-07-13' })
    expect(find(r, '2026-07-12')?.count).toBe(1)
    expect(find(r, '2026-07-13')?.count).toBe(1)
  })

  it('default_trailing_365_when_no_window', async () => {
    const r = await heatmap(db, { now: NOW })
    expect(r.days.length).toBe(365)
    expect(r.to).toBe(key(0))
    expect(r.from).toBe(key(-364))
  })

  it('reviews_outside_window_excluded', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(-1) }) // before from
    await seedReviewLog(db, cardId, { review: at(0) })
    await seedReviewLog(db, cardId, { review: at(3) }) // after to
    const r = await heatmap(db, { now: NOW, from: key(0), to: key(2) })
    expect(r.total).toBe(1)
  })

  it('activeDays_and_max', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0, 8) })
    await seedReviewLog(db, cardId, { review: at(0, 9) })
    await seedReviewLog(db, cardId, { review: at(0, 10) })
    await seedReviewLog(db, cardId, { review: at(2) })
    const r = await heatmap(db, { now: NOW, from: key(0), to: key(4) })
    expect(r.activeDays).toBe(2)
    expect(r.max).toBe(3)
  })

  it('heatmap_excludes_manual_rating', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0), rating: 3 })
    await seedReviewLog(db, cardId, { review: at(0), rating: 1 })
    await seedReviewLog(db, cardId, { review: at(0), rating: 0 }) // Manual, excluded
    const r = await heatmap(db, { now: NOW, from: key(0), to: key(1) })
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
      await studyTime(db, { now: NOW, granularity: 'day', from: key(0), to: key(0) }),
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
      await studyTime(db, { now: NOW, granularity: 'day', from: key(0), to: key(0) }),
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
      await studyTime(db, { now: NOW, granularity: 'day', from: key(0), to: key(0) }),
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
      await studyTime(db, { now: NOW, granularity: 'day', from: key(0), to: key(0) }),
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
    const r = await studyTime(db, {
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
    const r = await studyTime(db, { now: NOW, granularity: 'day', from: key(0), to: key(2) })
    expect(r.buckets.length).toBe(3)
    for (const b of r.buckets) {
      expect(b.durationMs).toBe(0)
      expect(b.avgMs).toBeNull()
      expect(b.daysInBucket).toBe(1)
    }
  })

  it('partial_edge_week_days_in_bucket', async () => {
    // from = Wednesday 2026-07-15 → first bucket (Mon 2026-07-13) has Wed..Sun = 5 days.
    const r = await studyTime(db, {
      now: NOW,
      granularity: 'week',
      from: '2026-07-15',
      to: '2026-07-31',
    })
    expect(bucket(r, '2026-07-13')?.daysInBucket).toBe(5)
    expect(bucket(r, '2026-07-20')?.daysInBucket).toBe(7) // full central week
    // In day granularity, all buckets are 1 day.
    const rDay = await studyTime(db, {
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
    expect(findSub(await retention(db, {}), subjectId)?.maturedReviewed).toBe(3)
  })

  it('rating_ge_2_is_recall', async () => {
    const { subjectId, cardId } = await chain(db)
    await seedReviewLog(db, cardId, { state: 2, rating: 2 }) // Hard → recall
    await seedReviewLog(db, cardId, { state: 2, rating: 1 }) // Again → miss
    const s = findSub(await retention(db, {}), subjectId)
    expect(s?.maturedReviewed).toBe(2)
    expect(s?.recalled).toBe(1)
    // postgres-js serializes SUM(bigint) as a string; the service casts to Number.
    expect(typeof s?.recalled).toBe('number')
  })

  it('retention_null_below_min_sample', async () => {
    const { subjectId, cardId } = await chain(db)
    for (let i = 0; i < 3; i++) await seedReviewLog(db, cardId, { state: 2, rating: 4 })
    const s = findSub(await retention(db, {}), subjectId)
    expect(s?.maturedReviewed).toBe(3)
    expect(s?.recalled).toBe(3)
    expect(s?.retention).toBeNull()
  })

  it('retention_computed_above_min_sample', async () => {
    const { subjectId, cardId } = await chain(db)
    for (let i = 0; i < 9; i++) await seedReviewLog(db, cardId, { state: 2, rating: 3 })
    await seedReviewLog(db, cardId, { state: 2, rating: 1 }) // one miss → 9/10
    expect(findSub(await retention(db, {}), subjectId)?.retention).toBeCloseTo(0.9, 10)
  })

  it('retention_per_subject_split', async () => {
    const a = await chain(db)
    const b = await chain(db)
    for (let i = 0; i < 10; i++) await seedReviewLog(db, a.cardId, { state: 2, rating: 3 }) // 10/10
    for (let i = 0; i < 10; i++)
      await seedReviewLog(db, b.cardId, { state: 2, rating: i < 5 ? 3 : 1 }) // 5/10
    const r = await retention(db, {})
    expect(findSub(r, a.subjectId)?.retention).toBeCloseTo(1, 10)
    expect(findSub(r, b.subjectId)?.retention).toBeCloseTo(0.5, 10)
  })

  it('archived_subject_excluded', async () => {
    const arch = await chain(db, { archived: true })
    await seedReviewLog(db, arch.cardId, { state: 2, rating: 3 })
    expect(findSub(await retention(db, {}), arch.subjectId)).toBeUndefined()
  })

  it('zero_review_subject_present_null', async () => {
    const { subjectId } = await chain(db)
    const s = findSub(await retention(db, {}), subjectId)
    expect(s?.maturedReviewed).toBe(0)
    expect(s?.retention).toBeNull()
  })

  it('retention_window_filters', async () => {
    const { subjectId, cardId } = await chain(db)
    for (const off of [0, 1, 2])
      await seedReviewLog(db, cardId, { state: 2, rating: 3, review: at(off) })
    await seedReviewLog(db, cardId, { state: 2, rating: 3, review: at(-5) }) // out of window
    const s = findSub(await retention(db, { from: key(0), to: key(2) }), subjectId)
    expect(s?.maturedReviewed).toBe(3)
  })

  it('manual_rating_zero_excluded_from_denominator', async () => {
    const { subjectId, cardId } = await chain(db)
    for (let i = 0; i < 10; i++) await seedReviewLog(db, cardId, { state: 2, rating: 3 })
    await seedReviewLog(db, cardId, { state: 2, rating: 0 }) // Manual — must not inflate denominator
    const s = findSub(await retention(db, {}), subjectId)
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
    const d = findDeck(await deckSuccess(db, {}), deckId)
    expect(d?.reviewed).toBe(10)
    expect(d?.passed).toBe(6)
    expect(typeof d?.passed).toBe('number') // postgres-js bigint → Number cast
    expect(d?.successRate).toBeCloseTo(0.6, 10)
  })

  it('success_null_below_min_sample', async () => {
    const { deckId, cardId } = await chain(db)
    for (let i = 0; i < 5; i++) await seedReviewLog(db, cardId, { state: 2, rating: 3 })
    const d = findDeck(await deckSuccess(db, {}), deckId)
    expect(d?.reviewed).toBe(5)
    expect(d?.passed).toBe(5)
    expect(d?.successRate).toBeNull()
  })

  it('zero_review_deck_present_null', async () => {
    const { deckId } = await chain(db)
    const d = findDeck(await deckSuccess(db, {}), deckId)
    expect(d?.reviewed).toBe(0)
    expect(d?.successRate).toBeNull()
  })

  it('archived_subject_decks_excluded', async () => {
    const arch = await chain(db, { archived: true })
    await seedReviewLog(db, arch.cardId, { state: 2, rating: 3 })
    expect(findDeck(await deckSuccess(db, {}), arch.deckId)).toBeUndefined()
  })

  it('deck_success_window_filters', async () => {
    const { deckId, cardId } = await chain(db)
    for (const off of [0, 1]) await seedReviewLog(db, cardId, { rating: 3, review: at(off) })
    await seedReviewLog(db, cardId, { rating: 3, review: at(-5) }) // out of window
    expect(findDeck(await deckSuccess(db, { from: key(0), to: key(2) }), deckId)?.reviewed).toBe(2)
  })

  it('manual_rating_zero_excluded_from_denominator', async () => {
    const { deckId, cardId } = await chain(db)
    for (let i = 0; i < 10; i++) await seedReviewLog(db, cardId, { rating: 3 })
    await seedReviewLog(db, cardId, { rating: 0 }) // Manual
    expect(findDeck(await deckSuccess(db, {}), deckId)?.reviewed).toBe(10)
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
      await reviewVolume(db, { now: NOW, granularity: 'day', from: key(0), to: key(0) }),
      key(0),
    )
    expect(b).toMatchObject({ again: 1, hard: 2, good: 1, easy: 1, total: 5 })
  })

  it('stacked_total_equals_sum', async () => {
    const { cardId } = await chain(db)
    for (const rt of [1, 2, 3, 4, 3, 3])
      await seedReviewLog(db, cardId, { review: at(0), rating: rt })
    const r = await reviewVolume(db, { now: NOW, granularity: 'day', from: key(0), to: key(2) })
    for (const b of r.buckets) expect(b.total).toBe(b.again + b.hard + b.good + b.easy)
    expect(r.totals.total).toBe(r.totals.again + r.totals.hard + r.totals.good + r.totals.easy)
  })

  it('manual_rating_zero_excluded', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: at(0), rating: 3 })
    await seedReviewLog(db, cardId, { review: at(0), rating: 0 }) // Manual
    const r = await reviewVolume(db, { now: NOW, granularity: 'day', from: key(0), to: key(0) })
    expect(r.totals.total).toBe(1)
    expect(r.totals.good).toBe(1)
  })

  it('review_volume_weekly', async () => {
    const { cardId } = await chain(db)
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 13, 12), rating: 3 }) // Mon
    await seedReviewLog(db, cardId, { review: new Date(2026, 6, 19, 12), rating: 4 }) // Sun same week
    const r = await reviewVolume(db, {
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
    const r = await reviewVolume(db, { now: NOW, granularity: 'day', from: key(0), to: key(3) })
    expect(r.buckets.length).toBe(4)
    expect(r.buckets.every((b) => b.total === 0)).toBe(true)
  })

  it('review_volume_partial_edge_week_days_in_bucket', async () => {
    const r = await reviewVolume(db, {
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
    await expect(heatmap(db, { now: NOW, from: key(2), to: key(0) })).rejects.toThrow(
      ValidationError,
    )
    await expect(retention(db, { from: key(2), to: key(0) })).rejects.toThrow(ValidationError)
  })

  it('window_too_large_400', async () => {
    await expect(heatmap(db, { now: NOW, from: '2026-01-01', to: '2027-12-31' })).rejects.toThrow(
      ValidationError,
    )
    await expect(retention(db, { from: '2026-01-01', to: '2027-12-31' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('only_from_without_to_400', async () => {
    await expect(heatmap(db, { now: NOW, from: key(0) })).rejects.toThrow(ValidationError)
    await expect(heatmap(db, { now: NOW, to: key(0) })).rejects.toThrow(ValidationError)
    await expect(retention(db, { from: key(0) })).rejects.toThrow(ValidationError)
    await expect(retention(db, { to: key(0) })).rejects.toThrow(ValidationError)
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
    const h = await heatmap(db, win)
    const st = await studyTime(db, { ...win, granularity: 'day' })
    const rv = await reviewVolume(db, { ...win, granularity: 'day' })

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
    expect(await countQueries(() => heatmap(db, win))).toBe(1)
    expect(await countQueries(() => streaks(db, NOW))).toBe(1)
    expect(await countQueries(() => studyTime(db, { ...win, granularity: 'week' }))).toBe(1)
    expect(await countQueries(() => reviewVolume(db, { ...win, granularity: 'day' }))).toBe(1)
    expect(await countQueries(() => retention(db, {}))).toBe(1)
    expect(await countQueries(() => deckSuccess(db, {}))).toBe(1)
  })
})
