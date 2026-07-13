import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { card, deck, exam, examSubject, reviewLog, subject } from '../db/schema'
import { localDayDiff, localMidnight } from '../lib/day'
import { readDemoMarker, seedDemo, wipeUserData } from './demo.service'
import { createSubject as makeSubject } from './subjects.service'
import { createDeck } from './decks.service'
import { createCard } from './cards.service'

/**
 * Demo dataset (spec §4 / §6.4). Verifies the seed produces a coherent, credible
 * set with the expected counts, that it is scoped + idempotent, and that a marker
 * change re-wipes and reseeds (the mechanism the middleware uses on a new login).
 */

const DEMO = 'demo-user'

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

async function runSeed(marker: string): Promise<void> {
  await db.transaction(async (tx) => {
    await seedDemo(tx, DEMO, marker)
  })
}

describe('seedDemo', () => {
  it('produces the expected credible dataset (counts)', async () => {
    await runSeed('no-session')
    expect((await db.select().from(subject).where(eq(subject.userId, DEMO))).length).toBe(2)
    expect((await db.select().from(deck).where(eq(deck.userId, DEMO))).length).toBe(3)
    expect((await db.select().from(card).where(eq(card.userId, DEMO))).length).toBe(25)
    expect((await db.select().from(reviewLog).where(eq(reviewLog.userId, DEMO))).length).toBe(60)
    expect((await db.select().from(exam).where(eq(exam.userId, DEMO))).length).toBe(1)
    expect((await db.select().from(examSubject)).length).toBe(1)
  })

  it('exam is ~10 days ahead of today (relative, not hard-coded)', async () => {
    await runSeed('no-session')
    const [e] = await db.select().from(exam).where(eq(exam.userId, DEMO))
    const now = new Date()
    const today = localMidnight(now.getFullYear(), now.getMonth(), now.getDate())
    expect(localDayDiff(today, e!.date)).toBe(10)
  })

  it('stores the session marker', async () => {
    await runSeed('sess-abc')
    expect(await readDemoMarker(db)).toBe('sess-abc')
  })

  it('is idempotent under the same marker (no doubling)', async () => {
    await runSeed('sess-1')
    await runSeed('sess-1')
    expect((await db.select().from(subject).where(eq(subject.userId, DEMO))).length).toBe(2)
    expect((await db.select().from(card).where(eq(card.userId, DEMO))).length).toBe(25)
  })

  it('a new marker re-wipes and reseeds (session change)', async () => {
    await runSeed('sess-1')
    // Simulate a user edit that a reset must erase.
    await db.update(subject).set({ name: 'EDITED' }).where(eq(subject.userId, DEMO))
    await runSeed('sess-2')
    expect(await readDemoMarker(db)).toBe('sess-2')
    const names = (await db.select().from(subject).where(eq(subject.userId, DEMO))).map(
      (s) => s.name,
    )
    expect(names).not.toContain('EDITED')
    expect((await db.select().from(subject).where(eq(subject.userId, DEMO))).length).toBe(2)
  })
})

describe('wipeUserData is scoped', () => {
  it('wiping the demo user leaves another user untouched', async () => {
    await runSeed('no-session')
    // Another user with their own data via the real services.
    const s = await makeSubject(db, 'other', { name: 'Other', color: '#000000', icon: 'book' })
    const d = await createDeck(db, 'other', { subjectId: s.id, name: 'D' })
    await createCard(db, 'other', { deckId: d.id, front: 'f', back: 'b' })

    await db.transaction(async (tx) => {
      await wipeUserData(tx, DEMO)
    })
    expect((await db.select().from(subject).where(eq(subject.userId, DEMO))).length).toBe(0)
    expect((await db.select().from(subject).where(eq(subject.userId, 'other'))).length).toBe(1)
    expect((await db.select().from(card).where(eq(card.userId, 'other'))).length).toBe(1)
  })
})
