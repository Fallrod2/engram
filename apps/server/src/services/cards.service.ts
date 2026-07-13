import { and, asc, count, eq } from 'drizzle-orm'
import { Rating, type RecordLogItem } from 'ts-fsrs'
import type {
  Card,
  CreateCard,
  GradePreview,
  ListCardsResponse,
  ReviewPreview,
  UpdateCard,
} from '@engram/shared'
import type { DB, Tx } from '../db/client'
import { card } from '../db/schema'
import { cardToDto } from '../db/dto'
import { fsrsCardToColumns, toFsrsCard } from '../db/mappers'
import { NotFoundError, ConflictError } from '../http/errors'
import { requireSubjectRow } from './subjects.service'
import { requireDeckRow } from './decks.service'
import { freshFsrsCard, previewAll } from './fsrs'

/** Fetch a raw card row (scoped to `userId`) or throw 404. */
export async function requireCardRow(db: DB, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(card)
    .where(and(eq(card.id, id), eq(card.userId, userId)))
  if (!row) throw new NotFoundError(`card ${id} not found`)
  return row
}

export interface ListCardsFilter {
  deckId?: string
  limit: number
  offset: number
}

export async function listCards(
  db: DB,
  userId: string,
  f: ListCardsFilter,
): Promise<ListCardsResponse> {
  const where = f.deckId
    ? and(eq(card.userId, userId), eq(card.deckId, f.deckId))
    : eq(card.userId, userId)
  const [totalRow] = await db.select({ n: count() }).from(card).where(where)
  const total = totalRow?.n ?? 0
  const rows = await db
    .select()
    .from(card)
    .where(where)
    .orderBy(asc(card.createdAt))
    .limit(f.limit)
    .offset(f.offset)
  return { total, cards: rows.map(cardToDto) }
}

export async function getCard(db: DB, userId: string, id: string): Promise<Card> {
  return cardToDto(await requireCardRow(db, userId, id))
}

/**
 * Low-level insert of a brand-new card (fresh FSRS seed), shared by `createCard`
 * and `resolveGeneration`. Stamps `userId` (denormalized owner). Accepts either
 * the `db` handle or a transaction handle so a caller can insert several cards
 * atomically. Performs NO deck/subject validation — the caller validates the
 * deck (and its ownership) first.
 */
export async function insertFreshCardRow(
  dbOrTx: DB | Tx,
  userId: string,
  values: { deckId: string; front: string; back: string },
): Promise<string> {
  const [row] = await dbOrTx
    .insert(card)
    .values({
      userId,
      deckId: values.deckId,
      front: values.front,
      back: values.back,
      ...fsrsCardToColumns(freshFsrsCard(new Date())),
    })
    .returning()
  return row!.id
}

export async function createCard(db: DB, userId: string, input: CreateCard): Promise<Card> {
  // 404 if the deck is missing/foreign; 409 if its subject is archived.
  const deckRow = await requireDeckRow(db, userId, input.deckId)
  const subjectRow = await requireSubjectRow(db, userId, deckRow.subjectId)
  if (subjectRow.archived) {
    throw new ConflictError('cannot create a card under an archived subject')
  }
  const id = await insertFreshCardRow(db, userId, {
    deckId: input.deckId,
    front: input.front,
    back: input.back,
  })
  return getCard(db, userId, id)
}

export async function updateCard(
  db: DB,
  userId: string,
  id: string,
  patch: UpdateCard,
): Promise<Card> {
  await requireCardRow(db, userId, id)
  const set = {
    ...(patch.front !== undefined ? { front: patch.front } : {}),
    ...(patch.back !== undefined ? { back: patch.back } : {}),
  }
  if (Object.keys(set).length === 0) return getCard(db, userId, id) // empty body: no-op
  const [row] = await db
    .update(card)
    .set(set)
    .where(and(eq(card.id, id), eq(card.userId, userId)))
    .returning()
  return cardToDto(row!)
}

export async function deleteCard(db: DB, userId: string, id: string): Promise<void> {
  const res = await db
    .delete(card)
    .where(and(eq(card.id, id), eq(card.userId, userId)))
    .returning({ id: card.id })
  if (res.length === 0) throw new NotFoundError(`card ${id} not found`)
}

function toGradePreview(item: RecordLogItem): GradePreview {
  return {
    due: item.card.due.toISOString(),
    stability: item.card.stability,
    difficulty: item.card.difficulty,
    scheduledDays: item.card.scheduled_days,
    state: item.card.state as GradePreview['state'],
  }
}

/** Read-only projection of the 4 grades (never writes to the DB). */
export async function previewCard(
  db: DB,
  userId: string,
  id: string,
  now: Date,
): Promise<ReviewPreview> {
  const row = await requireCardRow(db, userId, id)
  const preview = previewAll(toFsrsCard(row), now)
  return {
    now: now.toISOString(),
    again: toGradePreview(preview[Rating.Again]),
    hard: toGradePreview(preview[Rating.Hard]),
    good: toGradePreview(preview[Rating.Good]),
    easy: toGradePreview(preview[Rating.Easy]),
  }
}
