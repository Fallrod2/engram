import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs'
import {
  subjectSchema,
  deckSchema,
  cardSchema,
  reviewLogSchema,
  noteSchema,
  generationSchema,
  examSchema,
  type GenerationItem,
} from '@engram/shared'
import { createTestDb, type TestDb } from './test-db'
import { subject, deck, card, reviewLog, note, generation, exam, examSubject } from './schema'
import {
  subjectToDto,
  deckToDto,
  cardToDto,
  reviewLogToDto,
  noteToDto,
  generationToDto,
  examToDto,
} from './dto'
import { fsrsCardToColumns, fsrsLogToRow, toFsrsCard } from './mappers'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'

let t: TestDb

beforeEach(async () => {
  t = await createTestDb()
})
afterEach(async () => {
  await t.cleanup()
})

describe('row → DTO conforms to shared Zod schemas (anti-drift)', () => {
  it('parses a full graph of DTOs', async () => {
    const [s] = await t.db
      .insert(subject)
      .values({ userId: U, name: 'Théorie des langages', color: '#3B82F6', icon: 'book-open' })
      .returning()
    expect(subjectSchema.parse(subjectToDto(s!))).toBeTruthy()

    const [d] = await t.db
      .insert(deck)
      .values({ userId: U, subjectId: s!.id, name: 'Automates', description: null })
      .returning()
    expect(deckSchema.parse(deckToDto(d!))).toBeTruthy()

    const [c] = await t.db
      .insert(card)
      .values({
        userId: U,
        deckId: d!.id,
        front: '# Q',
        back: '# A',
        ...fsrsCardToColumns(createEmptyCard(new Date())),
      })
      .returning()
    expect(cardSchema.parse(cardToDto(c!))).toBeTruthy()

    const rec = fsrs().next(toFsrsCard(c!), new Date(), Rating.Good)
    const [l] = await t.db
      .insert(reviewLog)
      .values({ ...fsrsLogToRow(c!.id, rec.log, 1500), userId: U })
      .returning()
    expect(reviewLogSchema.parse(reviewLogToDto(l!))).toBeTruthy()

    const [n] = await t.db
      .insert(note)
      .values({
        userId: U,
        subjectId: s!.id,
        title: 'Chapitre 1',
        sourceType: 'pdf',
        originalFilename: 'ch1.pdf',
        content: 'texte',
      })
      .returning()
    expect(noteSchema.parse(noteToDto(n!))).toBeTruthy()

    const items: GenerationItem[] = [
      { id: 'i1', front: 'q', back: 'a', status: 'pending' },
      { id: 'i2', front: 'q2', back: 'a2', status: 'accepted', cardId: c!.id },
    ]
    const [g] = await t.db
      .insert(generation)
      .values({
        userId: U,
        noteId: n!.id,
        deckId: d!.id,
        kind: 'cards',
        status: 'succeeded',
        model: 'claude-sonnet-4-6',
        items,
        promptTokens: 100,
        completionTokens: 50,
      })
      .returning()
    const genDto = generationToDto(g!)
    expect(generationSchema.parse(genDto)).toBeTruthy()
    // JSON column round-trips the typed items array.
    expect(genDto.items).toEqual(items)

    const [e] = await t.db
      .insert(exam)
      .values({ userId: U, title: 'Partiel', date: new Date(2026, 6, 20), notes: null })
      .returning()
    await t.db.insert(examSubject).values({ examId: e!.id, subjectId: s!.id })
    expect(examSchema.parse(examToDto(e!, [s!.id]))).toBeTruthy()
  })

  it('nullable subject on note DTO parses', async () => {
    const [n] = await t.db
      .insert(note)
      .values({ userId: U, title: 'Orpheline', sourceType: 'md', content: 'x' })
      .returning()
    const dto = noteToDto(n!)
    expect(dto.subjectId).toBeNull()
    expect(noteSchema.parse(dto)).toBeTruthy()
  })
})

describe('migration produces the expected schema on a fresh DB', () => {
  it('inserts respect the source_type check constraint', async () => {
    // Valid value passes.
    const [row] = await t.db
      .insert(subject)
      .values({ userId: U, name: 'S', color: '#000000', icon: 'x' })
      .returning()
    expect(row).toBeDefined()

    // Invalid source_type is rejected by the DB CHECK (column is plain text,
    // so the guard is the runtime constraint, not the type system).
    let threw = false
    try {
      await t.db.insert(note).values({ userId: U, title: 'bad', sourceType: 'docx', content: 'x' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})
