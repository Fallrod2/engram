import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { State } from 'ts-fsrs'
import { STUDY_NEW_CARDS_PER_DAY_DEFAULT } from '@engram/shared'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { reviewLog } from '../db/schema'
import { seedCard, seedDeck, seedReviewLog, seedSubject } from '../test-support/harness'
import { localMidnight } from '../lib/day'
import { updateStudySettings } from './study-settings.service'
import { dueCounts, dueQueue } from './review-queue.service'

const OTHER = '00000000-0000-4000-8000-0000000000ff'

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

// Dynamique : queue_new_cards_are_due sème une carte dont le due par défaut
// est l'heure réelle de création — une date figée devient fausse avec le temps.
const NOW = new Date()
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const ahead = (ms: number) => new Date(NOW.getTime() + ms)
const HOUR = 3_600_000

describe('dueQueue', () => {
  it('queue_only_due_cards', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id, { due: ago(HOUR) })
    await seedCard(db, d.id, { due: NOW })
    await seedCard(db, d.id, { due: ahead(HOUR) })
    const { total, cards } = await dueQueue(db, U, { limit: 50, now: NOW })
    expect(total).toBe(2)
    expect(cards).toHaveLength(2)
  })

  it('queue_excludes_archived_subject', async () => {
    const active = await seedDeck(db, (await seedSubject(db)).id)
    const archived = await seedDeck(db, (await seedSubject(db, { archived: true })).id)
    await seedCard(db, active.id, { due: ago(HOUR) })
    await seedCard(db, archived.id, { due: ago(HOUR) })
    const { total } = await dueQueue(db, U, { limit: 50, now: NOW })
    expect(total).toBe(1)
  })

  it('queue_filter_by_deck', async () => {
    const s = await seedSubject(db)
    const d1 = await seedDeck(db, s.id)
    const d2 = await seedDeck(db, s.id)
    await seedCard(db, d1.id, { due: ago(HOUR) })
    await seedCard(db, d2.id, { due: ago(HOUR) })
    expect((await dueQueue(db, U, { limit: 50, now: NOW, deckId: d1.id })).total).toBe(1)
  })

  it('queue_filter_by_subject', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    await seedCard(db, (await seedDeck(db, s1.id)).id, { due: ago(HOUR) })
    await seedCard(db, (await seedDeck(db, s2.id)).id, { due: ago(HOUR) })
    expect((await dueQueue(db, U, { limit: 50, now: NOW, subjectId: s1.id })).total).toBe(1)
  })

  it('queue_order_due_asc', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: ago(HOUR), front: 'b' })
    await seedCard(db, d.id, { due: ago(3 * HOUR), front: 'a' })
    await seedCard(db, d.id, { due: ago(2 * HOUR), front: 'c' })
    const fronts = (await dueQueue(db, U, { limit: 50, now: NOW })).cards.map((c) => c.front)
    expect(fronts).toEqual(['a', 'c', 'b'])
  })

  it('queue_limit_and_total', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    for (let i = 0; i < 5; i++) await seedCard(db, d.id, { due: ago((i + 1) * HOUR) })
    const { total, cards } = await dueQueue(db, U, { limit: 2, now: NOW })
    expect(total).toBe(5)
    expect(cards).toHaveLength(2)
  })

  it('queue_new_cards_are_due', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id) // default due = real creation instant (New card)
    // Query just after the real creation time (the default due uses `new Date()`,
    // not the fixed NOW), so the assertion never depends on the wall clock.
    const { total } = await dueQueue(db, U, { limit: 50, now: new Date(Date.now() + 60_000) })
    expect(total).toBe(1)
  })

  it('queue_empty_deck', async () => {
    await seedDeck(db, (await seedSubject(db)).id)
    expect(await dueQueue(db, U, { limit: 50, now: NOW })).toEqual({
      total: 0,
      cards: [],
      newCards: {
        limit: STUDY_NEW_CARDS_PER_DAY_DEFAULT,
        introduced: 0,
        remaining: 20,
        withheld: 0,
      },
    })
  })
})

/**
 * The daily new-card budget. Two properties are load-bearing and are asserted
 * separately because confusing them would be the grave defect:
 *
 *   1. a NEVER-SEEN card (`State.New`) is metered — beyond the budget the queue
 *      stops introducing, and says how many it held back;
 *   2. a DUE card is NEVER metered, whatever the limit, including 0. A due card
 *      that goes unreviewed does not wait: it piles up and its schedule rots.
 */
