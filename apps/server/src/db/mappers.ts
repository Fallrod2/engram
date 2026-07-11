import type { Card as FsrsCard, ReviewLog as FsrsReviewLog } from 'ts-fsrs'
import type { InferSelectModel } from 'drizzle-orm'
import type { card } from './schema'

/**
 * Adapters at the DB ⇄ ts-fsrs boundary. Drizzle FSRS properties are camelCase;
 * ts-fsrs uses snake_case. `last_review` is optional under
 * `exactOptionalPropertyTypes`, so the key is omitted when falsy.
 */

type CardRow = InferSelectModel<typeof card>

/** DB row → ts-fsrs `Card` (to feed `fsrs.next` / `fsrs.repeat`). */
export function toFsrsCard(row: CardRow): FsrsCard {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    ...(row.lastReview ? { last_review: row.lastReview } : {}),
  }
}

/** ts-fsrs `Card` → patch of the FSRS columns (after a review). */
export function fsrsCardToColumns(c: FsrsCard) {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ?? null,
  }
}

/** ts-fsrs `ReviewLog` → a row to insert into `review_log`. */
export function fsrsLogToRow(cardId: string, log: FsrsReviewLog, durationMs?: number) {
  return {
    cardId,
    rating: log.rating,
    state: log.state,
    due: log.due,
    stability: log.stability,
    difficulty: log.difficulty,
    elapsedDays: log.elapsed_days,
    lastElapsedDays: log.last_elapsed_days,
    scheduledDays: log.scheduled_days,
    learningSteps: log.learning_steps,
    review: log.review,
    durationMs: durationMs ?? null,
  }
}
