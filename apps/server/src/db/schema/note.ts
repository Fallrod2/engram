import { sql } from 'drizzle-orm'
import { pgTable, text, index, check } from 'drizzle-orm/pg-core'
import { id, userId, createdAt, updatedAt } from './columns'
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
    // Own user_id (spec §1.1): subject_id is nullable/set-null, so a note must
    // carry its own owner to survive its subject being removed.
    userId: userId(),
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
    index('note_user_idx').on(t.userId),
    check('note_source_type_ck', sql`${t.sourceType} in ('md','pdf','image')`),
  ],
)