describe('dueQueue new-card budget', () => {
  /** Seed `n` never-seen cards, all due, in one deck. */
  async function seedNew(n: number, deckId: string) {
    for (let i = 0; i < n; i++) await seedCard(db, deckId, { due: ago((i + 1) * HOUR) })
  }
  /** Seed `n` already-seen due cards (state Review — reps > 0 in real life). */
  async function seedSeen(n: number, deckId: string) {
    for (let i = 0; i < n; i++) {
      await seedCard(db, deckId, { due: ago((i + 1) * HOUR), state: State.Review, reps: 3 })
    }
  }
  async function aDeck() {
    return (await seedDeck(db, (await seedSubject(db)).id)).id
  }
  /** Mark `n` distinct cards as introduced today (a log whose PREVIOUS state was New). */
  async function introduceToday(n: number, deckId: string) {
    for (let i = 0; i < n; i++) {
      const c = await seedCard(db, deckId, { due: ahead(365 * 24 * HOUR), state: State.Review })
      await seedReviewLog(db, c.id, { state: State.New, review: NOW })
    }
  }

  it('budget_default_caps_the_new_cards_and_reports_the_withheld', async () => {
    const d = await aDeck()
    await seedNew(25, d)
    const res = await dueQueue(db, U, { limit: 500, now: NOW })
    expect(res.cards).toHaveLength(STUDY_NEW_CARDS_PER_DAY_DEFAULT)
    // `total` is the queue AS OFFERED, not the raw `due <= now` match: the
    // session progress bar must not promise 25 cards and deliver 20.
    expect(res.total).toBe(20)
    expect(res.newCards).toEqual({ limit: 20, introduced: 0, remaining: 20, withheld: 5 })
  })

  it('budget_exactly_reached_introduces_nothing_more', async () => {
    const d = await aDeck()
    await updateStudySettings(db, U, { newCardsPerDay: 3 }, NOW)
    await introduceToday(3, d) // exactly the limit, not one over
    await seedNew(4, d)
    const res = await dueQueue(db, U, { limit: 50, now: NOW })
    expect(res.cards).toHaveLength(0)
    expect(res.total).toBe(0)
    expect(res.newCards).toEqual({ limit: 3, introduced: 3, remaining: 0, withheld: 4 })

    // One below the limit → exactly one card comes through.
    await updateStudySettings(db, U, { newCardsPerDay: 4 }, NOW)
    const res2 = await dueQueue(db, U, { limit: 50, now: NOW })
    expect(res2.cards).toHaveLength(1)
    expect(res2.newCards).toEqual({ limit: 4, introduced: 3, remaining: 1, withheld: 3 })
  })

  it('budget_zero_pauses_new_cards_entirely', async () => {
    const d = await aDeck()
    await updateStudySettings(db, U, { newCardsPerDay: 0 }, NOW)
    await seedNew(5, d)
    const res = await dueQueue(db, U, { limit: 50, now: NOW })
    expect(res.cards).toEqual([])
    expect(res.total).toBe(0)
    expect(res.newCards).toEqual({ limit: 0, introduced: 0, remaining: 0, withheld: 5 })
  })

  it('budget_never_withholds_a_due_card_whatever_the_limit', async () => {
    // THE regression guard. Limit 0, plus a card the user already met and that
    // FSRS scheduled for today: it must be handed out, every time.
    const d = await aDeck()
    await updateStudySettings(db, U, { newCardsPerDay: 0 }, NOW)
    await seedSeen(6, d)
    await seedNew(4, d)
    const res = await dueQueue(db, U, { limit: 50, now: NOW })
    expect(res.cards).toHaveLength(6)
    expect(res.total).toBe(6)
    expect(res.cards.every((c) => c.fsrs.state !== State.New)).toBe(true)
    expect(res.newCards.withheld).toBe(4)

    // Same with an overdue backlog far larger than any plausible limit.
    await seedSeen(40, d)
    const res2 = await dueQueue(db, U, { limit: 500, now: NOW })
    expect(res2.total).toBe(46)
    expect(res2.cards).toHaveLength(46)
  })

  it('budget_undoing_an_introduction_gives_the_slot_back', async () => {
    const d = await aDeck()
    await updateStudySettings(db, U, { newCardsPerDay: 1 }, NOW)
    const spent = await seedCard(db, d, { due: ahead(365 * 24 * HOUR), state: State.Review })
    const log = await seedReviewLog(db, spent.id, { state: State.New, review: NOW })
    await seedNew(2, d)

    expect((await dueQueue(db, U, { limit: 50, now: NOW })).newCards).toEqual({
      limit: 1,
      introduced: 1,
      remaining: 0,
      withheld: 2,
    })

    // `undoReview` hard-deletes the compensated log row. Nothing else runs, and
    // the budget is restored — that is exactly why the counter reads review_log.
    await db.delete(reviewLog).where(eq(reviewLog.id, log.id))
    const after = await dueQueue(db, U, { limit: 50, now: NOW })
    expect(after.newCards).toEqual({ limit: 1, introduced: 0, remaining: 1, withheld: 1 })
    expect(after.cards).toHaveLength(1)
  })

  it('budget_ignores_introductions_made_before_local_midnight', async () => {
    const d = await aDeck()
    const midnight = localMidnight(NOW.getFullYear(), NOW.getMonth(), NOW.getDate())
    await updateStudySettings(db, U, { newCardsPerDay: 2 }, NOW)
    const old = await seedCard(db, d, { due: ahead(365 * 24 * HOUR), state: State.Review })
    // 1 ms before today's local midnight → yesterday's budget, not today's.
    await seedReviewLog(db, old.id, { state: State.New, review: new Date(midnight.getTime() - 1) })
    await seedNew(5, d)
    const res = await dueQueue(db, U, { limit: 50, now: NOW })
    expect(res.newCards.introduced).toBe(0)
    expect(res.cards).toHaveLength(2)
  })

  it('budget_is_global_not_per_deck', async () => {
    // Filtering by deck must not hand out a fresh allowance: the point is the
    // total load the next days carry, and that total ignores deck boundaries.
    const s = await seedSubject(db)
    const d1 = (await seedDeck(db, s.id)).id
    const d2 = (await seedDeck(db, s.id)).id
    await updateStudySettings(db, U, { newCardsPerDay: 2 }, NOW)
    await seedNew(3, d1)
    await seedNew(3, d2)
    expect((await dueQueue(db, U, { limit: 50, now: NOW, deckId: d1 })).cards).toHaveLength(2)
    expect((await dueQueue(db, U, { limit: 50, now: NOW, deckId: d2 })).cards).toHaveLength(2)
    expect((await dueQueue(db, U, { limit: 50, now: NOW })).cards).toHaveLength(2)
  })

  it('budget_reads_the_callers_own_settings', async () => {
    const d = await aDeck()
    await updateStudySettings(db, OTHER, { newCardsPerDay: 0 }, NOW)
    await seedNew(3, d)
    // U never chose → defaults, unaffected by the other account's zero.
    expect((await dueQueue(db, U, { limit: 50, now: NOW })).cards).toHaveLength(3)
  })

  it('budget_keeps_the_global_due_order_across_the_two_populations', async () => {
    const d = await aDeck()
    await updateStudySettings(db, U, { newCardsPerDay: 10 }, NOW)
    await seedCard(db, d, { due: ago(2 * HOUR), front: 'new-old' })
    await seedCard(db, d, { due: ago(3 * HOUR), front: 'seen-oldest', state: State.Review })
    await seedCard(db, d, { due: ago(HOUR), front: 'seen-recent', state: State.Review })
    const fronts = (await dueQueue(db, U, { limit: 50, now: NOW })).cards.map((c) => c.front)
    // Merged back into ONE order (due ASC), not "all due cards, then all new".
    expect(fronts).toEqual(['seen-oldest', 'new-old', 'seen-recent'])
  })

  it('budget_does_not_hide_new_cards_behind_the_page_limit_accounting', async () => {
    const d = await aDeck()
    await seedNew(5, d)
    const res = await dueQueue(db, U, { limit: 2, now: NOW })
    // `limit` pages the response; the budget is untouched by it, so the unpaged
    // `total` still announces the 5 cards the day allows.
    expect(res.cards).toHaveLength(2)
    expect(res.total).toBe(5)
    expect(res.newCards.withheld).toBe(0)
  })

  it('budget_ignores_the_daily_goal_entirely', async () => {
    // The goal is indicative. Changing it must not move a single card.
    const d = await aDeck()
    await seedNew(4, d)
    await seedSeen(2, d)
    await updateStudySettings(db, U, { dailyGoal: 1 }, NOW)
    const low = await dueQueue(db, U, { limit: 50, now: NOW })
    await updateStudySettings(db, U, { dailyGoal: 999 }, NOW)
    const high = await dueQueue(db, U, { limit: 50, now: NOW })
    expect(low.total).toBe(6)
    expect(high).toEqual(low)
  })
})

