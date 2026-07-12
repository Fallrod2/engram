/**
 * Opt-in proofs against the REAL production driver (postgres-js) and a REAL
 * local Postgres (Supabase local, Docker up). Run via `bun run test:db:pg`.
 *
 * PGlite (the fast `test:db` gate) does NOT reproduce two behaviours that only
 * appear against postgres-js / real Postgres, so the audit requires proving them
 * here rather than trusting PGlite:
 *   1. Transaction rollback-on-throw (`reviewCard`, the review-session core).
 *   2. `SUM(bigint)` is serialized as a string by postgres-js → analytics
 *      endpoints must still return `number` and satisfy the shared contract.
 *
 * The N+1 spy (`spyOn(client, 'query')`) is exercised in `analytics.service.spec`
 * under the PGlite gate; it is driver-agnostic and not repeated here.
 *
 * This file is intentionally NOT named `*.spec.ts`, so the `test:db` gate never
 * loads it (it would otherwise be mocked onto PGlite by `db-preload`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { retentionResponseSchema, deckSuccessResponseSchema } from '@engram/shared'
import { db, sql } from './client'
import { resolveDatabaseUrl } from './paths'
import { card, reviewLog } from './schema'
import { resetDb, seedCard, seedDeck, seedReviewLog, seedSubject } from '../test-support/harness'
import { reviewCard } from '../services/review.service'
import { retention, deckSuccess } from '../services/analytics.service'

// Never run destructive DDL against anything but the local Supabase database.
const { hostname, port } = new URL(resolveDatabaseUrl())
const isLocal = (hostname === '127.0.0.1' || hostname === 'localhost') && port === '54322'
if (!isLocal) {
  throw new Error(
    `test:db:pg refused: DATABASE_URL must point at the local Supabase DB ` +
      `(127.0.0.1/localhost:54322), got ${hostname}:${port}.`,
  )
}

beforeAll(async () => {
  // Fresh schema on the disposable local DB, then apply the Drizzle baseline.
  await sql.unsafe(
    'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;',
  )
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
})
afterAll(async () => {
  await sql.end()
})
beforeEach(async () => {
  await resetDb(db)
})

describe('postgres-js: transaction rollback-on-throw', () => {
  it('a thrown guard in reviewCard leaves no review_log row (real rollback)', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    const c = await seedCard(db, d.id)
    // reviewedAt far in the future → the guard throws inside the transaction.
    const future = new Date(Date.now() + 10 * 60_000)
    await expect(reviewCard(db, c.id, { grade: 3, reviewedAt: future })).rejects.toThrow()
    // The write inside the tx must have rolled back.
    expect(await db.select().from(reviewLog)).toHaveLength(0)
    // And the card itself is untouched (reps still 0).
    const [row] = await db.select().from(card).where(eq(card.id, c.id))
    expect(row!.reps).toBe(0)
  })

  it('an explicit throw after an insert rolls the insert back', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    const c = await seedCard(db, d.id)
    const before = (await db.select().from(reviewLog)).length
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(reviewLog).values({
          cardId: c.id,
          rating: 3,
          state: 2,
          due: new Date(),
          stability: 0,
          difficulty: 0,
          elapsedDays: 0,
          lastElapsedDays: 0,
          scheduledDays: 0,
          learningSteps: 0,
          review: new Date(),
        })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await db.select().from(reviewLog)).toHaveLength(before)
  })
})

describe('postgres-js: SUM(bigint) returns number (contract-safe)', () => {
  it('retention: recalled is a number and the response parses the shared schema', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    const c = await seedCard(db, d.id)
    for (let i = 0; i < 12; i++) await seedReviewLog(db, c.id, { state: 2, rating: 3 })

    const res = await retention(db, {})
    const found = res.subjects.find((x) => x.subjectId === s.id)
    expect(found).toBeDefined()
    expect(typeof found!.recalled).toBe('number')
    expect(typeof found!.maturedReviewed).toBe('number')
    expect(found!.recalled).toBe(12)
    // The real contract guard: shared Zod (z.number().int()) must not throw.
    expect(() => retentionResponseSchema.parse(res)).not.toThrow()
  })

  it('deck-success: passed is a number and the response parses the shared schema', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    const c = await seedCard(db, d.id)
    for (let i = 0; i < 12; i++) await seedReviewLog(db, c.id, { state: 2, rating: 3 })

    const res = await deckSuccess(db, {})
    const found = res.decks.find((x) => x.deckId === d.id)
    expect(found).toBeDefined()
    expect(typeof found!.passed).toBe('number')
    expect(typeof found!.reviewed).toBe('number')
    expect(found!.passed).toBe(12)
    expect(() => deckSuccessResponseSchema.parse(res)).not.toThrow()
  })
})
