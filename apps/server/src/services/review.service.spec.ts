import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { fsrs, generatorParameters } from 'ts-fsrs'
import { cardSchema, reviewLogSchema } from '@engram/shared'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { card, reviewLog } from '../db/schema'
import { toFsrsCard } from '../db/mappers'
import { NotFoundError, ValidationError } from '../http/errors'
import { seedCard, seedDeck, seedSubject } from '../test-support/harness'
import { reviewCard } from './review.service'
import { schedule, toGrade } from './fsrs'

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

/** Seed a fresh (New) card and return its id. */
async function newCard() {
  const s = await seedSubject(db)
  const d = await seedDeck(db, s.id)
  return (await seedCard(db, d.id)).id
}

describe('reviewCard (transactional)', () => {
  it('review_persists_card_and_log', async () => {
    const id = await newCard()
    const res = await reviewCard(db, U, id, { grade: 3, durationMs: 4200 })
    expect(res.card.fsrs.state).toBe(1)
    expect(res.card.fsrs.reps).toBe(1)
    expect(res.card.fsrs.lastReview).not.toBeNull()

    const logs = await db.select().from(reviewLog).where(eq(reviewLog.cardId, id))
    expect(logs).toHaveLength(1)
    expect(logs[0]!.rating).toBe(3)
    expect(logs[0]!.state).toBe(0) // state BEFORE the review
    expect(logs[0]!.durationMs).toBe(4200)
  })

  it('review_null_duration_when_absent', async () => {
    const id = await newCard()
    await reviewCard(db, U, id, { grade: 3 })
    const [log] = await db.select().from(reviewLog).where(eq(reviewLog.cardId, id))
    expect(log!.durationMs).toBeNull()
  })

  it('review_nonexistent_card_throws_notfound', async () => {
    await expect(reviewCard(db, U, 'missing', { grade: 3 })).rejects.toThrow(NotFoundError)
    expect(await db.select().from(reviewLog)).toHaveLength(0)
  })

  it('review_honors_reviewedAt', async () => {
    const id = await newCard()
    const when = new Date(Date.now() - 60_000)
    const res = await reviewCard(db, U, id, { grade: 3, reviewedAt: when })
    expect(res.log.review).toBe(when.toISOString())
    expect(res.card.fsrs.lastReview).toBe(when.toISOString())
  })

  it('review_roundtrip_matches_shared', async () => {
    const id = await newCard()
    const res = await reviewCard(db, U, id, { grade: 3, durationMs: 100 })
    expect(cardSchema.safeParse(res.card).success).toBe(true)
    expect(reviewLogSchema.safeParse(res.log).success).toBe(true)
  })

  it('review_second_review_uses_persisted_state', async () => {
    const id = await newCard()
    const first = await reviewCard(db, U, id, {
      grade: 3,
      reviewedAt: new Date(Date.now() - 3_600_000),
    })
    const second = await reviewCard(db, U, id, { grade: 3, reviewedAt: new Date() })
    expect(first.card.fsrs.reps).toBe(1)
    expect(second.card.fsrs.reps).toBe(2)
  })

  it('review_rejects_future_reviewedAt', async () => {
    const id = await newCard()
    const future = new Date(Date.now() + 5 * 60_000)
    await expect(reviewCard(db, U, id, { grade: 3, reviewedAt: future })).rejects.toThrow(
      ValidationError,
    )
    expect(await db.select().from(reviewLog)).toHaveLength(0)
  })

  it('review_rejects_reviewedAt_before_lastReview', async () => {
    const id = await newCard()
    await reviewCard(db, U, id, { grade: 3, reviewedAt: new Date(Date.now() - 1_000) })
    const [before] = await db.select().from(card).where(eq(card.id, id))
    await expect(
      reviewCard(db, U, id, { grade: 3, reviewedAt: new Date(Date.now() - 3_600_000) }),
    ).rejects.toThrow(ValidationError)
    // The failed second attempt left the card untouched (transaction rollback).
    const [after] = await db.select().from(card).where(eq(card.id, id))
    expect(after!.reps).toBe(before!.reps)
    expect(after!.due.getTime()).toBe(before!.due.getTime())
  })

  it('review_uses_injected_scheduler', async () => {
    const id = await newCard()
    const sched = fsrs(generatorParameters({ enable_fuzz: false }))
    const when = new Date(Date.now() - 60_000)
    const [row] = await db.select().from(card).where(eq(card.id, id))
    const expected = schedule(toFsrsCard(row!), toGrade(3), when, sched)
    const res = await reviewCard(db, U, id, { grade: 3, reviewedAt: when }, sched)
    expect(res.card.fsrs.due).toBe(expected.card.due.toISOString())
  })
})