describe('dueCounts', () => {
  it('counts_by_subject_excludes_archived_includes_zero', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db) // no due cards → 0
    const archived = await seedSubject(db, { archived: true })
    await seedCard(db, (await seedDeck(db, s1.id)).id, { due: ago(HOUR) })
    await seedCard(db, (await seedDeck(db, archived.id)).id, { due: ago(HOUR) })

    const res = await dueCounts(db, U, NOW)
    const ids = res.bySubject.map((b) => b.subjectId)
    expect(ids).toContain(s1.id)
    expect(ids).toContain(s2.id)
    expect(ids).not.toContain(archived.id)
    expect(res.bySubject.find((b) => b.subjectId === s1.id)!.dueCount).toBe(1)
    expect(res.bySubject.find((b) => b.subjectId === s2.id)!.dueCount).toBe(0)
    expect(res.total).toBe(1)
  })

  it('counts_by_deck', async () => {
    const s = await seedSubject(db)
    const d1 = await seedDeck(db, s.id)
    const d2 = await seedDeck(db, s.id)
    await seedCard(db, d1.id, { due: ago(HOUR) })
    await seedCard(db, d1.id, { due: ago(HOUR) })
    await seedCard(db, d2.id, { due: ago(HOUR) })
    const res = await dueCounts(db, U, NOW)
    const deckSum = res.byDeck
      .filter((b) => b.subjectId === s.id)
      .reduce((acc, b) => acc + b.dueCount, 0)
    expect(deckSum).toBe(res.bySubject.find((b) => b.subjectId === s.id)!.dueCount)
    expect(deckSum).toBe(3)
  })

  it('counts_deck_with_no_due_cards_present_zero', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id, { due: ahead(HOUR) }) // not due
    const res = await dueCounts(db, U, NOW)
    expect(res.byDeck.find((b) => b.deckId === d.id)!.dueCount).toBe(0)
  })

  it('counts_subject_with_no_deck_present', async () => {
    const s = await seedSubject(db) // no deck at all
    const res = await dueCounts(db, U, NOW)
    expect(res.bySubject.find((b) => b.subjectId === s.id)).toEqual({
      subjectId: s.id,
      dueCount: 0,
      overdueCount: 0,
      todayCount: 0,
    })
  })
})

