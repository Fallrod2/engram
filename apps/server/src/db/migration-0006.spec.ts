import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'

/**
 * Migration 0006 backfill proof (spec BYOK §3.1). The production run of 0006 will
 * execute against Alex's REAL single-user data, so the backfill must be proven,
 * not assumed. `createTestDb()` migrates an EMPTY database (backfills no-op), so
 * here we reconstruct the pre-0006 shape (single-column PKs), seed legacy rows —
 * including a `key='demo'` cache marker and an unowned `ai_credential` — then run
 * ONLY the 0006 SQL and assert the owner backfill + demo-row deletion + the new
 * composite primary keys.
 */

const ADMIN = '20d58a6e-71c6-4af2-b1d4-143c93970f8b'

const sql0006 = readFileSync(
  fileURLToPath(new URL('../../drizzle/0006_byok_per_user.sql', import.meta.url)),
  'utf8',
)

let pg: PGlite
beforeEach(() => {
  pg = new PGlite()
})
afterEach(async () => {
  await pg.close()
})

/** Recreate the pre-0006 tables (single-column primary keys). */
async function seedPre0006(): Promise<void> {
  await pg.exec(`
    CREATE TABLE "app_settings" (
      "key" text PRIMARY KEY NOT NULL,
      "value" jsonb NOT NULL,
      "updated_at" timestamp with time zone NOT NULL
    );
    CREATE TABLE "ai_credential" (
      "provider" text PRIMARY KEY NOT NULL,
      "secret" text NOT NULL,
      "created_at" timestamp with time zone NOT NULL,
      "updated_at" timestamp with time zone NOT NULL,
      CONSTRAINT "ai_credential_provider_ck" CHECK ("provider" in ('anthropic','openrouter','openai-compat','mistral'))
    );
    INSERT INTO "app_settings" ("key","value","updated_at") VALUES
      ('ai', '{"activeProvider":"anthropic"}', now()),
      ('demo', '{"sessionId":"sess-legacy"}', now());
    INSERT INTO "ai_credential" ("provider","secret","created_at","updated_at") VALUES
      ('anthropic', 'legacy-secret', now(), now()),
      ('mistral', 'legacy-mistral', now(), now());
  `)
}

/** Apply the hand-edited 0006 SQL (split on drizzle statement breakpoints). */
async function apply0006(): Promise<void> {
  for (const stmt of sql0006.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim()
    if (trimmed.length > 0) await pg.exec(trimmed)
  }
}

describe('migration 0006 backfill (pre-0006 → per-user)', () => {
  it('backfills the AI config owner to the admin UID and drops the demo marker', async () => {
    await seedPre0006()
    await apply0006()

    const settings = await pg.query<{ key: string; user_id: string }>(
      'SELECT "key","user_id" FROM "app_settings" ORDER BY "key"',
    )
    // The ephemeral demo marker is gone; the 'ai' blob is owned by the admin.
    expect(settings.rows).toEqual([{ key: 'ai', user_id: ADMIN }])
  })

  it('backfills every ai_credential row to the admin UID', async () => {
    await seedPre0006()
    await apply0006()

    const creds = await pg.query<{ provider: string; user_id: string }>(
      'SELECT "provider","user_id" FROM "ai_credential" ORDER BY "provider"',
    )
    expect(creds.rows).toEqual([
      { provider: 'anthropic', user_id: ADMIN },
      { provider: 'mistral', user_id: ADMIN },
    ])
  })

  it('installs the composite PKs: the same key/provider is reusable by ANOTHER user', async () => {
    await seedPre0006()
    await apply0006()

    // (user_id,'ai') is now the PK → a second user may hold their own 'ai' blob.
    await pg.exec(
      `INSERT INTO "app_settings" ("user_id","key","value","updated_at") VALUES ('other-user','ai','{"activeProvider":"ollama"}', now())`,
    )
    await pg.exec(
      `INSERT INTO "ai_credential" ("user_id","provider","secret","created_at","updated_at") VALUES ('other-user','anthropic','other-secret', now(), now())`,
    )
    const n = await pg.query<{ c: number }>('SELECT count(*)::int AS c FROM "app_settings"')
    expect(n.rows[0]!.c).toBe(2)

    // …but the SAME (user_id,key) twice still violates the composite PK.
    let threw = false
    try {
      await pg.exec(
        `INSERT INTO "app_settings" ("user_id","key","value","updated_at") VALUES ('other-user','ai','{}', now())`,
      )
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})
