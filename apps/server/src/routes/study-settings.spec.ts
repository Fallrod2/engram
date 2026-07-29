import { beforeEach, describe, expect, it } from 'bun:test'
import { State } from 'ts-fsrs'
import {
  STUDY_DAILY_GOAL_DEFAULT,
  STUDY_NEW_CARDS_PER_DAY_DEFAULT,
  STUDY_PACE_MAX,
  reviewQueueResponseSchema,
  studySettingsResponseSchema,
} from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { resetDb, seedCard, seedDeck, seedReviewLog, seedSubject } from '../test-support/harness'

beforeEach(() => resetDb(db))

// Midday of a fixed local calendar day: the day bucketing is local, so the
// instant must be far from both midnights for the assertions to be stable.
const NOW = new Date(2026, 6, 12, 12, 0)
const NOW_ISO = NOW.toISOString()
const q = (path: string) =>
  `${path}${path.includes('?') ? '&' : '?'}now=${encodeURIComponent(NOW_ISO)}`

const patch = (body: unknown, path = q('/api/study-settings')) =>
  app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

async function newDeck() {
  return (await seedDeck(db, (await seedSubject(db)).id)).id
}

describe('study-settings routes', () => {
  it('GET → 200 contract-valid, coded defaults for an account that never chose', async () => {
    const res = await app.request(q('/api/study-settings'))
    expect(res.status).toBe(200)
    const body = studySettingsResponseSchema.parse(await res.json())
    expect(body.settings).toEqual({
      newCardsPerDay: STUDY_NEW_CARDS_PER_DAY_DEFAULT,
      dailyGoal: STUDY_DAILY_GOAL_DEFAULT,
    })
    expect(body.today).toEqual({
      day: '2026-07-12',
      newCardsIntroduced: 0,
      newCardsRemaining: STUDY_NEW_CARDS_PER_DAY_DEFAULT,
      reviewsDone: 0,
    })
  })

  it('PATCH → 200, persists, and GET reads it back', async () => {
    const res = await patch({ newCardsPerDay: 5, dailyGoal: 40 })
    expect(res.status).toBe(200)
    expect(studySettingsResponseSchema.parse(await res.json()).settings).toEqual({
      newCardsPerDay: 5,
      dailyGoal: 40,
    })
    const get = studySettingsResponseSchema.parse(
      await (await app.request(q('/api/study-settings'))).json(),
    )
    expect(get.settings).toEqual({ newCardsPerDay: 5, dailyGoal: 40 })
    expect(get.today.newCardsRemaining).toBe(5)
  })

  it('PATCH accepts a partial body and an empty one', async () => {
    await patch({ newCardsPerDay: 5, dailyGoal: 40 })
    expect(
      studySettingsResponseSchema.parse(await (await patch({ dailyGoal: 9 })).json()).settings,
    ).toEqual({
      newCardsPerDay: 5,
      dailyGoal: 9,
    })
    expect(studySettingsResponseSchema.parse(await (await patch({})).json()).settings).toEqual({
      newCardsPerDay: 5,
      dailyGoal: 9,
    })
  })

  it('PATCH out-of-range or non-integer → 400', async () => {
    expect((await patch({ newCardsPerDay: -1 })).status).toBe(400)
    expect((await patch({ newCardsPerDay: STUDY_PACE_MAX + 1 })).status).toBe(400)
    expect((await patch({ newCardsPerDay: 2.5 })).status).toBe(400)
    // 0 is legitimate for the limit (pause), but not for the goal.
    expect((await patch({ newCardsPerDay: 0 })).status).toBe(200)
    expect((await patch({ dailyGoal: 0 })).status).toBe(400)
    expect((await patch({ dailyGoal: 'lots' })).status).toBe(400)
  })

  it('GET today block counts introductions and reviews of the local day', async () => {
    const d = await newDeck()
    const c1 = await seedCard(db, d)
    const c2 = await seedCard(db, d)
    await seedReviewLog(db, c1.id, { state: State.New, review: NOW })
    await seedReviewLog(db, c1.id, { state: State.Learning, review: NOW })
    await seedReviewLog(db, c2.id, { state: State.New, review: NOW })
    // Yesterday: must not leak into today's numbers.
    await seedReviewLog(db, c2.id, { state: State.Review, review: new Date(2026, 6, 11, 23, 30) })

    const body = studySettingsResponseSchema.parse(
      await (await app.request(q('/api/study-settings'))).json(),
    )
    expect(body.today.newCardsIntroduced).toBe(2)
    expect(body.today.reviewsDone).toBe(3)
    expect(body.today.newCardsRemaining).toBe(STUDY_NEW_CARDS_PER_DAY_DEFAULT - 2)
  })
})

describe('the limit as the review queue applies it (end to end)', () => {
  it('GET /api/review/queue reports the budget and withholds only new cards', async () => {
    const d = await newDeck()
    await patch({ newCardsPerDay: 1 })
    const due = new Date(NOW.getTime() - 3_600_000)
    // Two never-seen cards + one already-seen due card.
    await seedCard(db, d, { due })
    await seedCard(db, d, { due })
    await seedCard(db, d, { due, state: State.Review, reps: 4 })

    const res = await app.request(q('/api/review/queue'))
    expect(res.status).toBe(200)
    const body = reviewQueueResponseSchema.parse(await res.json())
    expect(body.cards).toHaveLength(2) // the due one + exactly one new one
    expect(body.total).toBe(2)
    expect(body.newCards).toEqual({ limit: 1, introduced: 0, remaining: 1, withheld: 1 })
  })

  it('a limit of 0 still hands out every due card', async () => {
    const d = await newDeck()
    await patch({ newCardsPerDay: 0 })
    const due = new Date(NOW.getTime() - 3_600_000)
    await seedCard(db, d, { due })
    for (let i = 0; i < 3; i++) await seedCard(db, d, { due, state: State.Review, reps: 2 })

    const body = reviewQueueResponseSchema.parse(
      await (await app.request(q('/api/review/queue'))).json(),
    )
    expect(body.cards).toHaveLength(3)
    expect(body.cards.every((c) => c.fsrs.state !== State.New)).toBe(true)
    expect(body.newCards).toEqual({ limit: 0, introduced: 0, remaining: 0, withheld: 1 })
  })
})
