import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core'
import type { GenerationItem } from '@engram/shared'
import { id, createdAt, updatedAt } from './columns'
import { note } from './note'
import { deck } from './deck'

/**
 * A trace of one AI generation run. Per-card accept/reject/edit status is held
 * in the JSON `items` buffer (typed by the shared `GenerationItem` contract) —
 * an ephemeral review buffer, so a dedicated `generation_item` table is not
 * warranted for a single-user local app.
 */
export const generation = sqliteTable(
  'generation',
  {
    id: id(),
    noteId: text('note_id')
      .notNull()
      .references(() => note.id, { onDelete: 'cascade' }),
    deckId: text('deck_id').references(() => deck.id, { onDelete: 'set null' }), // nullable
    kind: text('kind').notNull(), // 'cards' | 'quiz'
    status: text('status').notNull().default('pending'), // 'pending' | 'succeeded' | 'failed'
    model: text('model').notNull(), // e.g. 'claude-sonnet-4-6'
    items: text('items', { mode: 'json' })
      .$type<GenerationItem[]>()
      .notNull()
      .$defaultFn(() => []),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('generation_note_idx').on(t.noteId),
    index('generation_deck_idx').on(t.deckId),
    check('generation_kind_ck', sql`${t.kind} in ('cards','quiz')`),
    check('generation_status_ck', sql`${t.status} in ('pending','succeeded','failed')`),
  ],
)
