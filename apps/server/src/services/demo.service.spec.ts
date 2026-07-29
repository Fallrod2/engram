import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { card, deck, exam, examSubject, reviewLog, subject } from '../db/schema'
import { localDayDiff, localMidnight } from '../lib/day'
import {
  DEMO_LOCK_KEY,
  DEMO_QCM_CARDS,
  demoSeedStatus,
  readDemoMarker,
  seedDemo,
  wipeUserData,
} from './demo.service'
import { dueQueue } from './review-queue.service'
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

  it('writes 25 DISTINCT cards — no duplicate ever reaches the database (T-027)', async () => {
    // The pure invariant lives in `demo-seed.test.ts`; this is the same claim
    // asserted on what actually landed in the tables, QCM included.
    await runSeed('no-session')
    const rows = await db.select().from(card).where(eq(card.userId, DEMO))
    expect(new Set(rows.map((c) => c.front.trim().toLowerCase())).size).toBe(rows.length)
  })

  it('seeds every multiple-choice card (T-022)', async () => {
    await runSeed('no-session')
    const fronts = new Set(
      (await db.select().from(card).where(eq(card.userId, DEMO))).map((c) => c.front),
    )
    for (const qcm of DEMO_QCM_CARDS) expect(fronts.has(qcm.front)).toBe(true)
  })

  it('hands a QCM to the visitor at the head of the due queue', async () => {
    await runSeed('no-session')
    // The whole point of seeding QCM: a visitor must MEET one. `dueQueue` orders
    // by due asc then created_at asc, and the learning-profile QCM is both 6 days
    // overdue and seeded first, so it comes out top of the queue.
    const { cards } = await dueQueue(db, DEMO, { limit: 3, now: new Date() })
    const qcmFronts = new Set(DEMO_QCM_CARDS.map((q) => q.front))
    expect(cards.filter((c) => qcmFronts.has(c.front)).length).toBeGreaterThan(0)
  })

  it('stores the session marker', async () => {
    await runSeed('sess-abc')
    expect(await readDemoMarker(db, DEMO)).toBe('sess-abc')
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
    expect(await readDemoMarker(db, DEMO)).toBe('sess-2')
    const names = (await db.select().from(subject).where(eq(subject.userId, DEMO))).map(
      (s) => s.name,
    )
    expect(names).not.toContain('EDITED')
    expect((await db.select().from(subject).where(eq(subject.userId, DEMO))).length).toBe(2)
  })
})

describe('seedDemo round-trip budget', () => {
  /**
   * THE point of the batching rework. The seed runs on Vercel against a database
   * in another datacentre, so what costs is the NUMBER of statements, not the
   * work each one does: it used to emit 101 and take ~15 s in production.
   *
   * The bound is asserted, not the exact figure, so adding a column or a wipe
   * target does not fail the suite — but re-introducing a per-row `for` loop
   * (25 cards → 25 inserts, 60 logs → 60 more) blows straight through it.
   *
   * drizzle-orm/pglite calls `client.query()` exactly once per executed
   * statement, so this counts real round-trips. `seedDemo` is driven WITHOUT
   * `db.transaction` on purpose: PGlite's transaction handle is a different
   * object and its statements would not pass through the spy.
   */
  it('emits a bounded number of statements (no per-row insert)', async () => {
    const spy = spyOn(t.client, 'query')
    const before = spy.mock.calls.length
    await seedDemo(db as never, DEMO, 'budget')
    const emitted = spy.mock.calls.length - before
    spy.mockRestore()
    expect(emitted).toBe(15)
  })

  it('still writes the whole dataset in that budget', async () => {
    await seedDemo(db as never, DEMO, 'budget')
    expect((await db.select().from(card).where(eq(card.userId, DEMO))).length).toBe(25)
    expect((await db.select().from(reviewLog).where(eq(reviewLog.userId, DEMO))).length).toBe(60)
  })

  it('gives the cards strictly increasing created_at (the due-queue tie-break)', async () => {
    // Batched inserts share one clock, so the ordering that used to come for free
    // from one-insert-per-card is now stated explicitly. If it regresses, the QCM
    // stops being the first card the visitor meets — silently.
    await runSeed('no-session')
    const rows = await db.select().from(card).where(eq(card.userId, DEMO))
    const times = rows.map((c) => c.createdAt.getTime()).sort((a, b) => a - b)
    expect(new Set(times).size).toBe(times.length)
  })
})

describe('demoSeedStatus', () => {
  it('is pending before anything is seeded', async () => {
    expect(await demoSeedStatus(db, DEMO, 'sess-1')).toEqual({ state: 'pending', readyAt: null })
  })

  it('is ready once THIS session is committed', async () => {
    await runSeed('sess-1')
    const s = await demoSeedStatus(db, DEMO, 'sess-1')
    expect(s.state).toBe('ready')
    expect(typeof s.readyAt).toBe('string')
  })

  it('falls back to pending for a DIFFERENT session (a reseed is still owed)', async () => {
    await runSeed('sess-1')
    expect(await demoSeedStatus(db, DEMO, 'sess-2')).toEqual({ state: 'pending', readyAt: null })
  })

  it('reports seeding while the demo advisory lock is held', async () => {
    // The status probe reads `pg_locks` for the very lock `http/demo.ts` takes
    // inside the seeding transaction. Taking it at session scope here produces
    // the SAME lock identity (classid 0, objid KEY, objsubid 1), so this pins the
    // predicate itself. The concurrent case cannot be staged on PGlite (single
    // connection); what is proven here is that the probe matches the real lock.
    await db.execute(sql`select pg_advisory_lock(${DEMO_LOCK_KEY})`)
    try {
      expect(await demoSeedStatus(db, DEMO, 'sess-1')).toEqual({ state: 'seeding', readyAt: null })
    } finally {
      await db.execute(sql`select pg_advisory_unlock(${DEMO_LOCK_KEY})`)
    }
  })

  it('a held lock never overrides a committed session (ready wins)', async () => {
    await runSeed('sess-1')
    await db.execute(sql`select pg_advisory_lock(${DEMO_LOCK_KEY})`)
    try {
      expect((await demoSeedStatus(db, DEMO, 'sess-1')).state).toBe('ready')
    } finally {
      await db.execute(sql`select pg_advisory_unlock(${DEMO_LOCK_KEY})`)
    }
  })

  it('is scoped: another user never reads the demo account as ready', async () => {
    await runSeed('sess-1')
    expect(await demoSeedStatus(db, 'other', 'sess-1')).toEqual({
      state: 'pending',
      readyAt: null,
    })
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
