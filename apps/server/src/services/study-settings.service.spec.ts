import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { State } from 'ts-fsrs'
import {
  STUDY_DAILY_GOAL_DEFAULT,
  STUDY_NEW_CARDS_PER_DAY_DEFAULT,
  studySettingsResponseSchema,
} from '@engram/shared'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { appSettings, reviewLog } from '../db/schema'
import { seedCard, seedDeck, seedReviewLog, seedSubject } from '../test-support/harness'
import { localDayBounds, localMidnight } from '../lib/day'
import {
  STUDY_KEY,
  coerceStudySettings,
  countNewCardsIntroduced,
  countReviewsDone,
  getStudySettings,
  newCardBudget,
  readStudySettings,
  updateStudySettings,
} from './study-settings.service'

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

const OTHER = '00000000-0000-4000-8000-0000000000ff'

// A fixed instant at midday of today's LOCAL day: far from both midnights, so a
// DST shift can never move it to another day, and never dependent on the wall
// clock at which the suite happens to run (same trick as the queue specs).
const TODAY = new Date()
const MIDNIGHT = localMidnight(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate())
const NOON = new Date(MIDNIGHT.getTime() + 12 * 3_600_000)

async function aCard() {
  const s = await seedSubject(db)
  const d = await seedDeck(db, s.id)
  return seedCard(db, d.id)
}

describe('study settings storage', () => {
  it('settings_default_when_the_account_never_chose', async () => {
    // No app_settings row at all — the case of every account that predates the
    // feature. The defaults must apply, NOT "no limit".
    expect(await readStudySettings(db, U)).toEqual({
      newCardsPerDay: STUDY_NEW_CARDS_PER_DAY_DEFAULT,
      dailyGoal: STUDY_DAILY_GOAL_DEFAULT,
    })
    expect(STUDY_NEW_CARDS_PER_DAY_DEFAULT).toBe(20)
  })

  it('settings_roundtrip_through_app_settings', async () => {
    await updateStudySettings(db, U, { newCardsPerDay: 7, dailyGoal: 45 }, NOON)
    expect(await readStudySettings(db, U)).toEqual({ newCardsPerDay: 7, dailyGoal: 45 })

    const [row] = await db.select().from(appSettings)
    expect(row!.key).toBe(STUDY_KEY)
    expect(row!.userId).toBe(U)
  })

  it('settings_patch_is_a_deep_merge_not_a_replace', async () => {
    await updateStudySettings(db, U, { newCardsPerDay: 7, dailyGoal: 45 }, NOON)
    await updateStudySettings(db, U, { dailyGoal: 12 }, NOON)
    expect(await readStudySettings(db, U)).toEqual({ newCardsPerDay: 7, dailyGoal: 12 })
    // An empty patch is a legal no-op.
    await updateStudySettings(db, U, {}, NOON)
    expect(await readStudySettings(db, U)).toEqual({ newCardsPerDay: 7, dailyGoal: 12 })
  })

  it('settings_are_scoped_per_user', async () => {
    await updateStudySettings(db, U, { newCardsPerDay: 0 }, NOON)
    // The other account never chose → untouched defaults, never U's zero.
    expect(await readStudySettings(db, OTHER)).toEqual({
      newCardsPerDay: STUDY_NEW_CARDS_PER_DAY_DEFAULT,
      dailyGoal: STUDY_DAILY_GOAL_DEFAULT,
    })
  })

  it('settings_a_corrupt_stored_blob_never_breaks_the_read', async () => {
    // Field by field: a bad value falls back to ITS OWN default and leaves the
    // other one alone. The queue reads this on every fetch — it must not throw.
    expect(coerceStudySettings(null)).toEqual({
      newCardsPerDay: STUDY_NEW_CARDS_PER_DAY_DEFAULT,
      dailyGoal: STUDY_DAILY_GOAL_DEFAULT,
    })
    expect(coerceStudySettings('nonsense').newCardsPerDay).toBe(STUDY_NEW_CARDS_PER_DAY_DEFAULT)
    expect(coerceStudySettings({ newCardsPerDay: -3, dailyGoal: 40 })).toEqual({
      newCardsPerDay: STUDY_NEW_CARDS_PER_DAY_DEFAULT,
      dailyGoal: 40,
    })
    expect(coerceStudySettings({ newCardsPerDay: 5.5 }).newCardsPerDay).toBe(
      STUDY_NEW_CARDS_PER_DAY_DEFAULT,
    )
    expect(coerceStudySettings({ newCardsPerDay: 0 }).newCardsPerDay).toBe(0)

    // …and the same through the database.
    await db.insert(appSettings).values({ userId: U, key: STUDY_KEY, value: { dailyGoal: 'x' } })
    expect(await readStudySettings(db, U)).toEqual({
      newCardsPerDay: STUDY_NEW_CARDS_PER_DAY_DEFAULT,
      dailyGoal: STUDY_DAILY_GOAL_DEFAULT,
    })
  })
})

/**
 * The counting contract. "Introduced" = a `review_log` row whose `state` (the
 * state BEFORE the review) is `New`, with its `review` instant inside today's
 * LOCAL day — counted per distinct card.
 */
