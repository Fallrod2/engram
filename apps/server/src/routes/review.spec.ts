import { beforeEach, describe, expect, it } from 'bun:test'
import { count, eq } from 'drizzle-orm'
import {
  dueCountsSchema,
  reviewQueueResponseSchema,
  reviewResultSchema,
  undoReviewResponseSchema,
} from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { card, reviewLog } from '../db/schema'
import { resetDb, seedCard, seedDeck, seedReviewLog, seedSubject } from '../test-support/harness'

beforeEach(() => resetDb(db))

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const NOW = '2026-07-12T10:00:00.000Z'
const past = new Date(Date.parse(NOW) - 3_600_000)
const future = new Date(Date.parse(NOW) + 3_600_000)

async function newDeck() {
  return (await seedDeck(db, (await seedSubject(db)).id)).id
}

/** The 10 FSRS columns `fsrs.rollback` is expected to restore, verbatim. */
async function fsrsCols(cardId: string) {
  const [row] = await db.select().from(card).where(eq(card.id, cardId))
  const r = row!
  return {
    due: r.due,
    stability: r.stability,
    difficulty: r.difficulty,
    elapsedDays: r.elapsedDays,
    scheduledDays: r.scheduledDays,
    learningSteps: r.learningSteps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    lastReview: r.lastReview,
  }
}

async function reviewLogCount(cardId: string) {
  const [row] = await db.select({ n: count() }).from(reviewLog).where(eq(reviewLog.cardId, cardId))
  return row!.n
}

/** Review the card once and return the id of the log the API handed back. */
async function reviewOnce(cardId: string, grade: number, reviewedAt?: Date) {
  const res = await postJson(`/api/cards/${cardId}/review`, {
    grade,
    ...(reviewedAt ? { reviewedAt: reviewedAt.toISOString() } : {}),
  })
  expect(res.status).toBe(200)
  return reviewResultSchema.parse(await res.json()).log.id
}

const undo = (cardId: string, logId: string) =>
  postJson(`/api/cards/${cardId}/review/undo`, { logId })

describe('review routes', () => {
  it('GET /api/review/queue → contract-valid, now-deterministic', async () => {
    const deckId = await newDeck()
    await seedCard(db, deckId, { due: past })
    await seedCard(db, deckId, { due: future })
    const res = await app.request(`/api/review/queue?now=${NOW}`)
    const body = reviewQueueResponseSchema.parse(await res.json())
    expect(body.now).toBe(NOW)
    expect(body.total).toBe(1)
    expect(body.cards).toHaveLength(1)
  })

  it('POST /api/cards/:id/review reschedules the card', async () => {
    const c = await seedCard(db, await newDeck(), { due: past })
    const res = await postJson(`/api/cards/${c.id}/review`, { grade: 3, durationMs: 4200 })
    expect(res.status).toBe(200)
    const result = reviewResultSchema.parse(await res.json())
    expect(Date.parse(result.card.fsrs.due)).toBeGreaterThan(Date.now())
    // No longer due right now.
    const q = reviewQueueResponseSchema.parse(
      await (await app.request(`/api/review/queue?now=${new Date().toISOString()}`)).json(),
    )
    expect(q.total).toBe(0)
  })

  it('POST /api/cards/:id/review invalid grades → 400', async () => {
    const c = await seedCard(db, await newDeck())
    for (const grade of [0, 5, 'x']) {
      expect((await postJson(`/api/cards/${c.id}/review`, { grade })).status).toBe(400)
    }
  })

  it('POST /api/cards/:id/review missing card → 404', async () => {
    expect((await postJson('/api/cards/nope/review', { grade: 3 })).status).toBe(404)
  })

  it('POST /api/cards/:id/review rejects incoherent reviewedAt', async () => {
    const c = await seedCard(db, await newDeck())
    const far = new Date(Date.now() + 5 * 60_000).toISOString()
    expect(
      (await postJson(`/api/cards/${c.id}/review`, { grade: 3, reviewedAt: far })).status,
    ).toBe(400)
    // Establish a lastReview, then submit an earlier reviewedAt.
    await postJson(`/api/cards/${c.id}/review`, { grade: 3, reviewedAt: new Date().toISOString() })
    const earlier = new Date(Date.now() - 3_600_000).toISOString()
    expect(
      (await postJson(`/api/cards/${c.id}/review`, { grade: 3, reviewedAt: earlier })).status,
    ).toBe(400)
  })

  it('GET /api/review/counts is contract-valid and consistent with the queue', async () => {
    const deckId = await newDeck()
    await seedCard(db, deckId, { due: past })
    await seedCard(db, deckId, { due: past })
    await seedCard(db, deckId, { due: future })
    const counts = dueCountsSchema.parse(
      await (await app.request(`/api/review/counts?now=${NOW}`)).json(),
    )
    const queue = reviewQueueResponseSchema.parse(
      await (await app.request(`/api/review/queue?now=${NOW}`)).json(),
    )
    expect(counts.now).toBe(NOW)
    expect(counts.total).toBe(2)
    expect(counts.total).toBe(queue.total)
  })
})

