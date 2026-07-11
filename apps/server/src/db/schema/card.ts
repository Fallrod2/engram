import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, index, check } from 'drizzle-orm/sqlite-core'
import { id, createdAt, updatedAt } from './columns'
import { deck } from './deck'

/**
 * A flashcard. The FSRS columns mirror the ts-fsrs 5.4.1 `Card` field names
 * (snake_case in DB) so a row round-trips to/from a ts-fsrs `Card` losslessly
 * (see `mappers.ts`). Deprecated ts-fsrs fields are kept for fidelity and will
 * be dropped by a migration when we move to FSRS v6.
 */
export const card = sqliteTable(
  'card',
  {
    id: id(),
    deckId: text('deck_id')
      .notNull()
      .references(() => deck.id, { onDelete: 'cascade' }),
    front: text('front').notNull(), // Markdown recto
    back: text('back').notNull(), // Markdown verso

    // --- FSRS state (ts-fsrs 5.4.1 Card) ---
    due: integer('due', { mode: 'timestamp_ms' }).notNull(),
    stability: real('stability').notNull().default(0),
    difficulty: real('difficulty').notNull().default(0),
    elapsedDays: integer('elapsed_days').notNull().default(0), // @deprecated ts-fsrs
    scheduledDays: integer('scheduled_days').notNull().default(0),
    learningSteps: integer('learning_steps').notNull().default(0), // new in 5.4
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    state: integer('state').notNull().default(0), // State 0..3
    lastReview: integer('last_review', { mode: 'timestamp_ms' }), // nullable

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('card_deck_idx').on(t.deckId),
    index('card_due_idx').on(t.due),
    index('card_deck_due_idx').on(t.deckId, t.due),
    index('card_state_idx').on(t.state),
    check('card_state_ck', sql`${t.state} in (0,1,2,3)`),
  ],
)
