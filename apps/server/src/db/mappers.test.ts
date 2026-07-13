import { describe, expect, it } from 'vitest'
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs'
import type { InferSelectModel } from 'drizzle-orm'
import {
  cardSchema,
  reviewLogSchema,
  subjectSchema,
  deckSchema,
  noteSchema,
  generationSchema,
  examSchema,
} from '@engram/shared'
import type { card, subject, deck, note, generation, exam } from './schema'
import { toFsrsCard, fsrsCardToColumns, fsrsLogToRow } from './mappers'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import {
  cardToDto,
  reviewLogToDto,
  subjectToDto,
  deckToDto,
  noteToDto,
  generationToDto,
  examToDto,
} from './dto'

/**
 * Pure mapper + DTO coverage — no DB. The real-SQLite integration (migrations,
 * insert/select, FK cascade, CHECK) lives in the `.spec.ts` files run by
 * `bun test` (bun:sqlite is unavailable under the Node-based vitest runner).
 */

const now = new Date('2026-07-12T10:00:00.000Z')

function makeCardRow(overrides: Partial<InferSelectModel<typeof card>> = {}) {
  const base: InferSelectModel<typeof card> = {
    id: 'card-1',
    userId: U,
    deckId: 'deck-1',
    front: '# Q',
    back: '# A',
    ...fsrsCardToColumns(createEmptyCard(now)),
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

describe('FSRS mapper round-trip (pure)', () => {
  it('toFsrsCard omits last_review when null', () => {
    const c = toFsrsCard(makeCardRow({ lastReview: null }))
    expect('last_review' in c).toBe(false)
    expect(c.state).toBe(0)
    expect(c.due.getTime()).toBe(now.getTime())
  })

  it('toFsrsCard includes last_review when set', () => {
    const c = toFsrsCard(makeCardRow({ lastReview: now }))
    expect(c.last_review?.getTime()).toBe(now.getTime())
  })

  it('row → toFsrsCard → next(Good) → columns/log survives a full trip', () => {
    const row = makeCardRow()
    const rec = fsrs().next(toFsrsCard(row), now, Rating.Good)

    const cols = fsrsCardToColumns(rec.card)
    expect(cols.reps).toBe(1)
    expect(cols.state).toBe(rec.card.state)
    expect(cols.due.getTime()).toBe(rec.card.due.getTime())
    expect(cols.lastReview?.getTime()).toBe(rec.card.last_review?.getTime())

    const logRow = fsrsLogToRow(row.id, rec.log, 1500)
    expect(logRow.rating).toBe(Rating.Good)
    expect(logRow.lastElapsedDays).toBe(rec.log.last_elapsed_days)
    expect(logRow.durationMs).toBe(1500)

    // The FSRS columns feed a card DTO that satisfies the shared contract.
    const dtoRow = makeCardRow(cols)
    expect(cardSchema.parse(cardToDto(dtoRow))).toBeTruthy()
  })

  it('fsrsLogToRow defaults durationMs to null', () => {
    const rec = fsrs().next(toFsrsCard(makeCardRow()), now, Rating.Again)
    expect(fsrsLogToRow('c', rec.log).durationMs).toBeNull()
  })
})

describe('row → DTO conforms to shared Zod schemas (pure, anti-drift)', () => {
  it('subject / deck / card / note DTOs parse', () => {
    const s: InferSelectModel<typeof subject> = {
      id: 's1',
      userId: U,
      name: 'TL',
      color: '#3B82F6',
      icon: 'book-open',
      position: 0,
      archived: false,
      createdAt: now,
      updatedAt: now,
    }
    expect(subjectSchema.parse(subjectToDto(s))).toBeTruthy()

    const d: InferSelectModel<typeof deck> = {
      id: 'd1',
      userId: U,
      subjectId: 's1',
      name: 'Automata',
      description: null,
      position: 0,
      createdAt: now,
      updatedAt: now,
    }
    expect(deckSchema.parse(deckToDto(d))).toBeTruthy()

    expect(cardSchema.parse(cardToDto(makeCardRow()))).toBeTruthy()

    const n: InferSelectModel<typeof note> = {
      id: 'n1',
      userId: U,
      subjectId: null,
      title: 'Ch1',
      sourceType: 'md',
      originalFilename: null,
      content: 'x',
      createdAt: now,
      updatedAt: now,
    }
    expect(noteSchema.parse(noteToDto(n))).toBeTruthy()
  })

  it('reviewLog / generation / exam DTOs parse', () => {
    const rec = fsrs().next(toFsrsCard(makeCardRow()), now, Rating.Good)
    // reviewLogToDto expects a full row; build it explicitly.
    expect(
      reviewLogSchema.parse(
        reviewLogToDto({
          id: 'l1',
          userId: U,
          cardId: 'card-1',
          rating: rec.log.rating,
          state: rec.log.state,
          due: rec.log.due,
          stability: rec.log.stability,
          difficulty: rec.log.difficulty,
          elapsedDays: rec.log.elapsed_days,
          lastElapsedDays: rec.log.last_elapsed_days,
          scheduledDays: rec.log.scheduled_days,
          learningSteps: rec.log.learning_steps,
          review: rec.log.review,
          durationMs: 900,
          createdAt: now,
        }),
      ),
    ).toBeTruthy()

    const g: InferSelectModel<typeof generation> = {
      id: 'g1',
      userId: U,
      noteId: 'n1',
      deckId: null,
      kind: 'cards',
      status: 'pending',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      items: [{ id: 'i1', front: 'q', back: 'a', status: 'pending' }],
      promptTokens: null,
      completionTokens: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    }
    expect(generationSchema.parse(generationToDto(g))).toBeTruthy()

    const e: InferSelectModel<typeof exam> = {
      id: 'e1',
      userId: U,
      title: 'Partiel',
      date: now,
      notes: null,
      createdAt: now,
      updatedAt: now,
    }
    expect(examSchema.parse(examToDto(e, ['s1']))).toBeTruthy()
  })
})
