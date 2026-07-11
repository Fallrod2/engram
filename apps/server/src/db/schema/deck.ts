import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { id, createdAt, updatedAt } from './columns'
import { subject } from './subject'

export const deck = sqliteTable(
  'deck',
  {
    id: id(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subject.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'), // nullable
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('deck_subject_idx').on(t.subjectId)],
)
