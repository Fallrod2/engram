import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from './test-db'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { generation, note } from './schema'
import { generationToDto } from './dto'

/**
 * Migration 0011 adds `generation.origin` — the provenance of a run's items
 * ('live' = a provider answered, 'prerecorded' = the cards were written by hand
 * and shipped with the demo, T-031).
 *
 * The claim under test is not "the column exists" but "the column cannot lie":
 *  1. a writer that says nothing gets 'live' (the demo seed is the only opt-in);
 *  2. an EXISTING row — one written before 0011 — reads back as 'live', which is
 *     true of it, so the backfill is not a guess;
 *  3. anything outside the two values is refused by the database, so a typo in a
 *     future writer surfaces as a failed insert and not as a generation that the
 *     UI silently stops disclosing;
 *  4. the value survives the DTO, because the disclosure banner is driven by the
 *     API field, not by a client-side heuristic.
 *
 * Test (2) replays the chain up to 0010 on its own PGlite, inserts a row while
 * the column does NOT exist, then applies the rest — the only honest way to
 * observe the backfill, since `createTestDb()` hands back a database where 0011
 * has already run.
 */

let t: TestDb
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(async () => {
  await t.cleanup()
})

/** A note to hang the generations off (FK, cascade). */
async function seedNote(db: TestDb['db'], id = 'note-origin'): Promise<string> {
  await db.insert(note).values({
    id,
    userId: U,
    title: 'Note',
    sourceType: 'md',
    content: '# Contenu',
  })
  return id
}

describe('generation.origin (migration 0011)', () => {
  it("defaults to 'live' — a writer that says nothing claims a real generation", async () => {
    const noteId = await seedNote(t.db)
    await t.db
      .insert(generation)
      .values({ id: 'g-default', userId: U, noteId, kind: 'cards', model: 'claude-sonnet-4-6' })
    const [row] = await t.db.select().from(generation).where(eq(generation.id, 'g-default'))
    expect(row?.origin).toBe('live')
  })

  it("persists 'prerecorded' when a writer opts in", async () => {
    const noteId = await seedNote(t.db)
    await t.db.insert(generation).values({
      id: 'g-staged',
      userId: U,
      noteId,
      kind: 'mixed',
      status: 'succeeded',
      origin: 'prerecorded',
      model: 'engram/demo-prerecorded',
    })
    const [row] = await t.db.select().from(generation).where(eq(generation.id, 'g-staged'))
    expect(row?.origin).toBe('prerecorded')
  })

  it('refuses any other value at the DATABASE level (a typo cannot ship)', async () => {
    const noteId = await seedNote(t.db)
    // Straight at the client: drizzle wraps the driver error in a "Failed query"
    // message that drops the constraint name, and the constraint name is the
    // whole point of this assertion.
    let raised: { constraint?: string; code?: string } = {}
    try {
      await t.client.exec(`
        INSERT INTO "generation"
          ("id","user_id","note_id","kind","model","origin","items","created_at","updated_at")
          VALUES ('g-bad', '${U}', '${noteId}', 'cards', 'm', 'fabricated',
                  '[]'::jsonb, now(), now());
      `)
    } catch (e) {
      raised = e as { constraint?: string; code?: string }
    }
    // Named, so this cannot pass for an unrelated reason (a missing NOT NULL
    // column would also throw, and would prove nothing about the CHECK).
    expect(raised.code).toBe('23514') // check_violation
    expect(raised.constraint).toBe('generation_origin_ck')
  })

  it('carries the value through the DTO — the banner reads the API, not a guess', async () => {
    const noteId = await seedNote(t.db)
    await t.db.insert(generation).values({
      id: 'g-dto',
      userId: U,
      noteId,
      kind: 'mixed',
      status: 'succeeded',
      origin: 'prerecorded',
      model: 'engram/demo-prerecorded',
    })
    const [row] = await t.db.select().from(generation).where(eq(generation.id, 'g-dto'))
    expect(generationToDto(row!).origin).toBe('prerecorded')
  })
})

/**
 * The backfill, exercised on the SHIPPED file. `createTestDb()` hands back a
 * database where 0011 has already run, so this block rebuilds the pre-0011 world
 * by replaying 0000→0010 by hand, writes a row exactly as production would have
 * written it then, and only afterwards applies `0011_generation_origin.sql`
 * verbatim. What is asserted is the real migration's effect on a real legacy row
 * — not the `DEFAULT` clause of a table this test wrote itself.
 */
describe("migration 0011 backfills pre-existing rows to 'live'", () => {
  let client: PGlite

  beforeEach(async () => {
    client = new PGlite()
  })
  afterEach(async () => {
    await client.close()
  })

  /** Run one migration file the way the migrator does (breakpoints are cosmetic here). */
  async function applyFile(tag: string): Promise<void> {
    const path = fileURLToPath(new URL(`../../drizzle/${tag}.sql`, import.meta.url))
    await client.exec((await readFile(path, 'utf8')).replaceAll('--> statement-breakpoint', ''))
  }

  it("a row written BEFORE the column existed reads back as 'live'", async () => {
    const journal = JSON.parse(
      await readFile(fileURLToPath(new URL('../../drizzle/meta/_journal.json', import.meta.url)), {
        encoding: 'utf8',
      }),
    ) as { entries: { tag: string }[] }
    const tags = journal.entries.map((e) => e.tag)
    // Premise guard: replay strictly what precedes 0011, located BY NAME rather
    // than as "all but the last". The original form assumed 0011 was the final
    // migration, so the first one added after it (0012) both broke this test and
    // would have made it re-apply 0011 twice. Anchoring on the index keeps the
    // "pre-0011 world" honest however many migrations land later.
    const idx = tags.indexOf('0011_generation_origin')
    expect(idx).toBeGreaterThan(0)

    for (const tag of tags.slice(0, idx)) await applyFile(tag)

    // The world as it was at 0010: no `origin` column at all.
    const columnCount = async (): Promise<number> => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'generation' AND column_name = 'origin'`,
      )
      return rows[0]?.n ?? 0
    }
    expect(await columnCount()).toBe(0)

    // `created_at`/`updated_at`/`items` carry CLIENT-side defaults (`$defaultFn`),
    // not SQL ones, so a raw insert must state them — as the app did at 0010.
    await client.exec(`
      INSERT INTO "note" ("id","user_id","title","source_type","content","created_at","updated_at")
        VALUES ('n-legacy', '${U}', 'Legacy', 'md', 'x', now(), now());
      INSERT INTO "generation"
        ("id","user_id","note_id","kind","status","model","items","created_at","updated_at")
        VALUES ('g-legacy', '${U}', 'n-legacy', 'cards', 'succeeded', 'claude-sonnet-4-6',
                '[]'::jsonb, now(), now());
    `)

    await applyFile('0011_generation_origin')

    const { rows } = await client.query<{ origin: string }>(
      `SELECT "origin" FROM "generation" WHERE "id" = 'g-legacy'`,
    )
    expect(rows[0]?.origin).toBe('live')
  })
})
