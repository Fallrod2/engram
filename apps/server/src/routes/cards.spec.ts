import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { cardSchema, listCardsResponseSchema, reviewPreviewSchema } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { card, reviewLog } from '../db/schema'
import { resetDb, seedCard, seedDeck, seedSubject } from '../test-support/harness'
import { reviewCard } from '../services/review.service'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'

beforeEach(() => resetDb(db))

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const patchJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

async function newDeck() {
  return (await seedDeck(db, (await seedSubject(db)).id)).id
}

describe('cards routes', () => {
  it('POST /api/cards seeds FSRS and strips client FSRS fields', async () => {
    const deckId = await newDeck()
    const res = await postJson('/api/cards', {
      deckId,
      front: 'f',
      back: 'b',
      // These must be ignored, not error.
      fsrs: { state: 2, reps: 99 },
      state: 3,
      reps: 42,
    })
    expect(res.status).toBe(201)
    const c = cardSchema.parse(await res.json())
    expect(c.fsrs.state).toBe(0)
    expect(c.fsrs.reps).toBe(0)
    expect(c.fsrs.lastReview).toBeNull()
    expect(Math.abs(Date.parse(c.fsrs.due) - Date.now())).toBeLessThan(5_000)
  })

  it('POST /api/cards missing deck → 404, archived subject → 409', async () => {
    expect((await postJson('/api/cards', { deckId: 'nope', front: 'f', back: 'b' })).status).toBe(
      404,
    )
    const archivedDeck = await seedDeck(db, (await seedSubject(db, { archived: true })).id)
    const res = await postJson('/api/cards', { deckId: archivedDeck.id, front: 'f', back: 'b' })
    expect(res.status).toBe(409)
  })

  it('PATCH /api/cards/:id changes text, never FSRS state', async () => {
    const c = await seedCard(db, await newDeck())
    const res = await patchJson(`/api/cards/${c.id}`, { front: 'new' })
    const dto = cardSchema.parse(await res.json())
    expect(dto.front).toBe('new')
    expect(dto.fsrs.reps).toBe(0)
    expect(dto.fsrs.due).toBe(c.due.toISOString())
  })

  it('GET /api/cards paginates with total; bad limit → 400', async () => {
    const deckId = await newDeck()
    for (let i = 0; i < 3; i++) await seedCard(db, deckId)
    const res = await app.request(`/api/cards?deckId=${deckId}&limit=2&offset=0`)
    const body = listCardsResponseSchema.parse(await res.json())
    expect(body.total).toBe(3) // total ignores limit
    expect(body.cards).toHaveLength(2)
    expect((await app.request('/api/cards?limit=0')).status).toBe(400)
    expect((await app.request('/api/cards?limit=999')).status).toBe(400)
  })

  it('DELETE /api/cards/:id cascades review_log', async () => {
    const c = await seedCard(db, await newDeck())
    await reviewCard(db, U, c.id, { grade: 3 })
    expect(await db.select().from(reviewLog)).toHaveLength(1)
    expect((await app.request(`/api/cards/${c.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await db.select().from(card)).toHaveLength(0)
    expect(await db.select().from(reviewLog)).toHaveLength(0)
  })

  it('GET /api/cards/:id/preview is ordered and read-only', async () => {
    const c = await seedCard(db, await newDeck())
    const res = await app.request(`/api/cards/${c.id}/preview`)
    expect(res.status).toBe(200)
    const p = reviewPreviewSchema.parse(await res.json())
    expect(Date.parse(p.easy.due)).toBeGreaterThanOrEqual(Date.parse(p.good.due))
    expect(Date.parse(p.good.due)).toBeGreaterThanOrEqual(Date.parse(p.hard.due))
    expect(Date.parse(p.hard.due)).toBeGreaterThanOrEqual(Date.parse(p.again.due))
    // No DB write: the card is untouched.
    const [row] = await db.select().from(card).where(eq(card.id, c.id))
    expect(row!.reps).toBe(0)
    expect(row!.state).toBe(0)
  })

  it('GET /api/cards/:id/preview: missing → 404, bad now → 400', async () => {
    expect((await app.request('/api/cards/nope/preview')).status).toBe(404)
    const c = await seedCard(db, await newDeck())
    expect((await app.request(`/api/cards/${c.id}/preview?now=not-a-date`)).status).toBe(400)
  })
})
