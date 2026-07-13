import { sql } from 'drizzle-orm'
import { pgTable, text, index, check } from 'drizzle-orm/pg-core'
import { id, createdAt, updatedAt } from './columns'
import { subject } from './subject'

/**
 * An imported document (MD/PDF/image). `subject_id` is nullable and set-null on
 * subject deletion: importing/extracting can happen before categorization,
 * and a note must survive its subject being removed.
 */
export const note = pgTable(
  'note',
  {
    id: id(),
    subjectId: text('subject_id').references(() => subject.id, {
      onDelete: 'set null',
    }), // nullable
    title: text('title').notNull(),
    sourceType: text('source_type').notNull(), // 'md' | 'pdf' | 'image'
    originalFilename: text('original_filename'), // nullable
    content: text('content').notNull(), // extracted text
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('note_subject_idx').on(t.subjectId),
    check('note_source_type_ck', sql`${t.sourceType} in ('md','pdf','image')`),
  ],
)
