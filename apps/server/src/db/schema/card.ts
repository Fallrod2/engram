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
import { id, userId, createdAt, updatedAt } from './columns'
import { deck } from './deck'
import { foldSql } from '../fold'

/**
 * A flashcard. The FSRS columns mirror the ts-fsrs 5.4.1 `Card` field names
 * (snake_case in DB) so a row round-trips to/from a ts-fsrs `Card` losslessly
 * (see `mappers.ts`). Deprecated ts-fsrs fields are kept for fidelity and will
 * be dropped by a migration when we move to FSRS v6.
 */
export const card = pgTable(
  'card',
  {
    id: id(),
    userId: userId(),
    deckId: text('deck_id')
      .notNull()
      .references(() => deck.id, { onDelete: 'cascade' }),
    front: text('front').notNull(), // Markdown recto
    back: text('back').notNull(), // Markdown verso

    /**
     * Case- and accent-folded mirrors of `front`/`back`, maintained by Postgres
     * itself (GENERATED ALWAYS … STORED) — never written by the application.
     *
     * They exist for one MEASURED reason. Folding at query time means running a
     * 260-character `translate()` over every row of the caller's corpus on every
     * keystroke: on 5 000 cards that is 744 ms (PGlite) / ~1.5 s (Postgres 17),
     * because `translate` costs O(len(text) × len(table)) per call and the search
     * touches two columns. Reading a pre-folded column instead is 2.4 ms — the
     * fold is paid once, at write time, on one row.
     *
     * There is deliberately NO INDEX on them: the search is a substring match
     * (`LIKE '%x%'`), which no core-Postgres index can serve. `pg_trgm` would,
     * and is exactly as unavailable in a bare PGlite as `unaccent` — see
     * `db/fold.ts`. At 2.4 ms per query for a corpus far above the realistic one
     * that trade is not close; the day it stops being true, a GIN trigram index
     * on these two columns is the upgrade, and it needs no code change.
     *
     * ⚠️ The folding expression is FROZEN INTO THE DDL by migration 0012. Editing
     * `FOLD_FROM`/`FOLD_TO` in `db/fold.ts` does NOT re-fold existing rows — it
     * needs a migration that drops and re-adds these columns. `card-search.spec.ts`
     * fails loudly if the two ever disagree.
     */
    frontFold: text('front_fold')
      .notNull()
      .generatedAlwaysAs(() => foldSql(sql`front`)),
    backFold: text('back_fold')
      .notNull()
      .generatedAlwaysAs(() => foldSql(sql`back`)),

    // --- FSRS state (ts-fsrs 5.4.1 Card) ---
    due: timestamp('due', { withTimezone: true, mode: 'date' }).notNull(),
    stability: doublePrecision('stability').notNull().default(0),
    difficulty: doublePrecision('difficulty').notNull().default(0),
    elapsedDays: integer('elapsed_days').notNull().default(0), // @deprecated ts-fsrs
    scheduledDays: integer('scheduled_days').notNull().default(0),
    learningSteps: integer('learning_steps').notNull().default(0), // new in 5.4
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    state: integer('state').notNull().default(0), // State 0..3
    lastReview: timestamp('last_review', { withTimezone: true, mode: 'date' }), // nullable

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('card_deck_idx').on(t.deckId),
    // The due-queue scan is now scoped by user first, so the lead column is user_id
    // (replaces the old card_due_idx on due alone).
    index('card_user_due_idx').on(t.userId, t.due),
    index('card_deck_due_idx').on(t.deckId, t.due),
    index('card_state_idx').on(t.state),
    check('card_state_ck', sql`${t.state} in (0,1,2,3)`),
  ],
)
