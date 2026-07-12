import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { seedCard, seedDeck, seedSubject } from '../test-support/harness'
import { dueCounts, dueQueue } from './review-queue.service'

let t: TestDb
// See review.service.spec: assert the test handle back to `DB` (adds `$client`).
let db: DB
beforeEach(() => {
  t = createTestDb()
  db = t.db as DB
})
afterEach(() => {
  t.cleanup()
})

// Dynamique : queue_new_cards_are_due sème une carte dont le due par défaut
// est l'heure réelle de création — une date figée devient fausse avec le temps.
const NOW = new Date()
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const ahead = (ms: number) => new Date(NOW.getTime() + ms)
const HOUR = 3_600_000

describe('dueQueue', () => {
  it('queue_only_due_cards', () => {
    const s = seedSubject(db)
    const d = seedDeck(db, s.id)
    seedCard(db, d.id, { due: ago(HOUR) })
    seedCard(db, d.id, { due: NOW })
    seedCard(db, d.id, { due: ahead(HOUR) })
    const { total, cards } = dueQueue(db, { limit: 50, now: NOW })
    expect(total).toBe(2)
    expect(cards).toHaveLength(2)
  })

  it('queue_excludes_archived_subject', () => {
    const active = seedDeck(db, seedSubject(db).id)
    const archived = seedDeck(db, seedSubject(db, { archived: true }).id)
    seedCard(db, active.id, { due: ago(HOUR) })
    seedCard(db, archived.id, { due: ago(HOUR) })
    const { total } = dueQueue(db, { limit: 50, now: NOW })
    expect(total).toBe(1)
  })

  it('queue_filter_by_deck', () => {
    const s = seedSubject(db)
    const d1 = seedDeck(db, s.id)
    const d2 = seedDeck(db, s.id)
    seedCard(db, d1.id, { due: ago(HOUR) })
    seedCard(db, d2.id, { due: ago(HOUR) })
    expect(dueQueue(db, { limit: 50, now: NOW, deckId: d1.id }).total).toBe(1)
  })

  it('queue_filter_by_subject', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    seedCard(db, seedDeck(db, s1.id).id, { due: ago(HOUR) })
    seedCard(db, seedDeck(db, s2.id).id, { due: ago(HOUR) })
    expect(dueQueue(db, { limit: 50, now: NOW, subjectId: s1.id }).total).toBe(1)
  })

  it('queue_order_due_asc', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id, { due: ago(HOUR), front: 'b' })
    seedCard(db, d.id, { due: ago(3 * HOUR), front: 'a' })
    seedCard(db, d.id, { due: ago(2 * HOUR), front: 'c' })
    const fronts = dueQueue(db, { limit: 50, now: NOW }).cards.map((c) => c.front)
    expect(fronts).toEqual(['a', 'c', 'b'])
  })

  it('queue_limit_and_total', () => {
    const d = seedDeck(db, seedSubject(db).id)
    for (let i = 0; i < 5; i++) seedCard(db, d.id, { due: ago((i + 1) * HOUR) })
    const { total, cards } = dueQueue(db, { limit: 2, now: NOW })
    expect(total).toBe(5)
    expect(cards).toHaveLength(2)
  })

  it('queue_new_cards_are_due', () => {
    const d = seedDeck(db, seedSubject(db).id)
    seedCard(db, d.id) // default due = creation time (New card)
    const { total } = dueQueue(db, { limit: 50, now: ahead(1_000) })
    expect(total).toBe(1)
  })

  it('queue_empty_deck', () => {
    seedDeck(db, seedSubject(db).id)
    expect(dueQueue(db, { limit: 50, now: NOW })).toEqual({ total: 0, cards: [] })
  })
})

describe('dueCounts', () => {
  it('counts_by_subject_excludes_archived_includes_zero', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db) // no due cards → 0
    const archived = seedSubject(db, { archived: true })
    seedCard(db, seedDeck(db, s1.id).id, { due: ago(HOUR) })
    seedCard(db, seedDeck(db, archived.id).id, { due: ago(HOUR) })

    const res = dueCounts(db, NOW)
    const ids = res.bySubject.map((b) => b.subjectId)
    expect(ids).toContain(s1.id)
    expect(ids).toContain(s2.id)
    expect(ids).not.toContain(archived.id)
    expect(res.bySubject.find((b) => b.subjectId === s1.id)!.dueCount).toBe(1)
    expect(res.bySubject.find((b) => b.subjectId === s2.id)!.dueCount).toBe(0)
    expect(res.total).toBe(1)
  })

  it('counts_by_deck', () => {
    const s = seedSubject(db)
    const d1 = seedDeck(db, s.id)
    const d2 = seedDeck(db, s.id)
    seedCard(db, d1.id, { due: ago(HOUR) })
    seedCard(db, d1.id, { due: ago(HOUR) })
    seedCard(db, d2.id, { due: ago(HOUR) })
    const res = dueCounts(db, NOW)
    const deckSum = res.byDeck
      .filter((b) => b.subjectId === s.id)
      .reduce((acc, b) => acc + b.dueCount, 0)
    expect(deckSum).toBe(res.bySubject.find((b) => b.subjectId === s.id)!.dueCount)
    expect(deckSum).toBe(3)
  })

  it('counts_deck_with_no_due_cards_present_zero', () => {
    const s = seedSubject(db)
    const d = seedDeck(db, s.id)
    seedCard(db, d.id, { due: ahead(HOUR) }) // not due
    const res = dueCounts(db, NOW)
    expect(res.byDeck.find((b) => b.deckId === d.id)!.dueCount).toBe(0)
  })

  it('counts_subject_with_no_deck_present', () => {
    const s = seedSubject(db) // no deck at all
    const res = dueCounts(db, NOW)
    expect(res.bySubject.find((b) => b.subjectId === s.id)).toEqual({
      subjectId: s.id,
      dueCount: 0,
    })
  })
})
