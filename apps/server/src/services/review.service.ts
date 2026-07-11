import { eq } from 'drizzle-orm'
import type { FSRS } from 'ts-fsrs'
import type { ReviewResult } from '@engram/shared'
import type { DB } from '../db/client'
import { card, reviewLog } from '../db/schema'
import { toFsrsCard, fsrsCardToColumns, fsrsLogToRow } from '../db/mappers'
import { cardToDto, reviewLogToDto } from '../db/dto'
import { schedule, toGrade, scheduler } from './fsrs'
import { NotFoundError, ValidationError } from '../http/errors'

const FUTURE_SKEW_MS = 60_000

export interface ReviewInput {
  grade: 1 | 2 | 3 | 4
  durationMs?: number
  reviewedAt?: Date
}

/**
 * Read the card, validate `reviewedAt`, play `FSRS.next`, then persist the card
 * update and the `review_log` insert in ONE transaction. `sched` is injectable
 * (default singleton) for deterministic tests / future replay. bun:sqlite is
 * synchronous, so the transaction callback is synchronous (never `await`).
 */
export function reviewCard(
  db: DB,
  cardId: string,
  input: ReviewInput,
  sched: FSRS = scheduler,
): ReviewResult {
  const now = new Date()
  const reviewedAt = input.reviewedAt ?? now

  return db.transaction((tx) => {
    const row = tx.select().from(card).where(eq(card.id, cardId)).get()
    if (!row) throw new NotFoundError(`card ${cardId} not found`)

    // Guards depend on row.lastReview, so they sit after the select but before
    // any write. A thrown ValidationError rolls back: no review_log is created.
    if (reviewedAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
      throw new ValidationError('reviewedAt is in the future')
    }
    if (row.lastReview && reviewedAt.getTime() < row.lastReview.getTime()) {
      throw new ValidationError('reviewedAt precedes last review')
    }

    const rec = schedule(toFsrsCard(row), toGrade(input.grade), reviewedAt, sched)

    tx.update(card).set(fsrsCardToColumns(rec.card)).where(eq(card.id, cardId)).run()

    const logRow = fsrsLogToRow(cardId, rec.log, input.durationMs)
    const insertedLog = tx.insert(reviewLog).values(logRow).returning().get()

    const updatedCard = tx.select().from(card).where(eq(card.id, cardId)).get()
    if (!updatedCard) throw new NotFoundError(`card ${cardId} not found`)
    return { card: cardToDto(updatedCard), log: reviewLogToDto(insertedLog) }
  })
}
