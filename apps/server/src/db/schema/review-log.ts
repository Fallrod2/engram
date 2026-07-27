import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { id, userId, createdAt } from './columns'
import { card } from './card'

/**
 * Append-only log of every review. Columns mirror the ts-fsrs 5.4.1
 * `ReviewLog` field names, plus `duration_ms` (time spent on the card) for
 * analytics. "scheduled vs actual" = `due` (scheduled) vs `review` (actual);
 * no dedicated column.
 *
 * `rating` check allows 0 (Rating.Manual): that is the physical enum bound,
 * kept future-proof. The 1..4 business guarantee is enforced at the API edge
 * by `reviewCardSchema`. `duration_ms` NULL means "not measured" (≠ 0).
 *
 * APPEND-ONLY — ONE EXCEPTION: `undoReview` (see `review.service.ts`) HARD
 * DELETES the row it is compensating. It is never updated, never flagged.
 * Rationale: (1) five analytics aggregations plus `admin.service.ts` and
 * `backup.service.ts` scan this table; an `undone_at` flag would need a
 * predicate in each, and a single omission silently inflates heatmap, streak,
 * study time and retention — a delete is correct everywhere by construction.
 * (2) These rows are the raw material of a future FSRS parameter optimisation,
 * where a review annotated "ignore me" is poison: the row we want is the one
 * that never existed. The invariant holds in spirit because the mutation is
 * fenced: only the LAST log of the card, matched by id against the one the
 * client was handed, graded 1..4, inside `UNDO_WINDOW_MS`, and only inside the
 * same transaction that restores the card via `fsrs.rollback`.
 */
export const reviewLog = pgTable(
  'review_log',
  {
    id: id(),
    // Denormalized owner (spec §1.1): the four analytics scans (heatmap, streaks,
    // studyTime, reviewVolume) read review_log WITHOUT joining card/deck/subject,
    // so the row carries its own user_id to stay scopable with a single index.
    userId: userId(),
    cardId: text('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),

    // --- ts-fsrs 5.4.1 ReviewLog ---
    rating: integer('rating').notNull(), // Rating 0..4
    state: integer('state').notNull(), // State before the review
    due: timestamp('due', { withTimezone: true, mode: 'date' }).notNull(), // scheduled
    stability: doublePrecision('stability').notNull(),
    difficulty: doublePrecision('difficulty').notNull(),
    elapsedDays: integer('elapsed_days').notNull(), // @deprecated
    lastElapsedDays: integer('last_elapsed_days').notNull(), // @deprecated
    scheduledDays: integer('scheduled_days').notNull(),
    learningSteps: integer('learning_steps').notNull(),
    review: timestamp('review', { withTimezone: true, mode: 'date' }).notNull(), // actual

    // --- analytics extras ---
    durationMs: integer('duration_ms'), // nullable: NULL = not measured
    createdAt: createdAt(),
  },
  (t) => [
    index('review_log_card_idx').on(t.cardId),
    index('review_log_review_idx').on(t.review),
    index('review_log_card_review_idx').on(t.cardId, t.review),
    index('review_log_user_review_idx').on(t.userId, t.review),
    check('review_log_rating_ck', sql`${t.rating} between 0 and 4`),
    check('review_log_state_ck', sql`${t.state} in (0,1,2,3)`),
  ],
)
