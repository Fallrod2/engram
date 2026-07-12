import { createEmptyCard } from 'ts-fsrs'
import type { DB } from '../db/client'
import { card, deck, generation, note, reviewLog, subject } from '../db/schema'
import { fsrsCardToColumns } from '../db/mappers'

/**
 * Shared seeding/reset helpers for the bun:sqlite integration specs. All
 * functions take an explicit `db` so they work both against a per-test
 * `createTestDb()` handle and against the singleton used by route specs.
 */

/** Delete every row (child tables first) so each test starts clean. */
export function resetDb(db: DB): void {
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
