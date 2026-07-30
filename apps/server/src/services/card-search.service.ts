import { and, asc, count, eq, inArray, lt, or, sql } from 'drizzle-orm'
import {
  FSRS_STATE_BY_NAME,
  type BulkCardResult,
  type FsrsStateName,
  type SearchCardsResponse,
} from '@engram/shared'
import type { DB, Tx } from '../db/client'
import { card, deck, subject } from '../db/schema'
import { cardToDto } from '../db/dto'
import { foldedLike } from '../db/fold'
import { localMidnight } from '../lib/day'
import { ConflictError, NotFoundError } from '../http/errors'

export interface CardSearchFilter {
  /** Raw needle. Trimmed here; empty/whitespace-only drops the text predicate. */
  q: string
  subjectId?: string
  deckId?: string
  state?: FsrsStateName
  overdue?: boolean
  limit: number
  offset: number
  /** Injected so tests pin the local-midnight cut of `overdue`. */
  now: Date
}

/**
 * Full-text-ish content search over the caller's cards.
 *
 * SCOPING. `card.user_id` is the enumeration root, and `subject.user_id` is
 * asserted a SECOND time on purpose. The join exists to return the deck and
 * subject NAMES inline, i.e. this endpoint emits data from three tables; scoping
 * only the card would mean that a single inconsistent row (a card whose deck was
 * somehow re-parented) leaks another tenant's subject name. Two equality
 * predicates on indexed columns cost nothing and make the leak unrepresentable.
 *
 * OVERDUE reuses the project's ONE definition of the word (`dueCounts`, and the
 * comment in `lib/day.ts`): `due < local midnight of today`. The bound is
 * computed in JS from local `Date` components and compared as an instant —
 * never `date_trunc` in SQL, which would silently apply UTC or the database's
 * timezone and misfile every card due in the first or last hours of the day.
 *
 * ORDERING is deterministic, or pagination would shuffle rows between pages:
 * front-matches first (the front is the question — that is the result the user
 * meant), then oldest first, then `id` to break the remaining ties. With an
 * empty needle the first key is constant and the order degenerates cleanly to
 * `created_at, id`.
 */
export async function searchCards(
  db: DB,
  userId: string,
  f: CardSearchFilter,
): Promise<SearchCardsResponse> {
  const needle = f.q.trim()
  const midnight = localMidnight(f.now.getFullYear(), f.now.getMonth(), f.now.getDate())

  const where = and(
    eq(card.userId, userId),
    eq(subject.userId, userId), // defence in depth, see the note above
    needle ? or(foldedLike(card.frontFold, needle), foldedLike(card.backFold, needle)) : undefined,
    f.deckId ? eq(card.deckId, f.deckId) : undefined,
    f.subjectId ? eq(subject.id, f.subjectId) : undefined,
    f.state ? eq(card.state, FSRS_STATE_BY_NAME[f.state]) : undefined,
    f.overdue ? lt(card.due, midnight) : undefined,
  )

  const [totalRow] = await db
    .select({ n: count() })
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .innerJoin(subject, eq(subject.id, deck.subjectId))
    .where(where)

  // Front-matches first. OMITTED rather than replaced by a constant when there
  // is no needle: a bare `order by 0` is read by Postgres as ORDINAL POSITION
  // zero, not as the number 0, and errors with 42P10.
  const orderBy = needle
    ? [
        sql`case when ${foldedLike(card.frontFold, needle)} then 0 else 1 end`,
        asc(card.createdAt),
        asc(card.id),
      ]
    : [asc(card.createdAt), asc(card.id)]

  const rows = await db
    .select({
      // Explicit column list rather than the whole `card` row: `front_fold` /
      // `back_fold` duplicate the card's entire text, and there is no reason to
      // pull them back over the wire — they exist to be matched in the database,
      // not to be read.
      card: {
        id: card.id,
        deckId: card.deckId,
        front: card.front,
        back: card.back,
        due: card.due,
        stability: card.stability,
        difficulty: card.difficulty,
        elapsedDays: card.elapsedDays,
        scheduledDays: card.scheduledDays,
        learningSteps: card.learningSteps,
        reps: card.reps,
        lapses: card.lapses,
        state: card.state,
        lastReview: card.lastReview,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      },
      deckId: deck.id,
      deckName: deck.name,
      subjectId: subject.id,
      subjectName: subject.name,
      subjectColor: subject.color,
      subjectIcon: subject.icon,
      subjectArchived: subject.archived,
    })
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .innerJoin(subject, eq(subject.id, deck.subjectId))
    .where(where)
    .orderBy(...orderBy)
    .limit(f.limit)
    .offset(f.offset)

  return {
    total: totalRow?.n ?? 0,
    query: needle,
    limit: f.limit,
    offset: f.offset,
    hits: rows.map((r) => ({
      card: cardToDto(r.card),
      deck: { id: r.deckId, name: r.deckName },
      subject: {
        id: r.subjectId,
        name: r.subjectName,
        color: r.subjectColor,
        icon: r.subjectIcon,
        archived: r.subjectArchived,
      },
    })),
  }
}

