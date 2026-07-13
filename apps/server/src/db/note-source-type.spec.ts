import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from './test-db'
import { note } from './schema'

let t: TestDb

beforeEach(async () => {
  t = await createTestDb()
})
afterEach(async () => {
  await t.cleanup()
})

describe('note_source_type_ck (additive migration 0002)', () => {
  it("accepts sourceType 'image'", async () => {
    const [row] = await t.db
      .insert(note)
      .values({ title: 'Photo', sourceType: 'image', content: 'transcription' })
      .returning()
    expect(row?.sourceType).toBe('image')
  })

  it("still accepts the legacy 'md' / 'pdf' values", async () => {
    await t.db.insert(note).values({ title: 'a', sourceType: 'md', content: 'x' })
    await t.db.insert(note).values({ title: 'b', sourceType: 'pdf', content: 'y' })
    expect(await t.db.select().from(note)).toHaveLength(2)
  })

  it('rejects an unknown sourceType (CHECK violation)', async () => {
    let threw = false
    try {
      await t.db.insert(note).values({ title: 'bad', sourceType: 'bogus', content: 'z' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})
