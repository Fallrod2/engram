import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { seedCard, seedDeck, seedSubject } from '../test-support/harness'
import { dueCounts, dueQueue } from './review-queue.service'

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

// Dynamique : queue_new_cards_are_due sème une carte dont le due par défaut
// est l'heure réelle de création — une date figée devient fausse avec le temps.
const NOW = new Date()
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const ahead = (ms: number) => new Date(NOW.getTime() + ms)
const HOUR = 3_600_000

describe('dueQueue', () => {
  it('queue_only_due_cards', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id, { due: ago(HOUR) })
    await seedCard(db, d.id, { due: NOW })
    await seedCard(db, d.id, { due: ahead(HOUR) })
    const { total, cards } = await dueQueue(db, { limit: 50, now: NOW })
    expect(total).toBe(2)
    expect(cards).toHaveLength(2)
  })

  it('queue_excludes_archived_subject', async () => {
    const active = await seedDeck(db, (await seedSubject(db)).id)
    const archived = await seedDeck(db, (await seedSubject(db, { archived: true })).id)
    await seedCard(db, active.id, { due: ago(HOUR) })
    await seedCard(db, archived.id, { due: ago(HOUR) })
    const { total } = await dueQueue(db, { limit: 50, now: NOW })
    expect(total).toBe(1)
  })

  it('queue_filter_by_deck', async () => {
    const s = await seedSubject(db)
    const d1 = await seedDeck(db, s.id)
    const d2 = await seedDeck(db, s.id)
    await seedCard(db, d1.id, { due: ago(HOUR) })
    await seedCard(db, d2.id, { due: ago(HOUR) })
    expect((await dueQueue(db, { limit: 50, now: NOW, deckId: d1.id })).total).toBe(1)
  })

  it('queue_filter_by_subject', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    await seedCard(db, (await seedDeck(db, s1.id)).id, { due: ago(HOUR) })
    await seedCard(db, (await seedDeck(db, s2.id)).id, { due: ago(HOUR) })
    expect((await dueQueue(db, { limit: 50, now: NOW, subjectId: s1.id })).total).toBe(1)
  })

  it('queue_order_due_asc', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id, { due: ago(HOUR), front: 'b' })
    await seedCard(db, d.id, { due: ago(3 * HOUR), front: 'a' })
    await seedCard(db, d.id, { due: ago(2 * HOUR), front: 'c' })
    const fronts = (await dueQueue(db, { limit: 50, now: NOW })).cards.map((c) => c.front)
    expect(fronts).toEqual(['a', 'c', 'b'])
  })

  it('queue_limit_and_total', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    for (let i = 0; i < 5; i++) await seedCard(db, d.id, { due: ago((i + 1) * HOUR) })
    const { total, cards } = await dueQueue(db, { limit: 2, now: NOW })
    expect(total).toBe(5)
    expect(cards).toHaveLength(2)
  })

  it('queue_new_cards_are_due', async () => {
    const d = await seedDeck(db, (await seedSubject(db)).id)
    await seedCard(db, d.id) // default due = real creation instant (New card)
    // Query just after the real creation time (the default due uses `new Date()`,
    // not the fixed NOW), so the assertion never depends on the wall clock.
    const { total } = await dueQueue(db, { limit: 50, now: new Date(Date.now() + 60_000) })
    expect(total).toBe(1)
  })

  it('queue_empty_deck', async () => {
    await seedDeck(db, (await seedSubject(db)).id)
    expect(await dueQueue(db, { limit: 50, now: NOW })).toEqual({ total: 0, cards: [] })
  })
})

describe('dueCounts', () => {
  it('counts_by_subject_excludes_archived_includes_zero', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db) // no due cards → 0
    const archived = await seedSubject(db, { archived: true })
    await seedCard(db, (await seedDeck(db, s1.id)).id, { due: ago(HOUR) })
    await seedCard(db, (await seedDeck(db, archived.id)).id, { due: ago(HOUR) })

    const res = await dueCounts(db, NOW)
    const ids = res.bySubject.map((b) => b.subjectId)
    expect(ids).toContain(s1.id)
    expect(ids).toContain(s2.id)
    expect(ids).not.toContain(archived.id)
    expect(res.bySubject.find((b) => b.subjectId === s1.id)!.dueCount).toBe(1)
    expect(res.bySubject.find((b) => b.subjectId === s2.id)!.dueCount).toBe(0)
    expect(res.total).toBe(1)
  })

  it('counts_by_deck', async () => {
    const s = await seedSubject(db)
    const d1 = await seedDeck(db, s.id)
    const d2 = await seedDeck(db, s.id)
    await seedCard(db, d1.id, { due: ago(HOUR) })
    await seedCard(db, d1.id, { due: ago(HOUR) })
    await seedCard(db, d2.id, { due: ago(HOUR) })
    const res = await dueCounts(db, NOW)
    const deckSum = res.byDeck
      .filter((b) => b.subjectId === s.id)
      .reduce((acc, b) => acc + b.dueCount, 0)
    expect(deckSum).toBe(res.bySubject.find((b) => b.subjectId === s.id)!.dueCount)
    expect(deckSum).toBe(3)
  })

  it('counts_deck_with_no_due_cards_present_zero', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id, { due: ahead(HOUR) }) // not due
    const res = await dueCounts(db, NOW)
    expect(res.byDeck.find((b) => b.deckId === d.id)!.dueCount).toBe(0)
  })

  it('counts_subject_with_no_deck_present', async () => {
    const s = await seedSubject(db) // no deck at all
    const res = await dueCounts(db, NOW)
    expect(res.bySubject.find((b) => b.subjectId === s.id)).toEqual({
      subjectId: s.id,
      dueCount: 0,
    })
  })
})
