import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from './test-db'
import { aiCredential, generation, note } from './schema'

/**
 * Migration 0003 widens the two provider CHECK constraints to include the new
 * 'mistral' provider (`ai_credential_provider_ck`, `generation_provider_ck`).
 * These round-trips prove the migration is replayed by the PGlite migrator and
 * that a mistral credential / a mistral-stamped generation persist.
 */

let t: TestDb

beforeEach(async () => {
  t = await createTestDb()
})
afterEach(async () => {
  await t.cleanup()
})

describe('ai_credential_provider_ck (migration 0003)', () => {
  it("accepts a 'mistral' credential row", async () => {
    const [row] = await t.db
      .insert(aiCredential)
      .values({ provider: 'mistral', secret: 'mist-secret' })
      .returning()
    expect(row?.provider).toBe('mistral')
  })

  it('still accepts the legacy key-bearing providers', async () => {
    await t.db.insert(aiCredential).values({ provider: 'anthropic', secret: 'a' })
    await t.db.insert(aiCredential).values({ provider: 'openrouter', secret: 'b' })
    await t.db.insert(aiCredential).values({ provider: 'openai-compat', secret: 'c' })
    expect(await t.db.select().from(aiCredential)).toHaveLength(3)
  })

  it("rejects an unknown provider AND 'ollama' (no key stored)", async () => {
    let threwBogus = false
    try {
      await t.db.insert(aiCredential).values({ provider: 'bogus', secret: 'x' })
    } catch {
      threwBogus = true
    }
    expect(threwBogus).toBe(true)

    let threwOllama = false
    try {
      await t.db.insert(aiCredential).values({ provider: 'ollama', secret: 'x' })
    } catch {
      threwOllama = true
    }
    expect(threwOllama).toBe(true)
  })
})

describe('generation_provider_ck (migration 0003)', () => {
  it("stamps a generation with provider 'mistral'", async () => {
    const [n] = await t.db
      .insert(note)
      .values({ title: 'N', sourceType: 'image', content: 'x' })
      .returning()
    const [g] = await t.db
      .insert(generation)
      .values({ noteId: n!.id, kind: 'cards', model: 'mistral-small-latest', provider: 'mistral' })
      .returning()
    expect(g?.provider).toBe('mistral')
  })

  it('still allows a NULL provider (historical rows) and rejects an unknown one', async () => {
    const [n] = await t.db
      .insert(note)
      .values({ title: 'N', sourceType: 'md', content: 'x' })
      .returning()
    const [g] = await t.db
      .insert(generation)
      .values({ noteId: n!.id, kind: 'cards', model: 'm' })
      .returning()
    expect(g?.provider).toBeNull()

    let threw = false
    try {
      await t.db
        .insert(generation)
        .values({ noteId: n!.id, kind: 'cards', model: 'm', provider: 'bogus' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})
