import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, index, check } from 'drizzle-orm/sqlite-core'
import { id, createdAt } from './columns'
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
 */
export const reviewLog = sqliteTable(
  'review_log',
  {
    id: id(),
    cardId: text('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),

    // --- ts-fsrs 5.4.1 ReviewLog ---
    rating: integer('rating').notNull(), // Rating 0..4
    state: integer('state').notNull(), // State before the review
    due: integer('due', { mode: 'timestamp_ms' }).notNull(), // scheduled
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    elapsedDays: integer('elapsed_days').notNull(), // @deprecated
    lastElapsedDays: integer('last_elapsed_days').notNull(), // @deprecated
    scheduledDays: integer('scheduled_days').notNull(),
    learningSteps: integer('learning_steps').notNull(),
    review: integer('review', { mode: 'timestamp_ms' }).notNull(), // actual

    // --- analytics extras ---
    durationMs: integer('duration_ms'), // nullable: NULL = not measured
    createdAt: createdAt(),
  },
  (t) => [
    index('review_log_card_idx').on(t.cardId),
    index('review_log_review_idx').on(t.review),
    index('review_log_card_review_idx').on(t.cardId, t.review),
    check('review_log_rating_ck', sql`${t.rating} between 0 and 4`),
    check('review_log_state_ck', sql`${t.state} in (0,1,2,3)`),
  ],
)
