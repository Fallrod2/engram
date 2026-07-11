import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { id, createdAt, updatedAt } from './columns'

export const subject = sqliteTable(
  'subject',
  {
    id: id(),
    name: text('name').notNull(),
    color: text('color').notNull(), // '#rrggbb' (validated by Zod)
    icon: text('icon').notNull(), // lucide icon id, e.g. 'book-open'
    position: integer('position').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('subject_archived_idx').on(t.archived),
    index('subject_position_idx').on(t.position),
  ],
)
