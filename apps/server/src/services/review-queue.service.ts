import { and, asc, count, eq, lte } from 'drizzle-orm'
import type { Card, DueCounts } from '@engram/shared'
import type { DB } from '../db/client'
import { card, deck, subject } from '../db/schema'
import { cardToDto } from '../db/dto'
import { localMidnight } from '../lib/day'

export interface QueueFilter {
  deckId?: string
  subjectId?: string
  limit: number
  now: Date
}

/** Cards due at `now` (subject not archived), optionally filtered, plus the unpaged total. */
export async function dueQueue(
  db: DB,
  userId: string,
  f: QueueFilter,
): Promise<{ total: number; cards: Card[] }> {
  const where = and(
    eq(card.userId, userId),
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

interface DueSplit {
  dueCount: number
  overdueCount: number
  todayCount: number
}
const emptySplit = (): DueSplit => ({ dueCount: 0, overdueCount: 0, todayCount: 0 })

/**
 * Due counts per subject and per deck (archived subjects excluded, zeros kept),
 * each split into backlog vs today's load (T-013).
 *
 * The cut is local midnight of `now`'s calendar day — `localMidnight(...)`, the
 * SAME convention `study_plan` and the analytics day buckets use (see
 * `lib/day.ts`: day bucketing happens in JS, in the server's local timezone,
 * never in SQL and never in UTC). A card is `overdue` when `due < todayMidnight`
 * and `today` otherwise; since the SQL already restricts to `due <= now` and
 * `now >= todayMidnight`, the two buckets partition the total exactly —
 * `dueCount === overdueCount + todayCount` always holds.
 */
export async function dueCounts(
  db: DB,
  userId: string,
  now: Date,
): Promise<Omit<DueCounts, 'now'>> {
  // `card` sits in the ON clause (with `card.due <= now`) so subjects/decks with
  // no due card survive the left join with a null card. Scope by `subject.user_id`
  // (the enumeration root); deck/card are reached only through the owned subject.
  const rows = await db
    .select({ subjectId: subject.id, deckId: deck.id, cardId: card.id, due: card.due })
    .from(subject)
    .leftJoin(deck, eq(deck.subjectId, subject.id))
    .leftJoin(card, and(eq(card.deckId, deck.id), lte(card.due, now)))
    .where(and(eq(subject.userId, userId), eq(subject.archived, false)))

  const todayMidnight = localMidnight(now.getFullYear(), now.getMonth(), now.getDate())
  const bySubjectMap = new Map<string, DueSplit>()
  const byDeckMap = new Map<string, { deckId: string; subjectId: string } & DueSplit>()
  const totals = emptySplit()

  for (const r of rows) {
    let subjectBucket = bySubjectMap.get(r.subjectId)
    if (!subjectBucket) {
      subjectBucket = emptySplit()
      bySubjectMap.set(r.subjectId, subjectBucket)
    }
    let deckBucket = r.deckId ? byDeckMap.get(r.deckId) : undefined
    if (r.deckId && !deckBucket) {
      deckBucket = { deckId: r.deckId, subjectId: r.subjectId, ...emptySplit() }
      byDeckMap.set(r.deckId, deckBucket)
    }
    if (!r.cardId || !r.deckId || !r.due) continue

    const overdue = r.due.getTime() < todayMidnight.getTime()
    for (const bucket of [totals, subjectBucket, deckBucket]) {
      if (!bucket) continue
      bucket.dueCount += 1
      if (overdue) bucket.overdueCount += 1
      else bucket.todayCount += 1
    }
  }

  return {
    total: totals.dueCount,
    overdueCount: totals.overdueCount,
    todayCount: totals.todayCount,
    bySubject: [...bySubjectMap].map(([subjectId, split]) => ({ subjectId, ...split })),
    byDeck: [...byDeckMap.values()],
  }
}
