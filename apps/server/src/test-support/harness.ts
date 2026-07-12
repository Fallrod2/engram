import { createEmptyCard } from 'ts-fsrs'
import type { DB } from '../db/client'
import { card, deck, exam, examSubject, generation, note, reviewLog, subject } from '../db/schema'
import { fsrsCardToColumns } from '../db/mappers'
import { localMidnight } from '../lib/day'

/**
 * Shared async seeding/reset helpers for the integration specs. All functions
 * take an explicit `db` so they work both against a per-test `createTestDb()`
 * handle and against the singleton used by the route specs.
 */

/** Delete every row (child tables first) so each test starts clean. */
export async function resetDb(db: DB): Promise<void> {
  await db.delete(examSubject)
  await db.delete(exam)
  await db.delete(reviewLog)
  await db.delete(card)
  await db.delete(generation)
  await db.delete(note)
  await db.delete(deck)
  await db.delete(subject)
}

export async function seedSubject(
  db: DB,
  o: { name?: string; color?: string; icon?: string; archived?: boolean; position?: number } = {},
) {
  const [row] = await db
    .insert(subject)
    .values({
      name: o.name ?? 'Subject',
      color: o.color ?? '#3b82f6',
      icon: o.icon ?? 'book',
      ...(o.archived !== undefined ? { archived: o.archived } : {}),
      ...(o.position !== undefined ? { position: o.position } : {}),
    })
    .returning()
  return row!
}

export async function seedDeck(
  db: DB,
  subjectId: string,
  o: { name?: string; description?: string; position?: number } = {},
) {
  const [row] = await db
    .insert(deck)
    .values({
      subjectId,
      name: o.name ?? 'Deck',
      ...(o.description !== undefined ? { description: o.description } : {}),
      ...(o.position !== undefined ? { position: o.position } : {}),
    })
    .returning()
  return row!
}

export async function seedCard(
  db: DB,
  deckId: string,
  o: { front?: string; back?: string; due?: Date } = {},
) {
  const cols = fsrsCardToColumns(createEmptyCard(new Date()))
  const [row] = await db
    .insert(card)
    .values({
      deckId,
      front: o.front ?? '# Q',
      back: o.back ?? '# A',
      ...cols,
      ...(o.due !== undefined ? { due: o.due } : {}),
    })
    .returning()
  return row!
}

/**
 * Insert a review_log row directly (bypassing FSRS) so tests can drive
 * `state`/`rating`/`review`/`durationMs` freely. FSRS-only columns are 0 (the
 * analytics domain reads none of them). `durationMs` omitted → NULL column
 * (lets tests exercise the "not measured ≠ 0" contract).
 */
export async function seedReviewLog(
  db: DB,
  cardId: string,
  o: { rating?: number; state?: number; review?: Date; durationMs?: number | null } = {},
) {
  const when = o.review ?? new Date()
  const [row] = await db
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
  return row!
}

export async function seedExam(
  db: DB,
  subjectIds: string[],
  o: { title?: string; date?: Date; notes?: string } = {},
) {
  const now = new Date()
  const [row] = await db
    .insert(exam)
    .values({
      title: o.title ?? 'Exam',
      date: o.date ?? localMidnight(now.getFullYear(), now.getMonth(), now.getDate()),
      ...(o.notes !== undefined ? { notes: o.notes } : {}),
    })
    .returning()
  for (const subjectId of [...new Set(subjectIds)]) {
    await db.insert(examSubject).values({ examId: row!.id, subjectId })
  }
  return row!
}
