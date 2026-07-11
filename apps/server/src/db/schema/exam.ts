import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core'
import { id, createdAt, updatedAt } from './columns'
import { subject } from './subject'

/**
 * A dated deadline. `date` stores an instant in epoch-ms, by convention set to
 * local midnight of the exam day (`new Date(y, mIdx, d)`); the countdown is
 * derived by comparing local calendar days, not by raw ms subtraction.
 */
export const exam = sqliteTable(
  'exam',
  {
    id: id(),
    title: text('title').notNull(),
    date: integer('date', { mode: 'timestamp_ms' }).notNull(),
    notes: text('notes'), // nullable
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('exam_date_idx').on(t.date)],
)

/** M2M junction between `exam` and `subject` (append-only). */
export const examSubject = sqliteTable(
  'exam_subject',
  {
    examId: text('exam_id')
      .notNull()
      .references(() => exam.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subject.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.examId, t.subjectId] }),
    index('exam_subject_subject_idx').on(t.subjectId),
  ],
)
