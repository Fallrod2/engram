import { and, asc, count, eq, lte } from 'drizzle-orm'
import type { Card, DueCounts } from '@engram/shared'
import type { DB } from '../db/client'
import { card, deck, subject } from '../db/schema'
import { cardToDto } from '../db/dto'

export interface QueueFilter {
  deckId?: string
  subjectId?: string
  limit: number
  now: Date
}

/** Cards due at `now` (subject not archived), optionally filtered, plus the unpaged total. */
export async function dueQueue(db: DB, f: QueueFilter): Promise<{ total: number; cards: Card[] }> {
  const where = and(
    lte(card.due, f.now),
    eq(subject.archived, false),
    f.deckId ? eq(card.deckId, f.deckId) : undefined,
    f.subjectId ? eq(subject.id, f.subjectId) : undefined,
  )
  const [totalRow] = await db
    .select({ n: count() })
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .innerJoin(subject, eq(subject.id, deck.subjectId))
    .where(where)
  const total = totalRow?.n ?? 0

  const rows = await db
    .select()
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .innerJoin(subject, eq(subject.id, deck.subjectId))
    .where(where)
    .orderBy(asc(card.due), asc(card.createdAt))
    .limit(f.limit)

  return { total, cards: rows.map((r) => cardToDto(r.card)) }
}

/** Due counts per subject and per deck (archived subjects excluded, zeros kept). */
export async function dueCounts(db: DB, now: Date): Promise<Omit<DueCounts, 'now'>> {
  // `card` sits in the ON clause (with `card.due <= now`) so subjects/decks with
  // no due card survive the left join with a null card.
  const rows = await db
    .select({ subjectId: subject.id, deckId: deck.id, cardId: card.id })
    .from(subject)
    .leftJoin(deck, eq(deck.subjectId, subject.id))
    .leftJoin(card, and(eq(card.deckId, deck.id), lte(card.due, now)))
    .where(eq(subject.archived, false))

  const bySubjectMap = new Map<string, number>()
  const byDeckMap = new Map<string, { deckId: string; subjectId: string; dueCount: number }>()
  let total = 0

  for (const r of rows) {
    if (!bySubjectMap.has(r.subjectId)) bySubjectMap.set(r.subjectId, 0)
    if (r.deckId && !byDeckMap.has(r.deckId)) {
      byDeckMap.set(r.deckId, { deckId: r.deckId, subjectId: r.subjectId, dueCount: 0 })
    }
    if (r.cardId && r.deckId) {
      total += 1
      bySubjectMap.set(r.subjectId, (bySubjectMap.get(r.subjectId) ?? 0) + 1)
      const bucket = byDeckMap.get(r.deckId)
      if (bucket) bucket.dueCount += 1
    }
  }

  return {
    total,
    bySubject: [...bySubjectMap].map(([subjectId, dueCount]) => ({ subjectId, dueCount })),
    byDeck: [...byDeckMap.values()],
  }
}
