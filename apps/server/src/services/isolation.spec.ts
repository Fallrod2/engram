import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { NotFoundError } from '../http/errors'
import {
  createSubject,
  deleteSubject,
  getSubject,
  listSubjects,
  updateSubject,
} from './subjects.service'
import { createDeck, deleteDeck, getDeck, listDecks } from './decks.service'
import { createCard, deleteCard, getCard, listCards, updateCard } from './cards.service'
import { reviewCard } from './review.service'
import { dueCounts, dueQueue } from './review-queue.service'
import { createNote, getNote, listNotes } from './notes.service'
import { createExam, getExam, listExams } from './exams.service'
import { studyPlan, studyToday } from './study-plan.service'
import { deckSuccess, heatmap, retention, reviewVolume, streaks } from './analytics.service'
import { exportBackup, importBackup } from './backup.service'
import { requireGenerationRow, resolveGeneration } from './generations.service'
import { generation, reviewLog } from '../db/schema'
import { eq } from 'drizzle-orm'

/**
 * Cross-tenant isolation (spec §6.2). Two distinct owners drive the SAME service
 * functions against ONE database: everything user B can see, mutate or delete
 * must be strictly B's own. A foreign id reads as 404 (anti-enumeration), never
 * a 403 leak of existence.
 */

const A = 'user-a'
const B = 'user-b'
const NOW = new Date()

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

/** Build a full graph (subject → deck → card, reviewed once) owned by `userId`. */
async function seedGraph(userId: string) {
  const subject = await createSubject(db, userId, { name: 'S', color: '#123456', icon: 'book' })
  const deck = await createDeck(db, userId, { subjectId: subject.id, name: 'D' })
  const cardDto = await createCard(db, userId, { deckId: deck.id, front: 'f', back: 'b' })
  await reviewCard(db, userId, cardDto.id, { grade: 3 })
  const note = await createNote(db, userId, { title: 'N', sourceType: 'md', content: 'hello' })
  const exam = await createExam(db, userId, {
    title: 'E',
    date: '2026-08-01T00:00:00.000Z',
    subjectIds: [subject.id],
  })
  return {
    subjectId: subject.id,
    deckId: deck.id,
    cardId: cardDto.id,
    noteId: note.id,
    examId: exam.id,
  }
}

describe('list endpoints are per-user', () => {
  it('B sees none of A’s subjects/decks/cards/notes/exams', async () => {
    const a = await seedGraph(A)
    expect(await listSubjects(db, B, true)).toHaveLength(0)
    expect(await listDecks(db, B)).toHaveLength(0)
    expect((await listCards(db, B, { limit: 100, offset: 0 })).total).toBe(0)
    expect((await listNotes(db, B)).notes).toHaveLength(0)
    expect(await listExams(db, B, {})).toHaveLength(0)
    // A still sees its own.
    expect(await listSubjects(db, A, true)).toHaveLength(1)
    expect(a.subjectId).toBeDefined()
  })
})

describe('get / update / delete on a foreign id → 404', () => {
  it('subject', async () => {
    const a = await seedGraph(A)
    await expect(getSubject(db, B, a.subjectId)).rejects.toThrow(NotFoundError)
    await expect(updateSubject(db, B, a.subjectId, { name: 'x' })).rejects.toThrow(NotFoundError)
    await expect(deleteSubject(db, B, a.subjectId)).rejects.toThrow(NotFoundError)
    // A’s subject is untouched by B’s failed delete.
    expect((await getSubject(db, A, a.subjectId)).name).toBe('S')
  })

  it('deck', async () => {
    const a = await seedGraph(A)
    await expect(getDeck(db, B, a.deckId)).rejects.toThrow(NotFoundError)
    await expect(deleteDeck(db, B, a.deckId)).rejects.toThrow(NotFoundError)
  })

  it('card', async () => {
    const a = await seedGraph(A)
    await expect(getCard(db, B, a.cardId)).rejects.toThrow(NotFoundError)
    await expect(updateCard(db, B, a.cardId, { front: 'x' })).rejects.toThrow(NotFoundError)
    await expect(deleteCard(db, B, a.cardId)).rejects.toThrow(NotFoundError)
  })

  it('note / exam', async () => {
    const a = await seedGraph(A)
    await expect(getNote(db, B, a.noteId)).rejects.toThrow(NotFoundError)
    await expect(getExam(db, B, a.examId)).rejects.toThrow(NotFoundError)
  })
})

