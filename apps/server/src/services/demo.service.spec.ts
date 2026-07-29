import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { State } from 'ts-fsrs'
import { STUDY_DAILY_GOAL_DEFAULT, STUDY_NEW_CARDS_PER_DAY_DEFAULT } from '@engram/shared'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import {
  appSettings,
  card,
  deck,
  exam,
  examSubject,
  generation,
  note,
  reviewLog,
  subject,
} from '../db/schema'
import { localDayDiff, localMidnight } from '../lib/day'
import {
  DEMO_LOCK_KEY,
  DEMO_PRERECORDED_MODEL,
  DEMO_QCM_CARDS,
  DEMO_SAMPLE_NOTE_TITLE,
  demoSeedStatus,
  readDemoMarker,
  seedDemo,
  wipeUserData,
} from './demo.service'
import { resolveGeneration } from './generations.service'
import { dueQueue } from './review-queue.service'
import { readStudySettings, updateStudySettings } from './study-settings.service'
import { getOnboardingStatus, setOnboardingCompleted } from './onboarding.service'
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

  /**
   * The pre-recorded generation (T-031). The visitor must be able to DO the real
   * card-by-card review without a provider — and must be told the result was
   * written in advance. These assertions pin both halves: the run is reviewable
   * (succeeded, items still to triage, a target deck to insert into) AND it is
   * marked, in the database, as what it is.
   */
  it('ships a sample note carrying a PRE-RECORDED generation', async () => {
    await runSeed('no-session')
    const notes = await db.select().from(note).where(eq(note.userId, DEMO))
    expect(notes.length).toBe(1)
    expect(notes[0]!.title).toBe(DEMO_SAMPLE_NOTE_TITLE)
    // A real import, not a stub: the note screen shows this content.
    expect(notes[0]!.content.length).toBeGreaterThan(1500)

    const gens = await db.select().from(generation).where(eq(generation.userId, DEMO))
    expect(gens.length).toBe(1)
    const g = gens[0]!
    expect(g.noteId).toBe(notes[0]!.id)
    expect(g.origin).toBe('prerecorded')
    expect(g.status).toBe('succeeded')
    expect(g.kind).toBe('mixed')
    // Reviewable: a target deck exists, so accepted cards have somewhere to land.
    expect(g.deckId).not.toBeNull()
  })

  it('never claims a model wrote the sample, and never invents a token count', async () => {
    // The one assertion that keeps the staging honest at the storage layer: a
    // reader of the raw table must not be able to mistake this for a real run.
    await runSeed('no-session')
    const [g] = await db.select().from(generation).where(eq(generation.userId, DEMO))
    expect(g!.model).toBe(DEMO_PRERECORDED_MODEL)
    expect(g!.model).not.toMatch(/claude|gpt|mistral|llama|sonnet|opus|haiku/i)
    expect(g!.provider).toBeNull()
    expect(g!.promptTokens).toBeNull()
    expect(g!.completionTokens).toBeNull()
  })

  it('leaves every proposal to triage — nothing is pre-accepted', async () => {
    await runSeed('no-session')
    const [g] = await db.select().from(generation).where(eq(generation.userId, DEMO))
    expect(g!.items.length).toBeGreaterThanOrEqual(6)
    expect(g!.items.every((i) => i.status === 'pending')).toBe(true)
    expect(g!.items.every((i) => i.cardId === undefined)).toBe(true)
    // At least one materialised cloze, so the review has more than one format.
    expect(g!.items.some((i) => i.kind === 'cloze')).toBe(true)
  })

  it('inserts the accepted proposals into a REAL deck (the flow is not staged)', async () => {
    // The claim the banner makes — "the review below is real" — verified end to
    // end through the production resolve path: accept one proposal, and a card
    // exists in the target deck, reviewable like any other.
    await runSeed('no-session')
    const [g] = await db.select().from(generation).where(eq(generation.userId, DEMO))
    const first = g!.items[0]!
    const before = (await db.select().from(card).where(eq(card.deckId, g!.deckId!))).length

    const resolved = await resolveGeneration(db, DEMO, g!.id, {
      items: [{ id: first.id, status: 'accepted', front: first.front, back: first.back }],
    })

    const inserted = resolved.items.find((i) => i.id === first.id)!
    expect(inserted.status).toBe('accepted')
    expect(inserted.cardId).toBeDefined()
    const after = await db.select().from(card).where(eq(card.deckId, g!.deckId!))
    expect(after.length).toBe(before + 1)
    expect(after.some((c) => c.id === inserted.cardId)).toBe(true)
  })

  it('a reseed wipes the visitor’s triage — the next visitor starts untouched', async () => {
    await runSeed('sess-1')
    const [g1] = await db.select().from(generation).where(eq(generation.userId, DEMO))
    await resolveGeneration(db, DEMO, g1!.id, {
      items: [{ id: g1!.items[0]!.id, status: 'rejected', front: 'x', back: 'y' }],
    })

    await runSeed('sess-2')
    const gens = await db.select().from(generation).where(eq(generation.userId, DEMO))
    expect(gens.length).toBe(1)
    expect(gens[0]!.items.every((i) => i.status === 'pending')).toBe(true)
  })

  it('stores the session marker', async () => {
    await runSeed('sess-abc')
    expect(await readDemoMarker(db, DEMO)).toBe('sess-abc')
  })

  /**
   * The new-card limit must not be able to break the shop window. Two distinct
   * risks, and the seed has to answer both.
   */
  it('leaves the visitor every new card of the dataset under the default limit', async () => {
    await runSeed('no-session')
    const res = await dueQueue(db, DEMO, { limit: 100, now: new Date() })
    // No seeded review lands on today (every replayed review is >= 2 days old),
    // so the visitor arrives with a full budget…
    expect(res.newCards).toBeDefined()
    expect(res.newCards.introduced).toBe(0)
    expect(res.newCards.limit).toBe(STUDY_NEW_CARDS_PER_DAY_DEFAULT)
    // …and the dataset's never-seen cards all fit inside it: nothing is withheld,
    // a visitor never lands on a queue that silently hides part of the demo.
    expect(res.newCards.withheld).toBe(0)
    const newCards = (await db.select().from(card).where(eq(card.userId, DEMO))).filter(
      (c) => c.state === State.New,
    )
    expect(newCards.length).toBeGreaterThan(0)
    expect(newCards.length).toBeLessThanOrEqual(STUDY_NEW_CARDS_PER_DAY_DEFAULT)
  })

  it('resets the pacing a previous visitor may have changed', async () => {
    // The demo account is SHARED. Without this reset, one visitor setting the
    // limit to 0 would hand every following visitor a queue with no new card.
    await runSeed('sess-1')
    await updateStudySettings(db, DEMO, { newCardsPerDay: 0, dailyGoal: 1 }, new Date())
    await runSeed('sess-2')
    expect(await readStudySettings(db, DEMO)).toEqual({
      newCardsPerDay: STUDY_NEW_CARDS_PER_DAY_DEFAULT,
      dailyGoal: STUDY_DAILY_GOAL_DEFAULT,
    })
    // …and the session marker written by the same transaction survived it.
    expect(await readDemoMarker(db, DEMO)).toBe('sess-2')
  })

  it('resets the first-run journey a previous visitor may have completed', async () => {
    // The twin of the test above, and the same guarantee: what a visitor does
    // must not be visible to the next one. Without this reset, one visitor
    // finishing (or quitting) the journey would leave behind a marker carrying
    // the instant they did it — on an account every later visitor logs into.
    // The route already refuses to write that marker for the demo, so this is
    // the second lock on the same door, and the one that also clears a marker
    // written before the account was flagged `is_demo`.
    await runSeed('sess-1')
    await setOnboardingCompleted(db, DEMO, true, { isDemo: false, env: {} })
    const completed = await getOnboardingStatus(db, DEMO, { isDemo: false, env: {} })
    expect(completed.reason).toBe('completed')
    expect(completed.completedAt).not.toBeNull()

    await runSeed('sess-2')

    // Nothing a visitor authored survives. Read as a NORMAL account (the demo
    // short-circuits to `reason: 'demo'` before it ever looks at the table, so
    // that reading would pass even with the marker still there): no marker, no
    // completion instant. The reason is now `existing-account` — derived from the
    // freshly seeded dataset, never from anything the previous visitor wrote.
    const after = await getOnboardingStatus(db, DEMO, { isDemo: false, env: {} })
    expect(after.reason).toBe('existing-account')
    expect(after.completedAt).toBeNull()
    // …and the session marker written by the same transaction survived it.
    expect(await readDemoMarker(db, DEMO)).toBe('sess-2')
  })

  it('clears the pacing and the journey in ONE statement, without touching the rest', async () => {
    // The two keys share a single scoped DELETE (`inArray`), so a regression that
    // drops one of them, or that widens the delete into "every key of this user",
    // is caught here rather than in production: widening would take the `demo`
    // session marker with it and make every request reseed for ever.
    await runSeed('sess-1')
    await updateStudySettings(db, DEMO, { newCardsPerDay: 3 }, new Date())
    await setOnboardingCompleted(db, DEMO, true, { isDemo: false, env: {} })

    const before = await db.select().from(appSettings).where(eq(appSettings.userId, DEMO))
    expect(before.map((r) => r.key).sort()).toEqual(['demo', 'onboarding', 'study'])

    await runSeed('sess-2')

    const after = await db.select().from(appSettings).where(eq(appSettings.userId, DEMO))
    expect(after.map((r) => r.key)).toEqual(['demo'])
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
   * The figure is pinned EXACTLY rather than bounded, so every added round-trip
   * is a deliberate edit to this line and not a silent drift — re-introducing a
   * per-row `for` loop (25 cards → 25 inserts, 60 logs → 60 more) blows straight
   * through it, but so does one careless extra SELECT.
   *
   * 15 → 16 when the seed started resetting the shared account's study pacing
   * (one scoped DELETE on `app_settings`): a preference a previous visitor left
   * behind must not follow the next one. Fixed cost, independent of the dataset.
   *
   * 16 → 18 for the pre-recorded generation (T-031): one INSERT into `note` and
   * one into `generation`. Also fixed cost, and irreducible — two tables cannot
   * share a statement. That is the whole increase: the items are a single jsonb
   * value, so the 7 proposals cost nothing beyond the row that carries them.
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
    expect(emitted).toBe(18)
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
