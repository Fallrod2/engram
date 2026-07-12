import { beforeEach, describe, expect, it } from 'bun:test'
import { deckSchema } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { resetDb, seedDeck, seedSubject } from '../test-support/harness'

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

describe('decks routes', () => {
  it('POST /api/decks with missing subjectId → 404', async () => {
    const res = await postJson('/api/decks', { subjectId: 'nope', name: 'D' })
    expect(res.status).toBe(404)
  })

  it('POST /api/decks under an archived subject → 409', async () => {
    const s = seedSubject(db, { archived: true })
    const res = await postJson('/api/decks', { subjectId: s.id, name: 'D' })
    expect(res.status).toBe(409)
  })

  it('PATCH /api/decks/:id ignores subjectId; invalid body → 400', async () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    const d = seedDeck(db, s1.id)
    // subjectId is stripped by the update schema, so it is a no-op, not a move.
    const ok = await patchJson(`/api/decks/${d.id}`, { name: 'Renamed', subjectId: s2.id })
    const body = deckSchema.parse(await ok.json())
    expect(body.name).toBe('Renamed')
    expect(body.subjectId).toBe(s1.id)
    // Wrong-typed field → 400.
    const bad = await patchJson(`/api/decks/${d.id}`, { name: 123 })
    expect(bad.status).toBe(400)
  })

  it('CRUD nominal + subjectId filter', async () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    const created = await postJson('/api/decks', { subjectId: s1.id, name: 'A' })
    expect(created.status).toBe(201)
    const d = deckSchema.parse(await created.json())

    expect((await app.request(`/api/decks/${d.id}`)).status).toBe(200)
    seedDeck(db, s2.id)
    const filtered = (await (
      await app.request(`/api/decks?subjectId=${s1.id}`)
    ).json()) as unknown[]
    expect(filtered).toHaveLength(1)

    expect((await app.request(`/api/decks/${d.id}`, { method: 'DELETE' })).status).toBe(204)
  })
})
