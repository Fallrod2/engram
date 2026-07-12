import { asc, count, eq } from 'drizzle-orm'
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

/** Fetch a raw card row or throw 404. */
export async function requireCardRow(db: DB, id: string) {
  const [row] = await db.select().from(card).where(eq(card.id, id))
  if (!row) throw new NotFoundError(`card ${id} not found`)
  return row
}

export interface ListCardsFilter {
  deckId?: string
  limit: number
  offset: number
}

export async function listCards(db: DB, f: ListCardsFilter): Promise<ListCardsResponse> {
  const where = f.deckId ? eq(card.deckId, f.deckId) : undefined
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

export async function getCard(db: DB, id: string): Promise<Card> {
  return cardToDto(await requireCardRow(db, id))
}

/**
 * Low-level insert of a brand-new card (fresh FSRS seed), shared by `createCard`
 * and `resolveGeneration`. Accepts either the `db` handle or a transaction
 * handle so a caller can insert several cards atomically. Performs NO deck/subject
 * validation — the caller validates the deck first (once).
 */
export async function insertFreshCardRow(
  dbOrTx: DB | Tx,
  values: { deckId: string; front: string; back: string },
): Promise<string> {
  const [row] = await dbOrTx
    .insert(card)
    .values({
      deckId: values.deckId,
      front: values.front,
      back: values.back,
      ...fsrsCardToColumns(freshFsrsCard(new Date())),
    })
    .returning()
  return row!.id
}

export async function createCard(db: DB, input: CreateCard): Promise<Card> {
  // 404 if the deck is missing; 409 if its subject is archived.
  const deckRow = await requireDeckRow(db, input.deckId)
  const subjectRow = await requireSubjectRow(db, deckRow.subjectId)
  if (subjectRow.archived) {
    throw new ConflictError('cannot create a card under an archived subject')
  }
  const id = await insertFreshCardRow(db, {
    deckId: input.deckId,
    front: input.front,
    back: input.back,
  })
  return getCard(db, id)
}

export async function updateCard(db: DB, id: string, patch: UpdateCard): Promise<Card> {
  await requireCardRow(db, id)
  const set = {
    ...(patch.front !== undefined ? { front: patch.front } : {}),
    ...(patch.back !== undefined ? { back: patch.back } : {}),
  }
  if (Object.keys(set).length === 0) return getCard(db, id) // empty body: no-op
  const [row] = await db.update(card).set(set).where(eq(card.id, id)).returning()
  return cardToDto(row!)
}

export async function deleteCard(db: DB, id: string): Promise<void> {
  const res = await db.delete(card).where(eq(card.id, id)).returning({ id: card.id })
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
export async function previewCard(db: DB, id: string, now: Date): Promise<ReviewPreview> {
  const row = await requireCardRow(db, id)
  const preview = previewAll(toFsrsCard(row), now)
  return {
    now: now.toISOString(),
    again: toGradePreview(preview[Rating.Again]),
    hard: toGradePreview(preview[Rating.Hard]),
    good: toGradePreview(preview[Rating.Good]),
    easy: toGradePreview(preview[Rating.Easy]),
  }
}
