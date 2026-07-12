import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  generationSchema,
  listCardsResponseSchema,
  listGenerationsResponseSchema,
} from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { generation, note } from '../db/schema'
import { resetDb, seedDeck, seedSubject } from '../test-support/harness'
import { setCardGenerator, resetCardGenerator, type CardGenerator } from '../ai/generator'
import { runGenerationJob } from '../services/generations.service'

// One card per call — the fire-and-forget job launched by POST /api/generations
// uses this via the registry, so the real Anthropic API is NEVER called.
const fakeGen: CardGenerator = {
  async generate() {
    return { cards: [{ front: 'Q1', back: 'A1' }], promptTokens: 10, completionTokens: 5 }
  },
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  resetDb(db)
  setCardGenerator(fakeGen)
  // A non-empty placeholder — NEVER a real key — so the 503 guard passes.
  process.env.ANTHROPIC_API_KEY = 'test-placeholder-not-a-real-key'
})
afterAll(() => {
  resetCardGenerator()
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY
})

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

function seedNote(content = 'quelques notes de cours'): string {
  return db.insert(note).values({ title: 'N', sourceType: 'md', content }).returning().get().id
}

describe('generations routes', () => {
  it('POST without a key → 503, no row created', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const noteId = seedNote()
    const res = await postJson('/api/generations', { noteId, kind: 'cards' })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('service_unavailable')
    expect(db.select().from(generation).all()).toHaveLength(0)
  })

  it('POST unknown noteId → 404', async () => {
    expect((await postJson('/api/generations', { noteId: 'nope', kind: 'cards' })).status).toBe(404)
  })

  it('POST into an archived-subject deck → 409', async () => {
    const noteId = seedNote()
    const deck = seedDeck(db, seedSubject(db, { archived: true }).id)
    const res = await postJson('/api/generations', { noteId, kind: 'cards', deckId: deck.id })
    expect(res.status).toBe(409)
  })

  it('POST valid → 202, status pending, items []', async () => {
    const noteId = seedNote()
    const res = await postJson('/api/generations', { noteId, kind: 'cards' })
    expect(res.status).toBe(202)
    const g = generationSchema.parse(await res.json())
    expect(g.status).toBe('pending')
    expect(g.items).toEqual([])
  })

  it('GET /:id reflects status after the job runs (succeeded, items)', async () => {
    const noteId = seedNote()
    const g = generationSchema.parse(
      await (await postJson('/api/generations', { noteId, kind: 'cards' })).json(),
    )
    await runGenerationJob(db, g.id, fakeGen) // idempotent — settles to succeeded
    const polled = generationSchema.parse(
      await (await app.request(`/api/generations/${g.id}`)).json(),
    )
    expect(polled.status).toBe('succeeded')
    expect(polled.items).toHaveLength(1)
  })

  it('GET ?noteId= lists a note generations', async () => {
    const noteId = seedNote()
    await postJson('/api/generations', { noteId, kind: 'cards' })
    const list = listGenerationsResponseSchema.parse(
      await (await app.request(`/api/generations?noteId=${noteId}`)).json(),
    )
    expect(list.generations).toHaveLength(1)
    expect(list.generations[0]?.noteId).toBe(noteId)
  })

  it('POST /:id/resolve applies decisions and inserts accepted cards', async () => {
    const noteId = seedNote()
    const deck = seedDeck(db, seedSubject(db).id)
    const g = generationSchema.parse(
      await (await postJson('/api/generations', { noteId, kind: 'cards', deckId: deck.id })).json(),
    )
    await runGenerationJob(db, g.id, fakeGen)
    const ready = generationSchema.parse(
      await (await app.request(`/api/generations/${g.id}`)).json(),
    )
    const item = ready.items[0]
    expect(item).toBeDefined()
    const res = await postJson(`/api/generations/${g.id}/resolve`, {
      items: [{ id: item!.id, front: item!.front, back: item!.back, status: 'accepted' }],
    })
    expect(res.status).toBe(200)
    const cards = listCardsResponseSchema.parse(
      await (await app.request(`/api/cards?deckId=${deck.id}`)).json(),
    )
    expect(cards.total).toBe(1)
    expect(cards.cards[0]?.front).toBe('Q1')
  })

  it('POST /:id/resolve twice → no duplicate cards', async () => {
    const noteId = seedNote()
    const deck = seedDeck(db, seedSubject(db).id)
    const g = generationSchema.parse(
      await (await postJson('/api/generations', { noteId, kind: 'cards', deckId: deck.id })).json(),
    )
    await runGenerationJob(db, g.id, fakeGen)
    const ready = generationSchema.parse(
      await (await app.request(`/api/generations/${g.id}`)).json(),
    )
    const decision = {
      items: ready.items.map((i) => ({
        id: i.id,
        front: i.front,
        back: i.back,
        status: 'accepted',
      })),
    }
    await postJson(`/api/generations/${g.id}/resolve`, decision)
    await postJson(`/api/generations/${g.id}/resolve`, decision)
    const cards = listCardsResponseSchema.parse(
      await (await app.request(`/api/cards?deckId=${deck.id}`)).json(),
    )
    expect(cards.total).toBe(1)
  })

  it('DELETE /:id → 204', async () => {
    const noteId = seedNote()
    const g = generationSchema.parse(
      await (await postJson('/api/generations', { noteId, kind: 'cards' })).json(),
    )
    expect((await app.request(`/api/generations/${g.id}`, { method: 'DELETE' })).status).toBe(204)
  })
})
