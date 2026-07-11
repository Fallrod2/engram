import { sql } from 'drizzle-orm'
import { sqliteTable, text, index, check } from 'drizzle-orm/sqlite-core'
import { id, createdAt, updatedAt } from './columns'
import { subject } from './subject'

/**
 * An imported document (MD/PDF). `subject_id` is nullable and set-null on
 * subject deletion: importing/extracting can happen before categorization,
 * and a note must survive its subject being removed.
 */
export const note = sqliteTable(
  'note',
  {
    id: id(),
    subjectId: text('subject_id').references(() => subject.id, {
      onDelete: 'set null',
    }), // nullable
    title: text('title').notNull(),
    sourceType: text('source_type').notNull(), // 'md' | 'pdf'
    originalFilename: text('original_filename'), // nullable
    content: text('content').notNull(), // extracted text
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('note_subject_idx').on(t.subjectId),
    check('note_source_type_ck', sql`${t.sourceType} in ('md','pdf')`),
  ],
)
