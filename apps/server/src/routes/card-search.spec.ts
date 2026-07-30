import { beforeEach, describe, expect, it } from 'bun:test'
import { State } from 'ts-fsrs'
import {
  bulkCardResultSchema,
  searchCardsResponseSchema,
  CARD_BULK_MAX,
  CARD_SEARCH_LIMIT_DEFAULT,
  CARD_SEARCH_LIMIT_MAX,
} from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { card } from '../db/schema'
import { resetDb, seedCard, seedDeck, seedSubject } from '../test-support/harness'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'

/**
 * HTTP contract of the search + bulk endpoints — the shape the web will
 * consume. The domain behaviour itself is covered by
 * `services/card-search.spec.ts`; what is asserted here is routing, status
 * codes, query coercion and the schema-level caps.
 */

beforeEach(() => resetDb(db))

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

async function graph(name = 'Théorie des langages', deckName = 'Automates') {
  const s = await seedSubject(db, { name })
  const d = await seedDeck(db, s.id, { name: deckName })
  return { subject: s, deck: d }
}

describe('GET /api/cards/search', () => {
  it('returns the contract shape, deck and subject inline', async () => {
    const { subject, deck } = await graph()
    await seedCard(db, deck.id, { front: 'Théorème de Kleene', back: 'étoile' })

    const res = await app.request('/api/cards/search?q=theoreme')
    expect(res.status).toBe(200)
    const body = searchCardsResponseSchema.parse(await res.json())

    expect(body.total).toBe(1)
    expect(body.query).toBe('theoreme')
    expect(body.limit).toBe(CARD_SEARCH_LIMIT_DEFAULT)
    expect(body.offset).toBe(0)
    expect(body.hits).toHaveLength(1)
    expect(body.hits[0]!.deck).toEqual({ id: deck.id, name: 'Automates' })
    expect(body.hits[0]!.subject.id).toBe(subject.id)
    expect(body.hits[0]!.subject.name).toBe('Théorie des langages')
  })

  it('is NOT shadowed by GET /api/cards/:id', async () => {
    // Registration order matters: "search" must route to the search handler,
    // not be read as a card id (which would 404).
    const res = await app.request('/api/cards/search?q=')
    expect(res.status).toBe(200)
  })

  it('400s when q is absent entirely', async () => {
    const res = await app.request('/api/cards/search')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_error')
  })

  it('accepts an empty q as "no text filter"', async () => {
    const { deck } = await graph()
    await seedCard(db, deck.id, { front: 'a' })
    await seedCard(db, deck.id, { front: 'b' })
    const body = searchCardsResponseSchema.parse(
      await (await app.request('/api/cards/search?q=')).json(),
    )
    expect(body.total).toBe(2)
  })

  it('coerces and applies limit/offset', async () => {
    const { deck } = await graph()
    for (let i = 0; i < 5; i++) await seedCard(db, deck.id, { front: `terme ${i}` })
    const body = searchCardsResponseSchema.parse(
      await (await app.request('/api/cards/search?q=terme&limit=2&offset=1')).json(),
    )
    expect(body.total).toBe(5)
    expect(body.hits).toHaveLength(2)
    expect(body.limit).toBe(2)
    expect(body.offset).toBe(1)
  })

  it('caps limit server-side — a client asking for more is refused', async () => {
    const over = await app.request(`/api/cards/search?q=x&limit=${CARD_SEARCH_LIMIT_MAX + 1}`)
    expect(over.status).toBe(400)
    const at = await app.request(`/api/cards/search?q=x&limit=${CARD_SEARCH_LIMIT_MAX}`)
    expect(at.status).toBe(200)
    expect((await app.request('/api/cards/search?q=x&limit=0')).status).toBe(400)
    expect((await app.request('/api/cards/search?q=x&offset=-1')).status).toBe(400)
  })

  it('accepts the FSRS state NAMES and rejects a raw integer', async () => {
    const { deck } = await graph()
    await seedCard(db, deck.id, { front: 'terme', state: State.Review })
    await seedCard(db, deck.id, { front: 'terme', state: State.New })

    const body = searchCardsResponseSchema.parse(
      await (await app.request('/api/cards/search?q=terme&state=review')).json(),
    )
    expect(body.total).toBe(1)
    expect((await app.request('/api/cards/search?q=terme&state=2')).status).toBe(400)
    expect((await app.request('/api/cards/search?q=terme&state=nope')).status).toBe(400)
  })

  it('parses overdue as a true/false string', async () => {
    const { deck } = await graph()
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000)
    await seedCard(db, deck.id, { front: 'terme', due: yesterday })
    await seedCard(db, deck.id, { front: 'terme', due: new Date(Date.now() + 864e5) })

    const on = searchCardsResponseSchema.parse(
      await (await app.request('/api/cards/search?q=terme&overdue=true')).json(),
    )
    expect(on.total).toBe(1)
    const off = searchCardsResponseSchema.parse(
      await (await app.request('/api/cards/search?q=terme&overdue=false')).json(),
    )
    expect(off.total).toBe(2)
    expect((await app.request('/api/cards/search?q=terme&overdue=1')).status).toBe(400)
  })

  it('filters by deckId and subjectId', async () => {
    const g1 = await graph('Théorie', 'Deck 1')
    const g2 = await graph('Anglais', 'Deck 2')
    await seedCard(db, g1.deck.id, { front: 'terme' })
    await seedCard(db, g2.deck.id, { front: 'terme' })

    const byDeck = searchCardsResponseSchema.parse(
      await (await app.request(`/api/cards/search?q=terme&deckId=${g1.deck.id}`)).json(),
    )
    expect(byDeck.total).toBe(1)
    const bySubject = searchCardsResponseSchema.parse(
      await (await app.request(`/api/cards/search?q=terme&subjectId=${g2.subject.id}`)).json(),
    )
    expect(bySubject.total).toBe(1)
  })

  it('url-encoded accented needles survive the round-trip', async () => {
    const { deck } = await graph()
    await seedCard(db, deck.id, { front: 'Théorème', back: 'x' })
    const res = await app.request(`/api/cards/search?q=${encodeURIComponent('Théorème')}`)
    expect(searchCardsResponseSchema.parse(await res.json()).total).toBe(1)
  })
})

