import type { Card as FsrsCard, ReviewLog as FsrsReviewLog } from 'ts-fsrs'
import type { InferSelectModel } from 'drizzle-orm'
import type { CardRow, reviewLog } from './schema'
import { SEED_CARD_ID_FIELD, type SchedulableCard } from '../services/fsrs'

/**
 * Adapters at the DB ⇄ ts-fsrs boundary. Drizzle FSRS properties are camelCase;
 * ts-fsrs uses snake_case. `last_review` is optional under
 * `exactOptionalPropertyTypes`, so the key is omitted when falsy.
 */

/**
 * `CardRow` (from the schema) is everything of a card row EXCEPT the generated
 * search columns. `front_fold` / `back_fold` are a database-side search index
 * (migration 0012), never an input to scheduling, so requiring them here would
 * force every caller to SELECT two columns it has no use for — and since T-060
 * the callers really do skip them, via `cardColumns`.
 */
type ReviewLogRow = InferSelectModel<typeof reviewLog>

/**
 * DB row → ts-fsrs `Card` (to feed `fsrs.next` / `fsrs.repeat`).
 *
 * The row id rides along in `card_id`: ts-fsrs ignores the field but the
 * scheduler's SEED strategy reads it to make the interval fuzz deterministic
 * per card (T-026, see `services/fsrs.ts`). Putting it here rather than at each
 * call site means no caller can forget it. `fsrsCardToColumns` drops it again.
 */
export function toFsrsCard(row: CardRow): SchedulableCard {
  return {
    [SEED_CARD_ID_FIELD]: row.id,
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

/**
 * `review_log` row → ts-fsrs `ReviewLog` (to feed `fsrs.rollback`). Inverse of
 * `fsrsLogToRow`; the extra `id`/`userId`/`durationMs`/`createdAt` columns are
 * ours, not FSRS's, and are dropped. `ReviewLog` declares no optional field, so
 * `exactOptionalPropertyTypes` has nothing to catch here.
 */
export function toFsrsLog(row: ReviewLogRow): FsrsReviewLog {
  return {
    rating: row.rating as FsrsReviewLog['rating'],
    state: row.state as FsrsReviewLog['state'],
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    last_elapsed_days: row.lastElapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    review: row.review,
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