describe('reviewCard on a foreign card → 404, no log written', () => {
  it('B cannot review A’s card', async () => {
    const a = await seedGraph(A)
    await expect(reviewCard(db, B, a.cardId, { grade: 3 })).rejects.toThrow(NotFoundError)
    // Only A’s single review exists — B never wrote a log against A’s card.
    const bLogs = await db.select().from(reviewLog).where(eq(reviewLog.userId, B))
    expect(bLogs).toHaveLength(0)
  })
})

describe('queue / counts / plan / analytics are empty for a fresh user', () => {
  it('B sees no dues, no plan, no analytics from A’s data', async () => {
    await seedGraph(A)
    expect((await dueQueue(db, B, { limit: 50, now: NOW })).total).toBe(0)
    expect((await dueCounts(db, B, NOW)).total).toBe(0)
    expect((await studyToday(db, B, NOW)).total).toBe(0)
    const plan = await studyPlan(db, B, {
      from: '2026-07-01',
      to: '2026-07-31',
      now: new Date(2026, 6, 12),
    })
    expect(plan.days.every((d) => d.total === 0)).toBe(true)
    expect((await heatmap(db, B, { now: NOW })).total).toBe(0)
    expect((await streaks(db, B, NOW)).totalStudyDays).toBe(0)
    expect((await reviewVolume(db, B, { now: NOW, granularity: 'day' })).totals.total).toBe(0)
    expect((await retention(db, B, {})).subjects).toHaveLength(0)
    expect((await deckSuccess(db, B, {})).decks).toHaveLength(0)
    // A’s analytics DO see A’s review.
    expect((await heatmap(db, A, { now: NOW })).total).toBe(1)
  })
})

describe('cross-tenant creation is blocked', () => {
  it('B cannot create an exam over A’s subject (404)', async () => {
    const a = await seedGraph(A)
    await expect(
      createExam(db, B, {
        title: 'x',
        date: '2026-08-01T00:00:00.000Z',
        subjectIds: [a.subjectId],
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('B cannot create a deck under A’s subject (404)', async () => {
    const a = await seedGraph(A)
    await expect(createDeck(db, B, { subjectId: a.subjectId, name: 'x' })).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('generation scoping', () => {
  it('B cannot read or resolve A’s generation (404)', async () => {
    const a = await seedGraph(A)
    const [gen] = await db
      .insert(generation)
      .values({
        userId: A,
        noteId: a.noteId,
        kind: 'cards',
        model: 'm',
        status: 'succeeded',
        items: [],
      })
      .returning()
    await expect(requireGenerationRow(db, B, gen!.id)).rejects.toThrow(NotFoundError)
    await expect(resolveGeneration(db, B, gen!.id, { items: [] })).rejects.toThrow(NotFoundError)
    // A can read it.
    expect((await requireGenerationRow(db, A, gen!.id)).id).toBe(gen!.id)
  })
})

describe('backup is per-user', () => {
  it('B’s export excludes A’s data; B’s import never touches A’s rows', async () => {
    const a = await seedGraph(A)
    await seedGraph(B)

    const dumpB = await exportBackup(db, B)
    // B’s dump has exactly B’s single-of-each rows and none of A’s ids.
    expect(dumpB.tables.subject).toHaveLength(1)
    expect(dumpB.tables.subject.map((s) => s.id)).not.toContain(a.subjectId)
    expect(dumpB.tables.card.map((cc) => cc.id)).not.toContain(a.cardId)

    // Re-importing B’s dump replaces B’s rows but leaves A’s intact.
    await importBackup(db, B, dumpB)
    expect(await listSubjects(db, A, true)).toHaveLength(1)
    expect((await getSubject(db, A, a.subjectId)).name).toBe('S')
    // And A’s export still excludes B.
    const dumpA = await exportBackup(db, A)
    expect(dumpA.tables.subject.map((s) => s.id)).toEqual([a.subjectId])
  })
})
