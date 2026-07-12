import { beforeEach, describe, expect, it } from 'bun:test'
import { apiErrorSchema, subjectSchema } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { card, deck, reviewLog, subject } from '../db/schema'
import { resetDb, seedCard, seedDeck, seedSubject } from '../test-support/harness'

beforeEach(() => resetDb(db))

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('subjects routes', () => {
  it('POST /api/subjects valid → 201 contract-valid', async () => {
    const res = await postJson('/api/subjects', {
      name: 'Anglais',
      color: '#22c55e',
      icon: 'languages',
    })
    expect(res.status).toBe(201)
    expect(subjectSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('POST /api/subjects non-hex color → 400 with details', async () => {
    const res = await postJson('/api/subjects', { name: 'X', color: 'red', icon: 'x' })
    expect(res.status).toBe(400)
    const body = apiErrorSchema.parse(await res.json())
    expect(body.error.code).toBe('validation_error')
    expect(body.error.details).toBeDefined()
  })

  it('GET /api/subjects excludes archived by default, includes with flag', async () => {
    await seedSubject(db, { name: 'Active' })
    await seedSubject(db, { name: 'Old', archived: true })
    const def = (await (await app.request('/api/subjects')).json()) as unknown[]
    expect(def).toHaveLength(1)
    const all = (await (
      await app.request('/api/subjects?includeArchived=true')
    ).json()) as unknown[]
    expect(all).toHaveLength(2)
  })

  it('GET/PATCH/DELETE missing id → 404', async () => {
    expect((await app.request('/api/subjects/nope')).status).toBe(404)
    expect((await postJson('/api/subjects/nope/archive', {})).status).toBe(404)
    expect((await app.request('/api/subjects/nope', { method: 'DELETE' })).status).toBe(404)
  })

  it('POST /api/subjects/:id/archive is idempotent', async () => {
    const s = await seedSubject(db)
    const first = await postJson(`/api/subjects/${s.id}/archive`, {})
    expect(first.status).toBe(200)
    const second = await postJson(`/api/subjects/${s.id}/archive`, {})
    expect(second.status).toBe(200)
    expect(subjectSchema.parse(await second.json()).archived).toBe(true)
  })

  it('DELETE /api/subjects/:id cascades to decks/cards/logs', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id)
    const res = await app.request(`/api/subjects/${s.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(await db.select().from(subject)).toHaveLength(0)
    expect(await db.select().from(deck)).toHaveLength(0)
    expect(await db.select().from(card)).toHaveLength(0)
    expect(await db.select().from(reviewLog)).toHaveLength(0)
  })
})
