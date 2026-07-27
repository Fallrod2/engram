import { and, desc, eq } from 'drizzle-orm'
import type { FSRS } from 'ts-fsrs'
import type { ReviewResult, UndoReview, UndoReviewResponse } from '@engram/shared'
import type { DB } from '../db/client'
import { card, reviewLog } from '../db/schema'
import { toFsrsCard, toFsrsLog, fsrsCardToColumns, fsrsLogToRow } from '../db/mappers'
import { cardToDto, reviewLogToDto } from '../db/dto'
import { schedule, toGrade, scheduler } from './fsrs'
import { ConflictError, NotFoundError, ValidationError } from '../http/errors'

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
  userId: string,
  cardId: string,
  input: ReviewInput,
  sched: FSRS = scheduler,
): Promise<ReviewResult> {
  const now = new Date()
  const reviewedAt = input.reviewedAt ?? now

  return db.transaction(async (tx) => {
    // Scoped SELECT: a card owned by another user reads as 404 (never a 403).
    const [row] = await tx
      .select()
      .from(card)
      .where(and(eq(card.id, cardId), eq(card.userId, userId)))
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
    // Denormalized owner on the append-only log (spec §1.1).
    const [insertedLog] = await tx
      .insert(reviewLog)
      .values({ ...logRow, userId })
      .returning()

    const [updatedCard] = await tx.select().from(card).where(eq(card.id, cardId))
    if (!updatedCard) throw new NotFoundError(`card ${cardId} not found`)
    return { card: cardToDto(updatedCard), log: reviewLogToDto(insertedLog!) }
  })
}

/** A typo is fixed within the minute, not the next day. Bounds the undo to the
 *  current sitting and freezes the analytics beyond it. */
export const UNDO_WINDOW_MS = 10 * 60_000

/**
 * Undo the LAST review of a card: `fsrs.rollback` restores the pre-review FSRS
 * state (never reimplemented by hand) and the compensated `review_log` row is
 * hard-deleted — see the append-only exception documented on the table.
 *
 * `rollback` re-consumes the log symmetrically with `buildLog`, which recorded
 * the state BEFORE the review. That is only sound for the CURRENT card paired
 * with its OWN last log; any other pairing corrupts `reps`/`lapses`. Hence the
 * guard is structural, not a comment: the log is re-read as the last one inside
 * the transaction AND its id must match the one the client was handed. Every
 * `throw` rolls the transaction back — no half-undone card, no orphan log.
 */
export async function undoReview(
  db: DB,
  userId: string,
  cardId: string,
  input: UndoReview,
  sched: FSRS = scheduler,
  now: Date = new Date(),
): Promise<UndoReviewResponse> {
  return db.transaction(async (tx) => {
    // Scoped SELECT: a card owned by another user reads as 404 (never a 403).
    const [row] = await tx
      .select()
      .from(card)
      .where(and(eq(card.id, cardId), eq(card.userId, userId)))
    if (!row) throw new NotFoundError(`card ${cardId} not found`)

    const [log] = await tx
      .select()
      .from(reviewLog)
      .where(and(eq(reviewLog.cardId, cardId), eq(reviewLog.userId, userId)))
      .orderBy(desc(reviewLog.review), desc(reviewLog.createdAt))
      .limit(1)
    if (!log) throw new ConflictError(`card ${cardId} has no review to undo`)

    // The structural guard. A stale id means another review landed in between,
    // or this undo already ran — either way the pairing would be unsound.
    if (log.id !== input.logId) {
      throw new ConflictError(`review log ${input.logId} is no longer the last review of the card`)
    }
    // Rating.Manual (0) never comes from a session; rollback throws an unmapped
    // FSRSValidationError on it, so reject it here as a plain conflict.
    if (log.rating === 0) throw new ConflictError('a manual rating cannot be undone')
    if (now.getTime() - log.review.getTime() > UNDO_WINDOW_MS) {
      throw new ConflictError('the undo window for this review has expired')
    }

    const restored = sched.rollback(toFsrsCard(row), toFsrsLog(log))
    await tx.update(card).set(fsrsCardToColumns(restored)).where(eq(card.id, cardId))
    await tx.delete(reviewLog).where(eq(reviewLog.id, log.id))

    const [updatedCard] = await tx.select().from(card).where(eq(card.id, cardId))
    if (!updatedCard) throw new NotFoundError(`card ${cardId} not found`)
    return { card: cardToDto(updatedCard), undoneLogId: log.id }
  })
}
