import { asc, eq } from 'drizzle-orm'
import type { CreateDeck, Deck, UpdateDeck } from '@engram/shared'
import type { DB } from '../db/client'
import { deck } from '../db/schema'
import { deckToDto } from '../db/dto'
import { NotFoundError, ConflictError } from '../http/errors'
import { requireSubjectRow } from './subjects.service'

/** Fetch a raw deck row or throw 404. Exported for cross-service guards. */
export async function requireDeckRow(db: DB, id: string) {
  const [row] = await db.select().from(deck).where(eq(deck.id, id))
  if (!row) throw new NotFoundError(`deck ${id} not found`)
  return row
}

export async function listDecks(db: DB, subjectId?: string): Promise<Deck[]> {
  const rows = await db
    .select()
    .from(deck)
    .where(subjectId ? eq(deck.subjectId, subjectId) : undefined)
    .orderBy(asc(deck.position), asc(deck.createdAt))
  return rows.map(deckToDto)
}

export async function getDeck(db: DB, id: string): Promise<Deck> {
  return deckToDto(await requireDeckRow(db, id))
}

export async function createDeck(db: DB, input: CreateDeck): Promise<Deck> {
  // 404 if the parent subject is missing; 409 if it is archived.
  const subjectRow = await requireSubjectRow(db, input.subjectId)
  if (subjectRow.archived) {
    throw new ConflictError('cannot create a deck under an archived subject')
  }
  const [row] = await db
    .insert(deck)
    .values({
      subjectId: input.subjectId,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    .returning()
  return deckToDto(row!)
}

export async function updateDeck(db: DB, id: string, patch: UpdateDeck): Promise<Deck> {
  await requireDeckRow(db, id)
  const set = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.position !== undefined ? { position: patch.position } : {}),
  }
  if (Object.keys(set).length === 0) return getDeck(db, id) // empty body: no-op
  const [row] = await db.update(deck).set(set).where(eq(deck.id, id)).returning()
  return deckToDto(row!)
}

export async function deleteDeck(db: DB, id: string): Promise<void> {
  const res = await db.delete(deck).where(eq(deck.id, id)).returning({ id: deck.id })
  if (res.length === 0) throw new NotFoundError(`deck ${id} not found`)
}