describe('POST /api/cards/bulk/delete', () => {
  it('deletes and reports requested/affected', async () => {
    const { deck } = await graph()
    const c1 = await seedCard(db, deck.id)
    const c2 = await seedCard(db, deck.id)
    const res = await postJson('/api/cards/bulk/delete', { cardIds: [c1.id, c2.id] })
    expect(res.status).toBe(200)
    expect(bulkCardResultSchema.parse(await res.json())).toEqual({ requested: 2, affected: 2 })
    expect((await db.select().from(card)).length).toBe(0)
  })

  it('404s on an unknown id and deletes nothing', async () => {
    const { deck } = await graph()
    const c = await seedCard(db, deck.id)
    const res = await postJson('/api/cards/bulk/delete', { cardIds: [c.id, 'ghost'] })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found')
    expect((await db.select().from(card)).length).toBe(1)
  })

  it('rejects an empty batch', async () => {
    const res = await postJson('/api/cards/bulk/delete', { cardIds: [] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_error')
  })

  it('refuses a batch over the cap, franchement', async () => {
    const ids = Array.from({ length: CARD_BULK_MAX + 1 }, (_, i) => `id-${i}`)
    const res = await postJson('/api/cards/bulk/delete', { cardIds: ids })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_error')
  })

  it('rejects a malformed body', async () => {
    expect((await postJson('/api/cards/bulk/delete', {})).status).toBe(400)
    expect((await postJson('/api/cards/bulk/delete', { cardIds: 'x' })).status).toBe(400)
    expect((await postJson('/api/cards/bulk/delete', { cardIds: [''] })).status).toBe(400)
  })
})

describe('POST /api/cards/bulk/move', () => {
  it('moves and reports requested/affected', async () => {
    const g = await graph()
    const dest = await seedDeck(db, g.subject.id, { name: 'Destination' })
    const c = await seedCard(db, g.deck.id)

    const res = await postJson('/api/cards/bulk/move', { cardIds: [c.id], deckId: dest.id })
    expect(res.status).toBe(200)
    expect(bulkCardResultSchema.parse(await res.json())).toEqual({ requested: 1, affected: 1 })
    const [row] = await db.select().from(card)
    expect(row!.deckId).toBe(dest.id)
  })

  it('404s on an unknown destination deck', async () => {
    const g = await graph()
    const c = await seedCard(db, g.deck.id)
    const res = await postJson('/api/cards/bulk/move', { cardIds: [c.id], deckId: 'ghost' })
    expect(res.status).toBe(404)
  })

  it('409s when the destination subject is archived', async () => {
    const g = await graph()
    const archived = await seedSubject(db, { name: 'Archivée', archived: true })
    const dest = await seedDeck(db, archived.id, { name: 'Dest' })
    const c = await seedCard(db, g.deck.id)

    const res = await postJson('/api/cards/bulk/move', { cardIds: [c.id], deckId: dest.id })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('conflict')
    const [row] = await db.select().from(card)
    expect(row!.deckId).toBe(g.deck.id)
  })

  it('requires deckId', async () => {
    const g = await graph()
    const c = await seedCard(db, g.deck.id)
    expect((await postJson('/api/cards/bulk/move', { cardIds: [c.id] })).status).toBe(400)
    expect((await postJson('/api/cards/bulk/move', { cardIds: [c.id], deckId: '' })).status).toBe(
      400,
    )
  })

  it('caps the batch like delete does', async () => {
    const ids = Array.from({ length: CARD_BULK_MAX + 1 }, (_, i) => `id-${i}`)
    const res = await postJson('/api/cards/bulk/move', { cardIds: ids, deckId: 'x' })
    expect(res.status).toBe(400)
  })
})

describe('scoping', () => {
  it('search only ever reads the caller’s own rows', async () => {
    // The route runs as DEFAULT_DEV_USER_ID; seed a second tenant alongside.
    const mine = await graph('À moi', 'Deck à moi')
    const other = await seedSubject(db, { userId: 'someone-else', name: 'À eux' })
    const otherDeck = await seedDeck(db, other.id, { userId: 'someone-else', name: 'Deck à eux' })
    await seedCard(db, mine.deck.id, { front: 'Kleene', userId: U })
    await seedCard(db, otherDeck.id, { front: 'Kleene', userId: 'someone-else' })

    const body = searchCardsResponseSchema.parse(
      await (await app.request('/api/cards/search?q=kleene')).json(),
    )
    expect(body.total).toBe(1)
    expect(body.hits[0]!.subject.name).toBe('À moi')
  })

  it('bulk delete cannot touch another tenant’s card', async () => {
    const other = await seedSubject(db, { userId: 'someone-else' })
    const otherDeck = await seedDeck(db, other.id, { userId: 'someone-else' })
    const theirs = await seedCard(db, otherDeck.id, { userId: 'someone-else' })

    const res = await postJson('/api/cards/bulk/delete', { cardIds: [theirs.id] })
    expect(res.status).toBe(404)
    expect((await db.select().from(card)).length).toBe(1)
  })

  it('bulk move cannot use another tenant’s deck as destination', async () => {
    const mine = await graph()
    const c = await seedCard(db, mine.deck.id, { userId: U })
    const other = await seedSubject(db, { userId: 'someone-else' })
    const otherDeck = await seedDeck(db, other.id, { userId: 'someone-else' })

    const res = await postJson('/api/cards/bulk/move', {
      cardIds: [c.id],
      deckId: otherDeck.id,
    })
    expect(res.status).toBe(404)
    const [row] = await db.select().from(card).limit(1)
    expect(row!.deckId).toBe(mine.deck.id)
  })
})
