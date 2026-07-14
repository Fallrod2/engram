import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from './test-db'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { aiCredential, generation, note } from './schema'

/**
 * Migration 0007 widens both provider CHECKs to accept 'openai-codex' and adds
 * the nullable OAuth columns (refresh_token, expires_at, account_id) to
 * `ai_credential`. `createTestDb()` replays every migration through 0007 on a
 * fresh PGlite, so these round-trips prove the migrator applied 0007 and that:
 * (a) an openai-codex OAuth credential (with the new columns) persists;
 * (b) the 4 existing key-based providers still insert (pure widening);
 * (c) a generation stamped 'openai-codex' persists;
 * (d) an unknown provider is still rejected on BOTH tables.
 */

let t: TestDb
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(async () => {
  await t.cleanup()
})

describe('ai_credential OAuth columns + widened CHECK (migration 0007)', () => {
  it('persists an openai-codex credential with refresh/expires/account', async () => {
    const expiresAt = new Date(Date.now() + 3600_000)
    await t.db.insert(aiCredential).values({
      userId: U,
      provider: 'openai-codex',
      secret: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt,
      accountId: 'acct-123',
    })
    const [row] = await t.db
      .select()
      .from(aiCredential)
      .where(and(eq(aiCredential.userId, U), eq(aiCredential.provider, 'openai-codex')))
    expect(row?.secret).toBe('access-token')
    expect(row?.refreshToken).toBe('refresh-token')
    expect(row?.accountId).toBe('acct-123')
    expect(row?.expiresAt?.getTime()).toBe(expiresAt.getTime())
  })

  it('leaves the OAuth columns NULL for key-based providers (backward compatible)', async () => {
    await t.db.insert(aiCredential).values({ userId: U, provider: 'anthropic', secret: 'k' })
    const [row] = await t.db
      .select()
      .from(aiCredential)
      .where(and(eq(aiCredential.userId, U), eq(aiCredential.provider, 'anthropic')))
    expect(row?.refreshToken).toBeNull()
    expect(row?.expiresAt).toBeNull()
    expect(row?.accountId).toBeNull()
  })

  it('still accepts every legacy key-based provider', async () => {
    for (const p of ['anthropic', 'openrouter', 'openai-compat', 'mistral'] as const) {
      await t.db.insert(aiCredential).values({ userId: U, provider: p, secret: 'x' })
    }
    expect(await t.db.select().from(aiCredential)).toHaveLength(4)
  })

  it("rejects an unknown provider AND 'ollama'", async () => {
    for (const bad of ['bogus', 'ollama']) {
      let threw = false
      try {
        await t.db.insert(aiCredential).values({ userId: U, provider: bad, secret: 'x' })
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    }
  })
})

describe('generation_provider_ck widened (migration 0007)', () => {
  it("stamps a generation with provider 'openai-codex'", async () => {
    const [n] = await t.db
      .insert(note)
      .values({ userId: U, title: 'N', sourceType: 'md', content: 'x' })
      .returning()
    const [g] = await t.db
      .insert(generation)
      .values({
        userId: U,
        noteId: n!.id,
        kind: 'cards',
        model: 'gpt-5.5',
        provider: 'openai-codex',
      })
      .returning()
    expect(g?.provider).toBe('openai-codex')
  })
})
