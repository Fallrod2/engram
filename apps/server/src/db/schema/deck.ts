import { pgTable, text, integer, index } from 'drizzle-orm/pg-core'
import { id, userId, createdAt, updatedAt } from './columns'
import { subject } from './subject'

export const deck = pgTable(
  'deck',
  {
    id: id(),
    userId: userId(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subject.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'), // nullable
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('deck_subject_idx').on(t.subjectId), index('deck_user_idx').on(t.userId)],
)