// --- Bulk operations -------------------------------------------------------

/**
 * De-duplicate while preserving order. A multi-select UI merging two pages can
 * legitimately send the same id twice; that is not an error, but it must not be
 * counted twice in `affected` either.
 */
function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}

/**
 * Assert that EVERY id is an existing card of `userId`, inside the caller's
 * transaction. Anything else — a foreign card, a deleted card, a typo — aborts
 * the whole batch with 404 and writes nothing.
 *
 * ALL-OR-NOTHING IS THE POINT. Skipping the ids we do not own and reporting a
 * smaller count would make "delete these 50 cards" quietly delete 49, and a
 * half-done move is worse than a refused one. 404 (never 403) also keeps the
 * house anti-enumeration rule: a card belonging to someone else is
 * indistinguishable from a card that does not exist.
 */
async function assertOwnedCards(tx: DB | Tx, userId: string, ids: string[]): Promise<void> {
  const rows = await tx
    .select({ id: card.id })
    .from(card)
    .where(and(eq(card.userId, userId), inArray(card.id, ids)))
  if (rows.length !== ids.length) {
    const found = new Set(rows.map((r) => r.id))
    const missing = ids.filter((id) => !found.has(id))
    throw new NotFoundError(
      `${missing.length} of ${ids.length} cards not found: ${missing.slice(0, 5).join(', ')}`,
    )
  }
}

/**
 * Delete a batch of the caller's cards atomically (review logs cascade).
 *
 * An EMPTY batch is a no-op returning `{0, 0}`, not an error: the size floor is
 * a contract concern and it is enforced at the edge by `bulkCardIdsSchema`
 * (400), so re-throwing here would only duplicate it for internal callers.
 */
export async function bulkDeleteCards(
  db: DB,
  userId: string,
  cardIds: string[],
): Promise<BulkCardResult> {
  const ids = unique(cardIds)
  return db.transaction(async (tx) => {
    await assertOwnedCards(tx, userId, ids)
    const deleted = await tx
      .delete(card)
      .where(and(eq(card.userId, userId), inArray(card.id, ids)))
      .returning({ id: card.id })
    return { requested: cardIds.length, affected: deleted.length }
  })
}

/**
 * Move a batch of the caller's cards into one of the caller's decks, atomically.
 *
 * THE FSRS STATE IS KEPT — deliberately, including across a change of subject.
 * The state models the user's memory OF THAT CARD'S CONTENT, and re-filing a
 * card does not change what is written on it; resetting would throw away real
 * evidence (reps, lapses, stability) and force the user to re-learn material
 * they demonstrably know. It is the same argument the review queue already makes
 * when it refuses to throttle a due card. Nothing else needs fixing up either,
 * and that is a property of the schema rather than luck:
 *   - `review_log` references `card_id`, never `deck_id`, so the history follows
 *     the card with no rewrite;
 *   - every per-deck and per-subject figure (`dueCounts`, `studyPlan`,
 *     `deckSuccess`) is DERIVED live from the card→deck→subject join — there is
 *     no denormalised counter to drift. The visible consequence is that past
 *     reviews are re-attributed to the destination deck's success rate, which is
 *     the honest reading: the deck is a folder, the history belongs to the card.
 *
 * THE ONE CASE THAT IS REFUSED is a destination under an ARCHIVED subject (409,
 * mirroring `createCard`). `dueQueue` filters archived subjects out, so such a
 * move would silently remove the cards from review — a schedule change the user
 * never asked for, dressed up as a tidy-up.
 */
export async function bulkMoveCards(
  db: DB,
  userId: string,
  cardIds: string[],
  deckId: string,
): Promise<BulkCardResult> {
  const ids = unique(cardIds)
  return db.transaction(async (tx) => {
    // Destination must be the caller's own; resolve its subject in the same
    // query so a foreign deck is a 404 before anything is read about the cards.
    const [dest] = await tx
      .select({ archived: subject.archived })
      .from(deck)
      .innerJoin(subject, eq(subject.id, deck.subjectId))
      .where(and(eq(deck.id, deckId), eq(deck.userId, userId), eq(subject.userId, userId)))
    if (!dest) throw new NotFoundError(`deck ${deckId} not found`)
    if (dest.archived) throw new ConflictError('cannot move cards under an archived subject')

    await assertOwnedCards(tx, userId, ids)
    const moved = await tx
      .update(card)
      .set({ deckId })
      .where(and(eq(card.userId, userId), inArray(card.id, ids)))
      .returning({ id: card.id })
    return { requested: cardIds.length, affected: moved.length }
  })
}
