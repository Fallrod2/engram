import { beforeEach, describe, expect, it } from 'bun:test'
import { dueCountsSchema, reviewQueueResponseSchema, reviewResultSchema } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { resetDb, seedCard, seedDeck, seedSubject } from '../test-support/harness'

beforeEach(() => resetDb(db))

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const NOW = '2026-07-12T10:00:00.000Z'
const past = new Date(Date.parse(NOW) - 3_600_000)
const future = new Date(Date.parse(NOW) + 3_600_000)

function newDeck() {
  return seedDeck(db, seedSubject(db).id).id
}

describe('review routes', () => {
  it('GET /api/review/queue → contract-valid, now-deterministic', async () => {
    const deckId = newDeck()
    seedCard(db, deckId, { due: past })
    seedCard(db, deckId, { due: future })
    const res = await app.request(`/api/review/queue?now=${NOW}`)
    const body = reviewQueueResponseSchema.parse(await res.json())
    expect(body.now).toBe(NOW)
    expect(body.total).toBe(1)
    expect(body.cards).toHaveLength(1)
  })

  it('POST /api/cards/:id/review reschedules the card', async () => {
    const c = seedCard(db, newDeck(), { due: past })
    const res = await postJson(`/api/cards/${c.id}/review`, { grade: 3, durationMs: 4200 })
    expect(res.status).toBe(200)
    const result = reviewResultSchema.parse(await res.json())
    expect(Date.parse(result.card.fsrs.due)).toBeGreaterThan(Date.now())
    // No longer due right now.
    const q = reviewQueueResponseSchema.parse(
      await (await app.request(`/api/review/queue?now=${new Date().toISOString()}`)).json(),
    )
    expect(q.total).toBe(0)
  })

  it('POST /api/cards/:id/review invalid grades → 400', async () => {
    const c = seedCard(db, newDeck())
    for (const grade of [0, 5, 'x']) {
      expect((await postJson(`/api/cards/${c.id}/review`, { grade })).status).toBe(400)
    }
  })

  it('POST /api/cards/:id/review missing card → 404', async () => {
    expect((await postJson('/api/cards/nope/review', { grade: 3 })).status).toBe(404)
  })

  it('POST /api/cards/:id/review rejects incoherent reviewedAt', async () => {
    const c = seedCard(db, newDeck())
    const far = new Date(Date.now() + 5 * 60_000).toISOString()
    expect(
      (await postJson(`/api/cards/${c.id}/review`, { grade: 3, reviewedAt: far })).status,
    ).toBe(400)
    // Establish a lastReview, then submit an earlier reviewedAt.
    await postJson(`/api/cards/${c.id}/review`, { grade: 3, reviewedAt: new Date().toISOString() })
    const earlier = new Date(Date.now() - 3_600_000).toISOString()
    expect(
      (await postJson(`/api/cards/${c.id}/review`, { grade: 3, reviewedAt: earlier })).status,
    ).toBe(400)
  })

  it('GET /api/review/counts is contract-valid and consistent with the queue', async () => {
    const deckId = newDeck()
    seedCard(db, deckId, { due: past })
    seedCard(db, deckId, { due: past })
    seedCard(db, deckId, { due: future })
    const counts = dueCountsSchema.parse(
      await (await app.request(`/api/review/counts?now=${NOW}`)).json(),
    )
    const queue = reviewQueueResponseSchema.parse(
      await (await app.request(`/api/review/queue?now=${NOW}`)).json(),
    )
    expect(counts.now).toBe(NOW)
    expect(counts.total).toBe(2)
    expect(counts.total).toBe(queue.total)
  })
})
