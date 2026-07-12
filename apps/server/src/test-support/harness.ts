import { createEmptyCard } from 'ts-fsrs'
import type { DB } from '../db/client'
import { card, deck, exam, examSubject, generation, note, reviewLog, subject } from '../db/schema'
import { fsrsCardToColumns } from '../db/mappers'
import { localMidnight } from '../lib/day'

/**
 * Shared seeding/reset helpers for the bun:sqlite integration specs. All
 * functions take an explicit `db` so they work both against a per-test
 * `createTestDb()` handle and against the singleton used by route specs.
 */

/** Delete every row (child tables first) so each test starts clean. */
export function resetDb(db: DB): void {
  db.delete(examSubject).run()
  db.delete(exam).run()
  db.delete(reviewLog).run()
  db.delete(card).run()
  db.delete(generation).run()
  db.delete(note).run()
  db.delete(deck).run()
  db.delete(subject).run()
}

export function seedSubject(
  db: DB,
  o: { name?: string; color?: string; icon?: string; archived?: boolean; position?: number } = {},
) {
  return db
    .insert(subject)
    .values({
      name: o.name ?? 'Subject',
      color: o.color ?? '#3b82f6',
      icon: o.icon ?? 'book',
      ...(o.archived !== undefined ? { archived: o.archived } : {}),
      ...(o.position !== undefined ? { position: o.position } : {}),
    })
    .returning()
    .get()
}

export function seedDeck(
  db: DB,
  subjectId: string,
  o: { name?: string; description?: string; position?: number } = {},
) {
  return db
    .insert(deck)
    .values({
      subjectId,
      name: o.name ?? 'Deck',
      ...(o.description !== undefined ? { description: o.description } : {}),
      ...(o.position !== undefined ? { position: o.position } : {}),
    })
    .returning()
    .get()
}

export function seedCard(
  db: DB,
  deckId: string,
  o: { front?: string; back?: string; due?: Date } = {},
) {
  const cols = fsrsCardToColumns(createEmptyCard(new Date()))
  return db
    .insert(card)
    .values({
      deckId,
      front: o.front ?? '# Q',
      back: o.back ?? '# A',
      ...cols,
      ...(o.due !== undefined ? { due: o.due } : {}),
    })
    .returning()
    .get()
}

/**
 * Insert a review_log row directly (bypassing FSRS) so tests can drive
 * `state`/`rating`/`review`/`durationMs` freely. FSRS-only columns are 0 (the
 * analytics domain reads none of them). `durationMs` omitted → NULL column
 * (lets tests exercise the "not measured ≠ 0" contract).
 */
export function seedReviewLog(
  db: DB,
  cardId: string,
  o: { rating?: number; state?: number; review?: Date; durationMs?: number | null } = {},
) {
  const when = o.review ?? new Date()
  return db
    .insert(reviewLog)
    .values({
      cardId,
      rating: o.rating ?? 3,
      state: o.state ?? 2, // Review by default
      due: when,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      lastElapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      review: when,
      ...(o.durationMs !== undefined ? { durationMs: o.durationMs } : {}),
    })
    .returning()
    .get()
}

export function seedExam(
  db: DB,
  subjectIds: string[],
  o: { title?: string; date?: Date; notes?: string } = {},
) {
  const now = new Date()
  const row = db
    .insert(exam)
    .values({
      title: o.title ?? 'Exam',
      date: o.date ?? localMidnight(now.getFullYear(), now.getMonth(), now.getDate()),
      ...(o.notes !== undefined ? { notes: o.notes } : {}),
    })
    .returning()
    .get()
  for (const subjectId of [...new Set(subjectIds)]) {
    db.insert(examSubject).values({ examId: row.id, subjectId }).run()
  }
  return row
}
