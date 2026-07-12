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
 * (default singleton) for deterministic tests / future replay. A thrown guard
 * rolls the whole transaction back, so no `review_log` row survives a rejection.
 */
export async function reviewCard(
  db: DB,
  cardId: string,
  input: ReviewInput,
  sched: FSRS = scheduler,
): Promise<ReviewResult> {
  const now = new Date()
  const reviewedAt = input.reviewedAt ?? now

  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(card).where(eq(card.id, cardId))
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

    await tx.update(card).set(fsrsCardToColumns(rec.card)).where(eq(card.id, cardId))

    const logRow = fsrsLogToRow(cardId, rec.log, input.durationMs)
    const [insertedLog] = await tx.insert(reviewLog).values(logRow).returning()

    const [updatedCard] = await tx.select().from(card).where(eq(card.id, cardId))
    if (!updatedCard) throw new NotFoundError(`card ${cardId} not found`)
    return { card: cardToDto(updatedCard), log: reviewLogToDto(insertedLog!) }
  })
}
