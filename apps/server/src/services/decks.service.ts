import { asc, eq } from 'drizzle-orm'
import type { CreateDeck, Deck, UpdateDeck } from '@engram/shared'
import type { DB } from '../db/client'
import { deck } from '../db/schema'
import { deckToDto } from '../db/dto'
import { NotFoundError, ConflictError } from '../http/errors'
import { requireSubjectRow } from './subjects.service'

/** Fetch a raw deck row or throw 404. Exported for cross-service guards. */
export function requireDeckRow(db: DB, id: string) {
  const row = db.select().from(deck).where(eq(deck.id, id)).get()
  if (!row) throw new NotFoundError(`deck ${id} not found`)
  return row
}

export function listDecks(db: DB, subjectId?: string): Deck[] {
  const rows = db
    .select()
    .from(deck)
    .where(subjectId ? eq(deck.subjectId, subjectId) : undefined)
    .orderBy(asc(deck.position), asc(deck.createdAt))
    .all()
  return rows.map(deckToDto)
}

export function getDeck(db: DB, id: string): Deck {
  return deckToDto(requireDeckRow(db, id))
}

export function createDeck(db: DB, input: CreateDeck): Deck {
  // 404 if the parent subject is missing; 409 if it is archived.
  const subjectRow = requireSubjectRow(db, input.subjectId)
  if (subjectRow.archived) {
    throw new ConflictError('cannot create a deck under an archived subject')
  }
  const row = db
    .insert(deck)
    .values({
      subjectId: input.subjectId,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    .returning()
    .get()
  return deckToDto(row)
}

export function updateDeck(db: DB, id: string, patch: UpdateDeck): Deck {
  requireDeckRow(db, id)
  const set = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.position !== undefined ? { position: patch.position } : {}),
  }
  if (Object.keys(set).length === 0) return getDeck(db, id) // empty body: no-op
  const row = db.update(deck).set(set).where(eq(deck.id, id)).returning().get()
  return deckToDto(row)
}

export function deleteDeck(db: DB, id: string): void {
  const res = db.delete(deck).where(eq(deck.id, id)).returning({ id: deck.id }).all()
  if (res.length === 0) throw new NotFoundError(`deck ${id} not found`)
}