describe('POST /api/cards/:id/review/undo', () => {
  it('restores every FSRS column to its exact pre-review value', async () => {
    const c = await seedCard(db, await newDeck(), { due: past })
    const before = await fsrsCols(c.id)

    const logId = await reviewOnce(c.id, 3)
    expect(await fsrsCols(c.id)).not.toEqual(before) // the review really moved it

    expect((await undo(c.id, logId)).status).toBe(200)
    expect(await fsrsCols(c.id)).toEqual(before)
  })

  it('hard-deletes the compensated review_log row', async () => {
    const c = await seedCard(db, await newDeck(), { due: past })
    const logId = await reviewOnce(c.id, 3)
    expect(await reviewLogCount(c.id)).toBe(1)

    expect((await undo(c.id, logId)).status).toBe(200)
    expect(await reviewLogCount(c.id)).toBe(0)
  })

  it('rejects a stale logId with 409 and leaves the card untouched', async () => {
    const c = await seedCard(db, await newDeck(), { due: past })
    const staleLogId = await reviewOnce(c.id, 3, new Date(Date.now() - 2_000))
    await reviewOnce(c.id, 3, new Date(Date.now() - 1_000))
    const before = await fsrsCols(c.id)

    expect((await undo(c.id, staleLogId)).status).toBe(409)
    expect(await fsrsCols(c.id)).toEqual(before)
    expect(await reviewLogCount(c.id)).toBe(2)
  })

  it('is idempotent: undoing the same logId twice → 409', async () => {
    const c = await seedCard(db, await newDeck(), { due: past })
    const logId = await reviewOnce(c.id, 3)
    expect((await undo(c.id, logId)).status).toBe(200)
    const afterUndo = await fsrsCols(c.id)

    expect((await undo(c.id, logId)).status).toBe(409)
    expect(await fsrsCols(c.id)).toEqual(afterUndo)
  })

  it("another user's card → 404 (never 403)", async () => {
    const other = 'user-other'
    const subjectId = (await seedSubject(db, { userId: other })).id
    const deckId = (await seedDeck(db, subjectId, { userId: other })).id
    const c = await seedCard(db, deckId, { due: past, userId: other })
    const log = await seedReviewLog(db, c.id, { userId: other })

    expect((await undo(c.id, log.id)).status).toBe(404)
  })

  it('a card with no review → 409', async () => {
    const c = await seedCard(db, await newDeck(), { due: past })
    expect((await undo(c.id, 'whatever')).status).toBe(409)
  })

  it('a review older than the undo window → 409', async () => {
    const c = await seedCard(db, await newDeck(), { due: past })
    const stale = await seedReviewLog(db, c.id, {
      review: new Date(Date.now() - 11 * 60_000),
    })
    expect((await undo(c.id, stale.id)).status).toBe(409)
    expect(await reviewLogCount(c.id)).toBe(1)
  })

  it('restores lapses after an Again on a Review-state card', async () => {
    const c = await seedCard(db, await newDeck())
    // Drive the row into a realistic Review state: only there does `rollback`
    // apply its conditional `lapses - 1`.
    await db
      .update(card)
      .set({
        due: past,
        stability: 40,
        difficulty: 5,
        elapsedDays: 9,
        scheduledDays: 38,
        learningSteps: 0,
        reps: 4,
        lapses: 2,
        state: 2,
        lastReview: new Date(Date.now() - 9 * 86_400_000),
      })
      .where(eq(card.id, c.id))

    const logId = await reviewOnce(c.id, 1)
    expect((await fsrsCols(c.id)).lapses).toBe(3)

    expect((await undo(c.id, logId)).status).toBe(200)
    expect(await fsrsCols(c.id)).toMatchObject({ lapses: 2, reps: 4, state: 2 })
  })

  it('answers a contract-valid payload', async () => {
    const c = await seedCard(db, await newDeck(), { due: past })
    const logId = await reviewOnce(c.id, 3)
    const res = await undo(c.id, logId)
    const body = undoReviewResponseSchema.parse(await res.json())
    expect(body.undoneLogId).toBe(logId)
    expect(body.card.id).toBe(c.id)
    expect(body.card.fsrs.reps).toBe(0)
  })
})
