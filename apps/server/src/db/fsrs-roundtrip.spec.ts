import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs'
import { eq } from 'drizzle-orm'
import { reviewLogSchema } from '@engram/shared'
import { createTestDb, type TestDb } from './test-db'
import { subject, deck, card, reviewLog } from './schema'
import { toFsrsCard, fsrsCardToColumns, fsrsLogToRow } from './mappers'
import { reviewLogToDto } from './dto'

let t: TestDb

beforeEach(async () => {
  t = await createTestDb()
})
afterEach(async () => {
  await t.cleanup()
})

async function seedCard(): Promise<string> {
  const [s] = await t.db
    .insert(subject)
    .values({ name: 'TL', color: '#a1b2c3', icon: 'book-open' })
    .returning()
  const [d] = await t.db.insert(deck).values({ subjectId: s!.id, name: 'Automata' }).returning()
  const empty = createEmptyCard(new Date())
  const [c] = await t.db
    .insert(card)
    .values({
      deckId: d!.id,
      front: 'front',
      back: 'back',
      ...fsrsCardToColumns(empty),
    })
    .returning()
  return c!.id
}

describe('FSRS round-trip DB ⇄ ts-fsrs', () => {
  it('createEmptyCard → insert → select → toFsrsCard preserves fields', async () => {
    const id = await seedCard()
    const [row] = await t.db.select().from(card).where(eq(card.id, id))
    const fsrsCard = toFsrsCard(row!)
    expect(fsrsCard.state).toBe(0)
    expect(fsrsCard.reps).toBe(0)
    expect(fsrsCard.stability).toBe(0)
    expect(fsrsCard.due).toBeInstanceOf(Date)
    // last_review key omitted when unset (exactOptionalPropertyTypes)
    expect('last_review' in fsrsCard).toBe(false)
  })

  it('review with Good updates card columns and writes a valid review_log', async () => {
    const id = await seedCard()
    const [row] = await t.db.select().from(card).where(eq(card.id, id))
    const before = toFsrsCard(row!)

    const reviewedAt = new Date()
    const rec = fsrs().next(before, reviewedAt, Rating.Good)

    await t.db.update(card).set(fsrsCardToColumns(rec.card)).where(eq(card.id, id))
    await t.db.insert(reviewLog).values(fsrsLogToRow(id, rec.log, 4200))

    const [updated] = await t.db.select().from(card).where(eq(card.id, id))
    expect(updated!.reps).toBe(1)
    expect(updated!.state).toBe(rec.card.state)
    expect(updated!.lastReview?.getTime()).toBe(rec.card.last_review?.getTime())
    expect(updated!.due.getTime()).toBe(rec.card.due.getTime())

    const [logRow] = await t.db.select().from(reviewLog).where(eq(reviewLog.cardId, id))
    expect(logRow!.rating).toBe(Rating.Good)
    expect(logRow!.durationMs).toBe(4200)
    expect(logRow!.review.getTime()).toBe(rec.log.review.getTime())

    // DTO produced from the row must satisfy the shared contract.
    const dto = reviewLogToDto(logRow!)
    expect(reviewLogSchema.safeParse(dto).success).toBe(true)
  })

  it('durationMs defaults to null when not provided', async () => {
    const id = await seedCard()
    const [row] = await t.db.select().from(card).where(eq(card.id, id))
    const rec = fsrs().next(toFsrsCard(row!), new Date(), Rating.Again)
    await t.db.insert(reviewLog).values(fsrsLogToRow(id, rec.log))
    const [logRow] = await t.db.select().from(reviewLog).where(eq(reviewLog.cardId, id))
    expect(logRow!.durationMs).toBeNull()
  })
})
