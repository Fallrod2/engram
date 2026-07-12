import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { fsrs, generatorParameters } from 'ts-fsrs'
import { cardSchema, reviewLogSchema } from '@engram/shared'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { card, reviewLog } from '../db/schema'
import { toFsrsCard } from '../db/mappers'
import { NotFoundError, ValidationError } from '../http/errors'
import { seedCard, seedDeck, seedSubject } from '../test-support/harness'
import { reviewCard } from './review.service'
import { schedule, toGrade } from './fsrs'

let t: TestDb
// createTestDb() yields the same runtime handle as the singleton but its type
// omits `$client`; assert it back to `DB` so service signatures accept it.
let db: DB
beforeEach(() => {
  t = createTestDb()
  db = t.db as DB
})
afterEach(() => {
  t.cleanup()
})

/** Seed a fresh (New) card and return its id. */
function newCard() {
  const s = seedSubject(db)
  const d = seedDeck(db, s.id)
  return seedCard(db, d.id).id
}

describe('reviewCard (transactional)', () => {
  it('review_persists_card_and_log', () => {
    const id = newCard()
    const res = reviewCard(db, id, { grade: 3, durationMs: 4200 })
    expect(res.card.fsrs.state).toBe(1)
    expect(res.card.fsrs.reps).toBe(1)
    expect(res.card.fsrs.lastReview).not.toBeNull()

    const logs = db.select().from(reviewLog).where(eq(reviewLog.cardId, id)).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]!.rating).toBe(3)
    expect(logs[0]!.state).toBe(0) // state BEFORE the review
    expect(logs[0]!.durationMs).toBe(4200)
  })

  it('review_null_duration_when_absent', () => {
    const id = newCard()
    reviewCard(db, id, { grade: 3 })
    const log = db.select().from(reviewLog).where(eq(reviewLog.cardId, id)).get()
    expect(log!.durationMs).toBeNull()
  })

  it('review_nonexistent_card_throws_notfound', () => {
    expect(() => reviewCard(db, 'missing', { grade: 3 })).toThrow(NotFoundError)
    expect(db.select().from(reviewLog).all()).toHaveLength(0)
  })

  it('review_honors_reviewedAt', () => {
    const id = newCard()
    const when = new Date(Date.now() - 60_000)
    const res = reviewCard(db, id, { grade: 3, reviewedAt: when })
    expect(res.log.review).toBe(when.toISOString())
    expect(res.card.fsrs.lastReview).toBe(when.toISOString())
  })

  it('review_roundtrip_matches_shared', () => {
    const id = newCard()
    const res = reviewCard(db, id, { grade: 3, durationMs: 100 })
    expect(cardSchema.safeParse(res.card).success).toBe(true)
    expect(reviewLogSchema.safeParse(res.log).success).toBe(true)
  })

  it('review_second_review_uses_persisted_state', () => {
    const id = newCard()
    const first = reviewCard(db, id, { grade: 3, reviewedAt: new Date(Date.now() - 3_600_000) })
    const second = reviewCard(db, id, { grade: 3, reviewedAt: new Date() })
    expect(first.card.fsrs.reps).toBe(1)
    expect(second.card.fsrs.reps).toBe(2)
  })

  it('review_rejects_future_reviewedAt', () => {
    const id = newCard()
    const future = new Date(Date.now() + 5 * 60_000)
    expect(() => reviewCard(db, id, { grade: 3, reviewedAt: future })).toThrow(ValidationError)
    expect(db.select().from(reviewLog).all()).toHaveLength(0)
  })

  it('review_rejects_reviewedAt_before_lastReview', () => {
    const id = newCard()
    reviewCard(db, id, { grade: 3, reviewedAt: new Date(Date.now() - 1_000) })
    const before = db.select().from(card).where(eq(card.id, id)).get()!
    expect(() =>
      reviewCard(db, id, { grade: 3, reviewedAt: new Date(Date.now() - 3_600_000) }),
    ).toThrow(ValidationError)
    // The failed second attempt left the card untouched (transaction rollback).
    const after = db.select().from(card).where(eq(card.id, id)).get()!
    expect(after.reps).toBe(before.reps)
    expect(after.due.getTime()).toBe(before.due.getTime())
  })

  it('review_uses_injected_scheduler', () => {
    const id = newCard()
    const sched = fsrs(generatorParameters({ enable_fuzz: false }))
    const when = new Date(Date.now() - 60_000)
    const row = db.select().from(card).where(eq(card.id, id)).get()!
    const expected = schedule(toFsrsCard(row), toGrade(3), when, sched)
    const res = reviewCard(db, id, { grade: 3, reviewedAt: when }, sched)
    expect(res.card.fsrs.due).toBe(expected.card.due.toISOString())
  })
})
