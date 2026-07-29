import { and, asc, eq, lte, ne, sql, type SQL } from 'drizzle-orm'
import { State } from 'ts-fsrs'
import type { Card, DueCounts, QueueNewCards } from '@engram/shared'
import type { DB } from '../db/client'
import { card, deck, subject } from '../db/schema'
import { cardToDto } from '../db/dto'
import { localMidnight } from '../lib/day'
import { newCardBudget } from './study-settings.service'

export interface QueueFilter {
  deckId?: string
  subjectId?: string
  limit: number
  now: Date
}

export interface DueQueueResult {
  /** Unpaged size of the queue AS OFFERED: due cards + the new cards still allowed. */
  total: number
  cards: Card[]
  newCards: QueueNewCards
}

type CardRow = typeof card.$inferSelect

/** One page of the queue, restricted to `extra` (new vs already-seen). */
async function selectPage(db: DB, where: SQL | undefined, limit: number): Promise<CardRow[]> {
  if (limit <= 0) return []
  const rows = await db
    .select()
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .innerJoin(subject, eq(subject.id, deck.subjectId))
    .where(where)
    .orderBy(asc(card.due), asc(card.createdAt))
    .limit(limit)
  return rows.map((r) => r.card)
}

/**
 * Cards due at `now` (subject not archived), optionally filtered, capped by the
 * caller's DAILY NEW-CARD BUDGET.
 *
 * THE CAP APPLIES TO NEVER-SEEN CARDS ONLY (`State.New`). A card that is DUE is
 * handed out whatever the limit is, including when the limit is 0: a due card
 * that goes unreviewed does not politely wait, it accumulates and its schedule
 * degrades — throttling it would be an actively harmful bug, not a stricter
 * setting. The budget only decides how many cards ENTER the rotation today.
 *
 * This is also the ONLY place the limit is enforced. `reviewCard` deliberately
 * does not check it: the limit paces the hand-out, it is not an authorization,
 * and rejecting a grade the user already gave would throw away their answer and
 * leave the card in a state its own log contradicts.
 *
 * Two queries instead of one because the two populations have independent caps
 * (`f.limit` for the page, the daily budget for the new ones); they are merged
 * back into the single global order `due ASC, created_at ASC`. On an exact tie
 * the already-seen card wins — clearing the backlog before opening a new front
 * is the right default, and `Array.prototype.sort` is stable, so putting the due
 * rows first in the concatenation is what states it.
 */
export async function dueQueue(db: DB, userId: string, f: QueueFilter): Promise<DueQueueResult> {
  const where = and(
    eq(card.userId, userId),
    lte(card.due, f.now),
    eq(subject.archived, false),
    f.deckId ? eq(card.deckId, f.deckId) : undefined,
    f.subjectId ? eq(subject.id, f.subjectId) : undefined,
  )

  const [split, budget] = await Promise.all([
    dueSplitCounts(db, where),
    newCardBudget(db, userId, f.now),
  ])

  const allowedNew = Math.min(budget.remaining, split.newCount)
  const withheld = split.newCount - allowedNew

  const seenRows = await selectPage(db, and(where, ne(card.state, State.New)), f.limit)
  const newRows = await selectPage(
    db,
    and(where, eq(card.state, State.New)),
    Math.min(allowedNew, f.limit),
  )

  const merged = [...seenRows, ...newRows]
    .sort(
      (a, b) => a.due.getTime() - b.due.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .slice(0, f.limit)

  return {
    total: split.seenCount + allowedNew,
    cards: merged.map(cardToDto),
    newCards: {
      limit: budget.limit,
      introduced: budget.introduced,
      remaining: budget.remaining,
      withheld,
    },
  }
}

/**
 * The eligible population split in one pass: never-seen vs already-seen. A
 * single grouped scan (`FILTER`) rather than two `count()` round-trips — the
 * predicate is identical, only the bucket differs.
 */
async function dueSplitCounts(
  db: DB,
  where: SQL | undefined,
): Promise<{ newCount: number; seenCount: number }> {
  const [row] = await db
    .select({
      newCount: sql<number>`count(*) filter (where ${card.state} = ${State.New})`.mapWith(Number),
      seenCount: sql<number>`count(*) filter (where ${card.state} <> ${State.New})`.mapWith(Number),
    })
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .innerJoin(subject, eq(subject.id, deck.subjectId))
    .where(where)
  return { newCount: row?.newCount ?? 0, seenCount: row?.seenCount ?? 0 }
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
