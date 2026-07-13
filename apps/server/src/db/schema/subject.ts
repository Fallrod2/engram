import { pgTable, text, integer, boolean, index } from 'drizzle-orm/pg-core'
import { id, userId, createdAt, updatedAt } from './columns'

export const subject = pgTable(
  'subject',
  {
    id: id(),
    userId: userId(),
    name: text('name').notNull(),
    color: text('color').notNull(), // '#rrggbb' (validated by Zod)
    icon: text('icon').notNull(), // lucide icon id, e.g. 'book-open'
    position: integer('position').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('subject_user_idx').on(t.userId),
    index('subject_archived_idx').on(t.archived),
    index('subject_position_idx').on(t.position),
  ],
)