/**
 * T-013 — the backlog/today split. The cut is local midnight of `now`'s calendar
 * day (`lib/day.ts` convention, the same one `study_plan` uses), and it is a
 * PARTITION: every card the old single number counted lands in exactly one side.
 */
describe('dueCounts backlog/today split', () => {
  // A fixed instant at midday of today's LOCAL calendar day: far enough from
  // both midnights that a DST shift cannot move it to another day, and never
  // dependent on the wall clock at which the suite happens to run.
  const TODAY_MIDNIGHT = localMidnight(NOW.getFullYear(), NOW.getMonth(), NOW.getDate())
  const NOON = new Date(TODAY_MIDNIGHT.getTime() + 12 * HOUR)

  /** Every level (total, per subject, per deck) must satisfy due = overdue + today. */
  function expectPartition(res: Awaited<ReturnType<typeof dueCounts>>): void {
    expect(res.total).toBe(res.overdueCount + res.todayCount)
    for (const b of res.bySubject) expect(b.dueCount).toBe(b.overdueCount + b.todayCount)
    for (const b of res.byDeck) expect(b.dueCount).toBe(b.overdueCount + b.todayCount)
    expect(res.bySubject.reduce((n, b) => n + b.dueCount, 0)).toBe(res.total)
    expect(res.bySubject.reduce((n, b) => n + b.overdueCount, 0)).toBe(res.overdueCount)
    expect(res.bySubject.reduce((n, b) => n + b.todayCount, 0)).toBe(res.todayCount)
  }

  it('split_backlog_vs_today_sums_to_the_unchanged_total', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id, { due: new Date(TODAY_MIDNIGHT.getTime() - 3 * 24 * HOUR) })
    await seedCard(db, d.id, { due: new Date(TODAY_MIDNIGHT.getTime() - HOUR) })
    await seedCard(db, d.id, { due: new Date(TODAY_MIDNIGHT.getTime() + HOUR) })
    await seedCard(db, d.id, { due: new Date(NOON.getTime() - 60_000) })
    await seedCard(db, d.id, { due: new Date(NOON.getTime() + HOUR) }) // later today, NOT due yet

    const res = await dueCounts(db, U, NOON)
    expect(res.total).toBe(4)
    expect(res.overdueCount).toBe(2)
    expect(res.todayCount).toBe(2)
    expectPartition(res)

    const bucket = res.bySubject.find((b) => b.subjectId === s.id)!
    expect(bucket).toEqual({ subjectId: s.id, dueCount: 4, overdueCount: 2, todayCount: 2 })
    expect(res.byDeck.find((b) => b.deckId === d.id)).toEqual({
      deckId: d.id,
      subjectId: s.id,
      dueCount: 4,
      overdueCount: 2,
      todayCount: 2,
    })
  })

  it('split_local_midnight_is_the_boundary', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    // 1ms before local midnight → backlog; local midnight exactly → today.
    await seedCard(db, d.id, { due: new Date(TODAY_MIDNIGHT.getTime() - 1) })
    await seedCard(db, d.id, { due: TODAY_MIDNIGHT })

    const res = await dueCounts(db, U, NOON)
    expect(res.overdueCount).toBe(1)
    expect(res.todayCount).toBe(1)
    expectPartition(res)
  })

  it('split_uses_the_local_day_not_the_utc_day', async () => {
    // A card due at 23:30 UTC yesterday and a `now` at 00:30 UTC today land on
    // DIFFERENT UTC days but on the SAME local day whenever the server runs east
    // of Greenwich — and vice-versa. Anchoring on the local midnight of `now`
    // keeps the answer stable: an instant strictly inside today's local day is
    // never backlog, whatever its UTC date.
    const d = await seedDeck(db, (await seedSubject(db)).id)
    const justAfterMidnight = new Date(TODAY_MIDNIGHT.getTime() + 60_000)
    const justBeforeMidnight = new Date(TODAY_MIDNIGHT.getTime() - 60_000)
    await seedCard(db, d.id, { due: justAfterMidnight })
    await seedCard(db, d.id, { due: justBeforeMidnight })

    const res = await dueCounts(db, U, new Date(TODAY_MIDNIGHT.getTime() + 2 * HOUR))
    expect(res.todayCount).toBe(1)
    expect(res.overdueCount).toBe(1)
    expectPartition(res)
  })

  it('split_is_all_zero_when_nothing_is_due', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id, { due: new Date(NOON.getTime() + 24 * HOUR) })

    const res = await dueCounts(db, U, NOON)
    expect(res.total).toBe(0)
    expect(res.overdueCount).toBe(0)
    expect(res.todayCount).toBe(0)
    expect(res.bySubject.find((b) => b.subjectId === s.id)).toEqual({
      subjectId: s.id,
      dueCount: 0,
      overdueCount: 0,
      todayCount: 0,
    })
    expectPartition(res)
  })

  it('split_reports_pure_backlog_with_a_zero_today', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    for (let i = 1; i <= 3; i++) {
      await seedCard(db, d.id, { due: new Date(TODAY_MIDNIGHT.getTime() - i * 24 * HOUR) })
    }
    const res = await dueCounts(db, U, NOON)
    expect(res.total).toBe(3)
    expect(res.overdueCount).toBe(3)
    expect(res.todayCount).toBe(0)
    expectPartition(res)
  })

  it('split_excludes_archived_subjects_like_the_total_does', async () => {
    const archived = await seedSubject(db, { archived: true })
    await seedCard(db, (await seedDeck(db, archived.id)).id, {
      due: new Date(TODAY_MIDNIGHT.getTime() - HOUR),
    })
    const res = await dueCounts(db, U, NOON)
    expect(res.total).toBe(0)
    expect(res.overdueCount).toBe(0)
    expectPartition(res)
  })
})
