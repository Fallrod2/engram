import { pgTable, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core'
import { id, userId, createdAt, updatedAt } from './columns'
import { subject } from './subject'

/**
 * A dated deadline. `date` stores an instant (timestamptz), by convention set
 * to local midnight of the exam day (`new Date(y, mIdx, d)`); the countdown is
 * derived by comparing local calendar days, not by raw ms subtraction.
 */
export const exam = pgTable(
  'exam',
  {
    id: id(),
    // Own user_id (spec §1.1): exam is a root with no subject FK, so it must
    // carry its own owner. exam_subject (junction) has none — its ownership is
    // guaranteed by the application check that both exam AND subject belong here.
    userId: userId(),
    title: text('title').notNull(),
    date: timestamp('date', { withTimezone: true, mode: 'date' }).notNull(),
    notes: text('notes'), // nullable
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('exam_date_idx').on(t.date), index('exam_user_date_idx').on(t.userId, t.date)],
)

/** M2M junction between `exam` and `subject` (append-only). */
export const examSubject = pgTable(
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
