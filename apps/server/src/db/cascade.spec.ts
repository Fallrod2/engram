import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from './test-db'
import { subject, deck, card, reviewLog, note, generation, exam, examSubject } from './schema'
import { fsrsCardToColumns, fsrsLogToRow, toFsrsCard } from './mappers'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'

let t: TestDb

beforeEach(async () => {
  t = await createTestDb()
})
afterEach(async () => {
  await t.cleanup()
})

describe('foreign-key cascade / set null (PRAGMA foreign_keys = ON)', () => {
  it('deleting a subject cascades to deck/card/review_log and nulls note/generation links', async () => {
    const [s] = await t.db
      .insert(subject)
      .values({ userId: U, name: 'S', color: '#112233', icon: 'book' })
      .returning()
    const [d] = await t.db
      .insert(deck)
      .values({ userId: U, subjectId: s!.id, name: 'D' })
      .returning()
    const [c] = await t.db
      .insert(card)
      .values({
        userId: U,
        deckId: d!.id,
        front: 'f',
        back: 'b',
        ...fsrsCardToColumns(createEmptyCard(new Date())),
      })
      .returning()
    const rec = fsrs().next(toFsrsCard(c!), new Date(), Rating.Good)
    await t.db.insert(reviewLog).values({ ...fsrsLogToRow(c!.id, rec.log), userId: U })

    // Weak links to the subject/deck that must survive as NULL.
    const [n] = await t.db
      .insert(note)
      .values({
        userId: U,
        subjectId: s!.id,
        title: 'N',
        sourceType: 'md',
        content: 'x',
      })
      .returning()
    const [g] = await t.db
      .insert(generation)
      .values({ userId: U, noteId: n!.id, deckId: d!.id, kind: 'cards', model: 'm' })
      .returning()

    await t.db.delete(subject).where(eq(subject.id, s!.id))

    expect(await t.db.select().from(deck)).toHaveLength(0)
    expect(await t.db.select().from(card)).toHaveLength(0)
    expect(await t.db.select().from(reviewLog)).toHaveLength(0)

    const [noteAfter] = await t.db.select().from(note).where(eq(note.id, n!.id))
    expect(noteAfter!.subjectId).toBeNull()
    const [genAfter] = await t.db.select().from(generation).where(eq(generation.id, g!.id))
    expect(genAfter!.deckId).toBeNull()
  })

  it('deleting an exam cascades to exam_subject rows', async () => {
    const [s] = await t.db
      .insert(subject)
      .values({ userId: U, name: 'S', color: '#112233', icon: 'book' })
      .returning()
    const [e] = await t.db
      .insert(exam)
      .values({ userId: U, title: 'Midterm', date: new Date(2026, 6, 20) })
      .returning()
    await t.db.insert(examSubject).values({ examId: e!.id, subjectId: s!.id })

    await t.db.delete(exam).where(eq(exam.id, e!.id))
    expect(await t.db.select().from(examSubject)).toHaveLength(0)
    // Subject itself is untouched.
    expect(await t.db.select().from(subject)).toHaveLength(1)
  })
})
