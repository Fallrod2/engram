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
import type { DB } from '../db/client'
import { card } from '../db/schema'
import { cardToDto } from '../db/dto'
import { fsrsCardToColumns, toFsrsCard } from '../db/mappers'
import { NotFoundError, ConflictError } from '../http/errors'
import { requireSubjectRow } from './subjects.service'
import { requireDeckRow } from './decks.service'
import { freshFsrsCard, previewAll } from './fsrs'

/** Fetch a raw card row or throw 404. */
export function requireCardRow(db: DB, id: string) {
  const row = db.select().from(card).where(eq(card.id, id)).get()
  if (!row) throw new NotFoundError(`card ${id} not found`)
  return row
}

export interface ListCardsFilter {
  deckId?: string
  limit: number
  offset: number
}

export function listCards(db: DB, f: ListCardsFilter): ListCardsResponse {
  const where = f.deckId ? eq(card.deckId, f.deckId) : undefined
  const total = db.select({ n: count() }).from(card).where(where).get()?.n ?? 0
  const rows = db
    .select()
    .from(card)
    .where(where)
    .orderBy(asc(card.createdAt))
    .limit(f.limit)
    .offset(f.offset)
    .all()
  return { total, cards: rows.map(cardToDto) }
}

export function getCard(db: DB, id: string): Card {
  return cardToDto(requireCardRow(db, id))
}

export function createCard(db: DB, input: CreateCard): Card {
  // 404 if the deck is missing; 409 if its subject is archived.
  const deckRow = requireDeckRow(db, input.deckId)
  const subjectRow = requireSubjectRow(db, deckRow.subjectId)
  if (subjectRow.archived) {
    throw new ConflictError('cannot create a card under an archived subject')
  }
  const row = db
    .insert(card)
    .values({
      deckId: input.deckId,
      front: input.front,
      back: input.back,
      ...fsrsCardToColumns(freshFsrsCard(new Date())),
    })
    .returning()
    .get()
  return cardToDto(row)
}

export function updateCard(db: DB, id: string, patch: UpdateCard): Card {
  requireCardRow(db, id)
  const set = {
    ...(patch.front !== undefined ? { front: patch.front } : {}),
    ...(patch.back !== undefined ? { back: patch.back } : {}),
  }
  if (Object.keys(set).length === 0) return getCard(db, id) // empty body: no-op
  const row = db.update(card).set(set).where(eq(card.id, id)).returning().get()
  return cardToDto(row)
}

export function deleteCard(db: DB, id: string): void {
  const res = db.delete(card).where(eq(card.id, id)).returning({ id: card.id }).all()
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
export function previewCard(db: DB, id: string, now: Date): ReviewPreview {
  const row = requireCardRow(db, id)
  const preview = previewAll(toFsrsCard(row), now)
  return {
    now: now.toISOString(),
    again: toGradePreview(preview[Rating.Again]),
    hard: toGradePreview(preview[Rating.Hard]),
    good: toGradePreview(preview[Rating.Good]),
    easy: toGradePreview(preview[Rating.Easy]),
  }
}
