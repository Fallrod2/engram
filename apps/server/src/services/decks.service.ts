import { and, asc, count, eq } from 'drizzle-orm'
import type { CreateDeck, Deck, DeckCardCounts, UpdateDeck } from '@engram/shared'
import type { DB } from '../db/client'
import { card, deck } from '../db/schema'
import { deckToDto } from '../db/dto'
import { NotFoundError, ConflictError } from '../http/errors'
import { requireSubjectRow } from './subjects.service'

/**
 * Card totals grouped by deck in ONE query (Phase 7 §2.2), replacing the client
 * fan-out of one `limit=1` probe per deck. Scoped to `userId` via the denormalized
 * `card.user_id`. Decks with no cards produce no row — they are simply absent
 * from `byDeck`, and the client defaults them to 0.
 */
export async function cardCountsByDeck(db: DB, userId: string): Promise<DeckCardCounts> {
  const rows = await db
    .select({ deckId: card.deckId, cardCount: count(card.id) })
    .from(card)
    .where(eq(card.userId, userId))
    .groupBy(card.deckId)
  return { byDeck: rows.map((r) => ({ deckId: r.deckId, cardCount: r.cardCount })) }
}

/** Fetch a raw deck row (scoped to `userId`) or throw 404. Exported for guards. */
export async function requireDeckRow(db: DB, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(deck)
    .where(and(eq(deck.id, id), eq(deck.userId, userId)))
  if (!row) throw new NotFoundError(`deck ${id} not found`)
  return row
}

export async function listDecks(db: DB, userId: string, subjectId?: string): Promise<Deck[]> {
  const rows = await db
    .select()
    .from(deck)
    .where(
      subjectId
        ? and(eq(deck.userId, userId), eq(deck.subjectId, subjectId))
        : eq(deck.userId, userId),
    )
    .orderBy(asc(deck.position), asc(deck.createdAt))
  return rows.map(deckToDto)
}

export async function getDeck(db: DB, userId: string, id: string): Promise<Deck> {
  return deckToDto(await requireDeckRow(db, userId, id))
}

export async function createDeck(db: DB, userId: string, input: CreateDeck): Promise<Deck> {
  // 404 if the parent subject is missing (or owned by another user); 409 if archived.
  const subjectRow = await requireSubjectRow(db, userId, input.subjectId)
  if (subjectRow.archived) {
    throw new ConflictError('cannot create a deck under an archived subject')
  }
  const [row] = await db
    .insert(deck)
    .values({
      userId,
      subjectId: input.subjectId,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    .returning()
  return deckToDto(row!)
}

export async function updateDeck(
  db: DB,
  userId: string,
  id: string,
  patch: UpdateDeck,
): Promise<Deck> {
  await requireDeckRow(db, userId, id)
  const set = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.position !== undefined ? { position: patch.position } : {}),
  }
  if (Object.keys(set).length === 0) return getDeck(db, userId, id) // empty body: no-op
  const [row] = await db
    .update(deck)
    .set(set)
    .where(and(eq(deck.id, id), eq(deck.userId, userId)))
    .returning()
  return deckToDto(row!)
}

export async function deleteDeck(db: DB, userId: string, id: string): Promise<void> {
  const res = await db
    .delete(deck)
    .where(and(eq(deck.id, id), eq(deck.userId, userId)))
    .returning({ id: deck.id })
  if (res.length === 0) throw new NotFoundError(`deck ${id} not found`)
}
