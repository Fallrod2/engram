import { beforeEach, describe, expect, it } from 'bun:test'
import { backupSchema, type Backup } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { generation, note } from '../db/schema'
import {
  resetDb,
  seedCard,
  seedDeck,
  seedExam,
  seedReviewLog,
  seedSubject,
} from '../test-support/harness'
import { currentSchemaTag, exportBackup } from '../services/backup.service'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'

beforeEach(() => resetDb(db))

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

/** Seed one row in every table so a dump exercises the full FK chain. */
async function seedEverything() {
  const s = await seedSubject(db, { name: 'Théorie des langages' })
  const d = await seedDeck(db, s.id, { name: 'Automates', description: 'DFA/NFA' })
  const c1 = await seedCard(db, d.id, { front: 'Q1', back: 'A1' })
  await seedCard(db, d.id, { front: 'Q2', back: 'A2' })
  await seedReviewLog(db, c1.id, { rating: 3, durationMs: 4200 })
  await seedReviewLog(db, c1.id, { rating: 1, durationMs: null })
  const [n] = await db
    .insert(note)
    .values({
      userId: U,
      subjectId: s.id,
      title: 'Cours automates',
      sourceType: 'md',
      originalFilename: 'automates.md',
      content: '# Automates finis',
    })
    .returning()
  await db.insert(generation).values({
    userId: U,
    noteId: n!.id,
    deckId: d.id,
    kind: 'cards',
    status: 'succeeded',
    model: 'claude-sonnet-4-6',
    items: [{ id: 'g1', front: 'GF', back: 'GB', status: 'accepted', cardId: c1.id }],
    promptTokens: 100,
    completionTokens: 50,
  })
  await seedExam(db, [s.id], { title: 'Partiel TL', notes: 'chapitres 1-4' })
}

describe('backup export', () => {
  it('GET /api/backup/export returns a versioned dump validated by backupSchema', async () => {
    await seedEverything()
    const res = await app.request('/api/backup/export')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('content-disposition')).toContain('engram-backup-')
    const dump = backupSchema.parse(await res.json())
    expect(dump.engramBackup).toBe(1)
    expect(dump.schema).toBe(currentSchemaTag())
    expect(dump.tables.subject).toHaveLength(1)
    expect(dump.tables.card).toHaveLength(2)
    expect(dump.tables.reviewLog).toHaveLength(2)
    expect(dump.tables.generation[0]!.items).toHaveLength(1)
  })
})

describe('backup import — round trip', () => {
  it('export → wipe → import → export is lossless (row for row)', async () => {
    await seedEverything()
    const first = backupSchema.parse(await exportBackup(db, U))

    await resetDb(db)
    const res = await postJson('/api/backup/import', first)
    expect(res.status).toBe(200)
    const result = (await res.json()) as { inserted: Record<string, number> }
    expect(result.inserted).toEqual({
      subject: 1,
      deck: 1,
      card: 2,
      reviewLog: 2,
      note: 1,
      generation: 1,
      exam: 1,
      examSubject: 1,
    })

    const second = backupSchema.parse(await exportBackup(db, U))
    // exportedAt differs; the tables + schema must be identical.
    expect(second.schema).toBe(first.schema)
    expect(sorted(second.tables)).toEqual(sorted(first.tables))
  })

  it('import replaces all existing data (only the dump survives)', async () => {
    // State A.
    const sa = await seedSubject(db, { name: 'A-subject' })
    await seedDeck(db, sa.id)
    // Dump B.
    await resetDb(db)
    await seedEverything()
    const dumpB = backupSchema.parse(await exportBackup(db, U))

    // Restore A, then import B → only B remains.
    await resetDb(db)
    await seedSubject(db, { name: 'A-subject' })
    const res = await postJson('/api/backup/import', dumpB)
    expect(res.status).toBe(200)

    const after = backupSchema.parse(await exportBackup(db, U))
    expect(after.tables.subject).toHaveLength(1)
    expect(after.tables.subject[0]!.name).toBe('Théorie des langages')
  })
})

describe('backup import — guards & atomicity', () => {
  it('rejects a wrong format version with 400 and leaves the DB unchanged', async () => {
    await seedEverything()
    const before = await exportBackup(db, U)
    const bad = { ...before, engramBackup: 2 }
    const res = await postJson('/api/backup/import', bad)
    expect(res.status).toBe(400)
    const after = await exportBackup(db, U)
    expect(after.tables.subject).toHaveLength(before.tables.subject.length)
  })

  it('rejects a divergent schema tag with 409', async () => {
    const dump = backupSchema.parse(await exportBackup(db, U))
    const res = await postJson('/api/backup/import', { ...dump, schema: 'not_the_current_tag' })
    expect(res.status).toBe(409)
  })

  it('rolls back on a forged FK violation (400) — DB unchanged', async () => {
    await seedEverything()
    const before = backupSchema.parse(await exportBackup(db, U))
    // Forge a card pointing at a non-existent deck: valid shape, bad FK.
    const forged: Backup = {
      ...before,
      tables: {
        ...before.tables,
        card: [{ ...before.tables.card[0]!, deckId: 'deck-does-not-exist' }],
      },
    }
    const res = await postJson('/api/backup/import', forged)
    expect(res.status).toBe(400)
    // The wipe+insert transaction rolled back: the original data is intact.
    const after = backupSchema.parse(await exportBackup(db, U))
    expect(sorted(after.tables)).toEqual(sorted(before.tables))
  })

  it('rejects a non-JSON body with 400', async () => {
    const res = await postJson('/api/backup/import', 'not json at all')
    expect(res.status).toBe(400)
  })
})

/** Stable ordering by id so row arrays compare regardless of select order. */
function sorted(tables: Backup['tables']): Backup['tables'] {
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id))
  return {
    subject: byId(tables.subject),
    deck: byId(tables.deck),
    card: byId(tables.card),
    reviewLog: byId(tables.reviewLog),
    note: byId(tables.note),
    generation: byId(tables.generation),
    exam: byId(tables.exam),
    examSubject: [...tables.examSubject].sort((a, b) =>
      (a.examId + a.subjectId).localeCompare(b.examId + b.subjectId),
    ),
  }
}