describe('countNewCardsIntroduced', () => {
  it('new_count_only_counts_logs_whose_previous_state_was_new', async () => {
    const c = await aCard()
    await seedReviewLog(db, c.id, { state: State.New, review: NOON })
    await seedReviewLog(db, c.id, { state: State.Learning, review: NOON })
    await seedReviewLog(db, c.id, { state: State.Review, review: NOON })
    await seedReviewLog(db, c.id, { state: State.Relearning, review: NOON })
    // Four reviews today, ONE introduction: seeing a card again the same day
    // (Again → learning step, or a lapse) must never burn a second slot.
    expect(await countNewCardsIntroduced(db, U, NOON)).toBe(1)
    expect(await countReviewsDone(db, U, NOON)).toBe(4)
  })

  it('new_count_is_per_distinct_card', async () => {
    const a = await aCard()
    const b = await aCard()
    await seedReviewLog(db, a.id, { state: State.New, review: NOON })
    await seedReviewLog(db, b.id, { state: State.New, review: NOON })
    // A duplicate New row on the same card (a restored backup, a replay) still
    // describes ONE card entering the rotation.
    await seedReviewLog(db, a.id, { state: State.New, review: NOON })
    expect(await countNewCardsIntroduced(db, U, NOON)).toBe(2)
  })

  it('new_count_boundaries_are_local_midnight_to_the_millisecond', async () => {
    const { start, end } = localDayBounds(NOON)
    const c1 = await aCard()
    const c2 = await aCard()
    const c3 = await aCard()
    const c4 = await aCard()
    await seedReviewLog(db, c1.id, { state: State.New, review: new Date(start.getTime() - 1) })
    await seedReviewLog(db, c2.id, { state: State.New, review: start }) // inclusive
    await seedReviewLog(db, c3.id, { state: State.New, review: new Date(end.getTime() - 1) })
    await seedReviewLog(db, c4.id, { state: State.New, review: end }) // exclusive → tomorrow

    expect(await countNewCardsIntroduced(db, U, NOON)).toBe(2)
    // The window is half-open, so the two adjacent days partition the timeline:
    // the 1 ms before start belongs to yesterday, `end` belongs to tomorrow.
    expect(await countNewCardsIntroduced(db, U, new Date(start.getTime() - 1))).toBe(1)
    expect(await countNewCardsIntroduced(db, U, end)).toBe(1)
  })

  it('new_count_is_scoped_per_user', async () => {
    const c = await aCard()
    await seedReviewLog(db, c.id, { state: State.New, review: NOON, userId: OTHER })
    expect(await countNewCardsIntroduced(db, U, NOON)).toBe(0)
    expect(await countNewCardsIntroduced(db, OTHER, NOON)).toBe(1)
  })

  it('new_count_walks_back_when_the_log_row_disappears', async () => {
    // `undoReview` hard-deletes the compensated row (the documented append-only
    // exception). Nothing else has to happen for the budget to be restored — that
    // is the whole reason the counter reads review_log instead of a stamp.
    const c = await aCard()
    const log = await seedReviewLog(db, c.id, { state: State.New, review: NOON })
    expect(await countNewCardsIntroduced(db, U, NOON)).toBe(1)
    await db.delete(reviewLog).where(eq(reviewLog.id, log.id))
    expect(await countNewCardsIntroduced(db, U, NOON)).toBe(0)
  })
})

describe('newCardBudget', () => {
  it('budget_defaults_then_shrinks_with_each_introduction', async () => {
    expect(await newCardBudget(db, U, NOON)).toEqual({ limit: 20, introduced: 0, remaining: 20 })
    const c = await aCard()
    await seedReviewLog(db, c.id, { state: State.New, review: NOON })
    expect(await newCardBudget(db, U, NOON)).toEqual({ limit: 20, introduced: 1, remaining: 19 })
  })

  it('budget_remaining_is_clamped_when_the_limit_is_lowered_after_studying', async () => {
    for (let i = 0; i < 3; i++) {
      await seedReviewLog(db, (await aCard()).id, { state: State.New, review: NOON })
    }
    await updateStudySettings(db, U, { newCardsPerDay: 1 }, NOON)
    // Never negative: "you are done for today", not "you owe two cards".
    expect(await newCardBudget(db, U, NOON)).toEqual({ limit: 1, introduced: 3, remaining: 0 })
  })
})

describe('getStudySettings', () => {
  it('today_block_reports_the_state_the_ui_needs', async () => {
    await updateStudySettings(db, U, { newCardsPerDay: 5, dailyGoal: 8 }, NOON)
    const c = await aCard()
    await seedReviewLog(db, c.id, { state: State.New, review: NOON })
    await seedReviewLog(db, c.id, { state: State.Learning, review: NOON })

    const res = await getStudySettings(db, U, NOON)
    expect(studySettingsResponseSchema.safeParse(res).success).toBe(true)
    expect(res.settings).toEqual({ newCardsPerDay: 5, dailyGoal: 8 })
    expect(res.today.newCardsIntroduced).toBe(1)
    expect(res.today.newCardsRemaining).toBe(4)
    // The goal counts EVERY review, not just introductions — and caps nothing.
    expect(res.today.reviewsDone).toBe(2)
    expect(res.today.day).toBe(
      `${NOON.getFullYear()}-${String(NOON.getMonth() + 1).padStart(2, '0')}-${String(NOON.getDate()).padStart(2, '0')}`,
    )
  })

  it('today_block_ignores_yesterdays_reviews', async () => {
    const c = await aCard()
    const yesterday = new Date(MIDNIGHT.getTime() - 3_600_000)
    await seedReviewLog(db, c.id, { state: State.New, review: yesterday })
    const res = await getStudySettings(db, U, NOON)
    expect(res.today.newCardsIntroduced).toBe(0)
    expect(res.today.reviewsDone).toBe(0)
    expect(res.today.newCardsRemaining).toBe(STUDY_NEW_CARDS_PER_DAY_DEFAULT)
  })
})
