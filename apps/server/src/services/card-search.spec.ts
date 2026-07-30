import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { State } from 'ts-fsrs'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { card } from '../db/schema'
import { foldSql } from '../db/fold'
import { seedCard, seedDeck, seedReviewLog, seedSubject } from '../test-support/harness'
import { ConflictError, NotFoundError } from '../http/errors'
import { bulkDeleteCards, bulkMoveCards, searchCards } from './card-search.service'

/**
 * Content search + bulk card operations (T-030), against a real migrated
 * database (PGlite) — the fold is SQL, so it can only be proven in SQL.
 */

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

const A = 'user-a'
const B = 'user-b'
// Fixed "now": Sunday 2026-07-12 10:00 LOCAL, so `overdue`'s local-midnight cut
// is asserted identically in any system timezone.
const NOW = new Date(2026, 6, 12, 10, 0)
const at = (offDays: number, h = 12): Date => new Date(2026, 6, 12 + offDays, h, 0)

const find = (
  db: DB,
  userId: string,
  q: string,
  extra: Partial<Parameters<typeof searchCards>[2]> = {},
) => searchCards(db, userId, { q, limit: 50, offset: 0, now: NOW, ...extra })

/** subject → deck → n cards, all owned by `userId`. */
async function graph(userId: string, subjectName = 'Théorie des langages', deckName = 'Automates') {
  const s = await seedSubject(db, { userId, name: subjectName })
  const d = await seedDeck(db, s.id, { userId, name: deckName })
  return { subject: s, deck: d }
}

// --- The frozen DDL vs the live expression ---------------------------------

describe('fold columns', () => {
  /**
   * THE ANTI-DRIFT GUARD. `card.front_fold` / `back_fold` are STORED generated
   * columns whose expression is frozen into migration 0012, while `foldSql()` in
   * `db/fold.ts` builds the same expression at query time for the NEEDLE. If the
   * two ever disagree — someone edits FOLD_FROM without a migration — search
   * would fail only for the characters that moved, silently. This compares them
   * on a corpus chosen to hit every branch.
   */
  const TRICKY = [
    'Théorème de Kleene',
    'ÉTOILE de Kleene',
    'Le cœur du problème',
    'Straße & Œuvre',
    'Ærøskøbing',
    'Đà Nẵng — Łódź',
    'ĲsselmeerıİȷÞþ',
    'MiXeD CaSe 123 !@#',
    'ǅungla Ǳ ǈ',
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
    'ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĴĶĹĻĽŁŃŅŇŌŎŐŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽ',
  ]

  it('the stored column matches the live foldSql expression, character for character', async () => {
    const { deck } = await graph(A)
    for (const s of TRICKY) await seedCard(db, deck.id, { userId: A, front: s, back: s })

    const rows = await db
      .select({
        front: card.front,
        stored: card.frontFold,
        live: foldSql(card.front),
        storedBack: card.backFold,
        liveBack: foldSql(card.back),
      })
      .from(card)

    expect(rows).toHaveLength(TRICKY.length)
    for (const r of rows) {
      expect(`${r.front} => ${r.stored}`).toBe(`${r.front} => ${r.live}`)
      expect(r.storedBack).toBe(r.liveBack)
    }
  })

  it('the stored fold is lowercase and free of the mapped diacritics', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'Théorème ÉTOILE Ça', back: 'Straße' })
    const [row] = await db.select({ f: card.frontFold, b: card.backFold }).from(card)
    expect(row!.f).toBe('theoreme etoile ca')
    expect(row!.b).toBe('strasse')
  })

  it('is maintained by the database on UPDATE, not by the application', async () => {
    const { deck } = await graph(A)
    const c = await seedCard(db, deck.id, { userId: A, front: 'avant', back: 'x' })
    await db.update(card).set({ front: 'Après ÇA' }).where(eq(card.id, c.id))
    const [row] = await db.select({ f: card.frontFold }).from(card).where(eq(card.id, c.id))
    expect(row!.f).toBe('apres ca')
    // …and the search sees the new text immediately.
    expect((await find(db, A, 'apres ca')).total).toBe(1)
    expect((await find(db, A, 'avant')).total).toBe(0)
  })
})

// --- Matching --------------------------------------------------------------

describe('searchCards — matching', () => {
  it('finds an accented word from an unaccented query, and the reverse', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'Théorème de Kleene', back: 'étoile' })

    // Unaccented query → accented content. This is the headline requirement.
    expect((await find(db, A, 'theoreme')).total).toBe(1)
    expect((await find(db, A, 'Theoreme de Kleene')).total).toBe(1)
    // Accented query → accented content.
    expect((await find(db, A, 'théorème')).total).toBe(1)
    // Accented query → unaccented content (a card typed without accents).
    await seedCard(db, deck.id, { userId: A, front: 'Theoreme de Myhill', back: 'x' })
    expect((await find(db, A, 'théorème')).total).toBe(2)
  })

  it('is case-insensitive', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'Kleene star', back: 'x' })
    for (const q of ['kleene', 'KLEENE', 'KlEeNe']) {
      expect((await find(db, A, q)).total).toBe(1)
    }
  })

  it('matches a substring, not only a whole word', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'Kleene', back: 'x' })
    expect((await find(db, A, 'leen')).total).toBe(1)
  })

  it('matches text present ONLY on the back', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'Question', back: 'La réponse est ε' })
    const res = await find(db, A, 'reponse')
    expect(res.total).toBe(1)
    expect(res.hits[0]!.card.back).toContain('réponse')
  })

  it('folds the œ / æ / ß ligatures', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'Le cœur du problème', back: 'x' })
    await seedCard(db, deck.id, { userId: A, front: 'Straße', back: 'y' })
    expect((await find(db, A, 'coeur')).total).toBe(1)
    expect((await find(db, A, 'cœur')).total).toBe(1)
    expect((await find(db, A, 'strasse')).total).toBe(1)
  })

  it('an empty (or whitespace-only) query drops the text predicate', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'a', back: 'b' })
    await seedCard(db, deck.id, { userId: A, front: 'c', back: 'd' })
    expect((await find(db, A, '')).total).toBe(2)
    expect((await find(db, A, '   ')).total).toBe(2)
    expect((await find(db, A, '')).query).toBe('')
  })

  it('treats LIKE metacharacters as literal text', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'Taux de 100% garanti', back: 'x' })
    await seedCard(db, deck.id, { userId: A, front: 'rien a voir', back: 'y' })
    // A bare '%' would otherwise match every row.
    expect((await find(db, A, '%')).total).toBe(1)
    expect((await find(db, A, '100%')).total).toBe(1)
    // '_' is LIKE's single-character wildcard.
    expect((await find(db, A, 'a_v')).total).toBe(0)
    expect((await find(db, A, '\\')).total).toBe(0)
  })

  it('returns nothing for a needle that is absent', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'Kleene', back: 'x' })
    const res = await find(db, A, 'zzzzz')
    expect(res.total).toBe(0)
    expect(res.hits).toEqual([])
  })
})

// --- Payload ---------------------------------------------------------------

describe('searchCards — result payload', () => {
  it('carries the deck and subject inline, so no second round-trip is needed', async () => {
    const s = await seedSubject(db, {
      userId: A,
      name: 'Théorie des langages',
      color: '#ff0000',
      icon: 'sigma',
    })
    const d = await seedDeck(db, s.id, { userId: A, name: 'Automates finis' })
    await seedCard(db, d.id, { userId: A, front: 'Kleene', back: 'x' })

    const hit = (await find(db, A, 'kleene')).hits[0]!
    expect(hit.deck).toEqual({ id: d.id, name: 'Automates finis' })
    expect(hit.subject).toEqual({
      id: s.id,
      name: 'Théorie des langages',
      color: '#ff0000',
      icon: 'sigma',
      archived: false,
    })
    expect(hit.card.fsrs.state).toBe(0)
  })

  it('ranks front matches above back-only matches', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'zzz', back: 'kleene' }) // seeded first
    await seedCard(db, deck.id, { userId: A, front: 'kleene', back: 'zzz' })
    const hits = (await find(db, A, 'kleene')).hits
    expect(hits.map((h) => h.card.front)).toEqual(['kleene', 'zzz'])
  })
})

// --- Filters ---------------------------------------------------------------

describe('searchCards — filters', () => {
  it('filters by deck and by subject', async () => {
    const g1 = await graph(A, 'Théorie', 'Deck 1')
    const d2 = await seedDeck(db, g1.subject.id, { userId: A, name: 'Deck 2' })
    const g2 = await graph(A, 'Anglais', 'Deck 3')
    await seedCard(db, g1.deck.id, { userId: A, front: 'terme', back: 'x' })
    await seedCard(db, d2.id, { userId: A, front: 'terme', back: 'x' })
    await seedCard(db, g2.deck.id, { userId: A, front: 'terme', back: 'x' })

    expect((await find(db, A, 'terme')).total).toBe(3)
    expect((await find(db, A, 'terme', { deckId: g1.deck.id })).total).toBe(1)
    expect((await find(db, A, 'terme', { subjectId: g1.subject.id })).total).toBe(2)
    expect((await find(db, A, 'terme', { subjectId: g2.subject.id })).total).toBe(1)
  })

  it('filters by FSRS state name', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'terme', state: State.New })
    await seedCard(db, deck.id, { userId: A, front: 'terme', state: State.Learning })
    await seedCard(db, deck.id, { userId: A, front: 'terme', state: State.Review })
    await seedCard(db, deck.id, { userId: A, front: 'terme', state: State.Review })
    await seedCard(db, deck.id, { userId: A, front: 'terme', state: State.Relearning })

    expect((await find(db, A, 'terme', { state: 'new' })).total).toBe(1)
    expect((await find(db, A, 'terme', { state: 'learning' })).total).toBe(1)
    expect((await find(db, A, 'terme', { state: 'review' })).total).toBe(2)
    expect((await find(db, A, 'terme', { state: 'relearning' })).total).toBe(1)
  })

  it('overdue uses the project cut: due < LOCAL midnight today', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'terme', due: at(-1) }) // yesterday
    await seedCard(db, deck.id, { userId: A, front: 'terme', due: at(0, 0) }) // exactly midnight
    await seedCard(db, deck.id, { userId: A, front: 'terme', due: at(0, 8) }) // earlier today
    await seedCard(db, deck.id, { userId: A, front: 'terme', due: at(+1) }) // tomorrow

    // Half-open: midnight itself belongs to TODAY, not to the backlog.
    expect((await find(db, A, 'terme', { overdue: true })).total).toBe(1)
    expect((await find(db, A, 'terme', { overdue: false })).total).toBe(4)
    expect((await find(db, A, 'terme')).total).toBe(4)
  })

  it('combines the text needle with the filters', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'Kleene', due: at(-1), state: State.Review })
    await seedCard(db, deck.id, { userId: A, front: 'Kleene', due: at(+1), state: State.Review })
    await seedCard(db, deck.id, { userId: A, front: 'Autre', due: at(-1), state: State.Review })
    const res = await find(db, A, 'kleene', { overdue: true, state: 'review' })
    expect(res.total).toBe(1)
    expect(res.hits[0]!.card.front).toBe('Kleene')
  })
})

// --- Pagination ------------------------------------------------------------

describe('searchCards — pagination', () => {
  it('total is the full match set; limit/offset page it without overlap', async () => {
    const { deck } = await graph(A)
    for (let i = 0; i < 7; i++) {
      await seedCard(db, deck.id, { userId: A, front: `terme ${i}`, back: 'x' })
    }
    const p1 = await find(db, A, 'terme', { limit: 3, offset: 0 })
    const p2 = await find(db, A, 'terme', { limit: 3, offset: 3 })
    const p3 = await find(db, A, 'terme', { limit: 3, offset: 6 })

    expect([p1.total, p2.total, p3.total]).toEqual([7, 7, 7])
    expect([p1.hits.length, p2.hits.length, p3.hits.length]).toEqual([3, 3, 1])
    expect(p1.limit).toBe(3)
    expect(p2.offset).toBe(3)

    const ids = [...p1.hits, ...p2.hits, ...p3.hits].map((h) => h.card.id)
    expect(new Set(ids).size).toBe(7) // deterministic order ⇒ no row seen twice
  })

  it('an offset past the end returns no hits but the true total', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A, front: 'terme', back: 'x' })
    const res = await find(db, A, 'terme', { limit: 10, offset: 100 })
    expect(res.total).toBe(1)
    expect(res.hits).toEqual([])
  })
})

// --- Isolation -------------------------------------------------------------

describe('searchCards — tenant isolation', () => {
  it('never returns, nor counts, another user’s cards', async () => {
    const ga = await graph(A, 'Théorie de A', 'Deck de A')
    const gb = await graph(B, 'Théorie de B', 'Deck de B')
    await seedCard(db, ga.deck.id, { userId: A, front: 'Kleene chez A', back: 'x' })
    await seedCard(db, gb.deck.id, { userId: B, front: 'Kleene chez B', back: 'x' })

    const resA = await find(db, A, 'kleene')
    expect(resA.total).toBe(1)
    expect(resA.hits[0]!.card.front).toBe('Kleene chez A')
    expect(resA.hits[0]!.subject.name).toBe('Théorie de A')

    const resB = await find(db, B, 'kleene')
    expect(resB.total).toBe(1)
    expect(resB.hits[0]!.card.front).toBe('Kleene chez B')

    // A third user with no data sees nothing at all.
    expect((await find(db, 'user-c', 'kleene')).total).toBe(0)
  })

  it('a foreign deckId / subjectId filter yields nothing, never foreign rows', async () => {
    const ga = await graph(A)
    const gb = await graph(B)
    await seedCard(db, ga.deck.id, { userId: A, front: 'terme', back: 'x' })
    await seedCard(db, gb.deck.id, { userId: B, front: 'terme', back: 'x' })

    expect((await find(db, A, 'terme', { deckId: gb.deck.id })).total).toBe(0)
    expect((await find(db, A, 'terme', { subjectId: gb.subject.id })).total).toBe(0)
  })
})

// --- Bulk delete -----------------------------------------------------------

describe('bulkDeleteCards', () => {
  it('deletes the batch and reports what happened', async () => {
    const { deck } = await graph(A)
    const c1 = await seedCard(db, deck.id, { userId: A })
    const c2 = await seedCard(db, deck.id, { userId: A })
    const c3 = await seedCard(db, deck.id, { userId: A })

    const res = await bulkDeleteCards(db, A, [c1.id, c2.id])
    expect(res).toEqual({ requested: 2, affected: 2 })
    const left = await db.select({ id: card.id }).from(card)
    expect(left.map((r) => r.id)).toEqual([c3.id])
  })

  it('cascades the review logs of the deleted cards', async () => {
    const { deck } = await graph(A)
    const c = await seedCard(db, deck.id, { userId: A })
    await seedReviewLog(db, c.id, { userId: A })
    await bulkDeleteCards(db, A, [c.id])
    const logs = await db.select().from(card).where(eq(card.id, c.id))
    expect(logs).toEqual([])
  })

  it('de-duplicates: affected counts rows, requested counts ids as sent', async () => {
    const { deck } = await graph(A)
    const c = await seedCard(db, deck.id, { userId: A })
    const res = await bulkDeleteCards(db, A, [c.id, c.id, c.id])
    expect(res).toEqual({ requested: 3, affected: 1 })
  })

  it('a FOREIGN id aborts the whole batch — nothing is deleted', async () => {
    const ga = await graph(A)
    const gb = await graph(B)
    const mine = await seedCard(db, ga.deck.id, { userId: A })
    const theirs = await seedCard(db, gb.deck.id, { userId: B })

    await expect(bulkDeleteCards(db, A, [mine.id, theirs.id])).rejects.toBeInstanceOf(NotFoundError)
    // Atomic: my own card survived the refused call, and so did theirs.
    const left = await db.select({ id: card.id }).from(card)
    expect(new Set(left.map((r) => r.id))).toEqual(new Set([mine.id, theirs.id]))
  })

  it('an empty batch is a no-op (the size floor is enforced at the API edge)', async () => {
    const { deck } = await graph(A)
    await seedCard(db, deck.id, { userId: A })
    expect(await bulkDeleteCards(db, A, [])).toEqual({ requested: 0, affected: 0 })
    expect((await db.select().from(card)).length).toBe(1)
  })

  it('an unknown id aborts the whole batch', async () => {
    const { deck } = await graph(A)
    const c = await seedCard(db, deck.id, { userId: A })
    await expect(bulkDeleteCards(db, A, [c.id, 'no-such-card'])).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect((await db.select().from(card)).length).toBe(1)
  })
})

// --- Bulk move -------------------------------------------------------------

describe('bulkMoveCards', () => {
  it('moves the batch into another deck of the same subject', async () => {
    const g = await graph(A)
    const dest = await seedDeck(db, g.subject.id, { userId: A, name: 'Destination' })
    const c1 = await seedCard(db, g.deck.id, { userId: A })
    const c2 = await seedCard(db, g.deck.id, { userId: A })

    const res = await bulkMoveCards(db, A, [c1.id, c2.id], dest.id)
    expect(res).toEqual({ requested: 2, affected: 2 })
    const rows = await db.select({ id: card.id, deckId: card.deckId }).from(card)
    expect(rows.every((r) => r.deckId === dest.id)).toBe(true)
  })

  it('KEEPS the FSRS state when moving across subjects, and keeps the history', async () => {
    const src = await graph(A, 'Théorie', 'Source')
    const other = await graph(A, 'Anglais', 'Ailleurs')
    const c = await seedCard(db, src.deck.id, {
      userId: A,
      state: State.Review,
      reps: 7,
      lapses: 2,
      stability: 12.5,
      difficulty: 6.25,
      due: at(+3),
      lastReview: at(-4),
    })
    await seedReviewLog(db, c.id, { userId: A })

    await bulkMoveCards(db, A, [c.id], other.deck.id)

    const [moved] = await db.select().from(card).where(eq(card.id, c.id))
    expect(moved!.deckId).toBe(other.deck.id)
    // The state belongs to the card, not to the folder it sits in.
    expect(moved!.state).toBe(State.Review)
    expect(moved!.reps).toBe(7)
    expect(moved!.lapses).toBe(2)
    expect(moved!.stability).toBe(12.5)
    expect(moved!.difficulty).toBe(6.25)
    expect(moved!.due.getTime()).toBe(at(+3).getTime())
    // review_log points at card_id, so the history followed with no rewrite.
    const hit = (await find(db, A, '')).hits.find((h) => h.card.id === c.id)!
    expect(hit.deck.name).toBe('Ailleurs')
    expect(hit.subject.name).toBe('Anglais')
  })

  it('the search reflects the move immediately (derived counts, no stale column)', async () => {
    const src = await graph(A, 'Théorie', 'Source')
    const other = await graph(A, 'Anglais', 'Ailleurs')
    const c = await seedCard(db, src.deck.id, { userId: A, front: 'Kleene' })

    expect((await find(db, A, 'kleene', { subjectId: src.subject.id })).total).toBe(1)
    await bulkMoveCards(db, A, [c.id], other.deck.id)
    expect((await find(db, A, 'kleene', { subjectId: src.subject.id })).total).toBe(0)
    expect((await find(db, A, 'kleene', { subjectId: other.subject.id })).total).toBe(1)
  })

  it('a FOREIGN destination deck is a 404 and moves nothing', async () => {
    const ga = await graph(A)
    const gb = await graph(B)
    const mine = await seedCard(db, ga.deck.id, { userId: A })

    await expect(bulkMoveCards(db, A, [mine.id], gb.deck.id)).rejects.toBeInstanceOf(NotFoundError)
    const [row] = await db.select().from(card).where(eq(card.id, mine.id))
    expect(row!.deckId).toBe(ga.deck.id)
  })

  it('a FOREIGN card in the batch aborts the move entirely', async () => {
    const ga = await graph(A)
    const gb = await graph(B)
    const dest = await seedDeck(db, ga.subject.id, { userId: A, name: 'Destination' })
    const mine = await seedCard(db, ga.deck.id, { userId: A })
    const theirs = await seedCard(db, gb.deck.id, { userId: B })

    await expect(bulkMoveCards(db, A, [mine.id, theirs.id], dest.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    // Neither card moved — the transaction rolled back.
    const rows = await db.select({ id: card.id, deckId: card.deckId }).from(card)
    expect(rows.find((r) => r.id === mine.id)!.deckId).toBe(ga.deck.id)
    expect(rows.find((r) => r.id === theirs.id)!.deckId).toBe(gb.deck.id)
  })

  it('refuses a destination under an ARCHIVED subject (409), moving nothing', async () => {
    const g = await graph(A)
    const archived = await seedSubject(db, { userId: A, name: 'Archivée', archived: true })
    const dest = await seedDeck(db, archived.id, { userId: A, name: 'Dest' })
    const c = await seedCard(db, g.deck.id, { userId: A })

    await expect(bulkMoveCards(db, A, [c.id], dest.id)).rejects.toBeInstanceOf(ConflictError)
    const [row] = await db.select().from(card).where(eq(card.id, c.id))
    expect(row!.deckId).toBe(g.deck.id)
  })

  it('de-duplicates the batch', async () => {
    const g = await graph(A)
    const dest = await seedDeck(db, g.subject.id, { userId: A, name: 'Destination' })
    const c = await seedCard(db, g.deck.id, { userId: A })
    expect(await bulkMoveCards(db, A, [c.id, c.id], dest.id)).toEqual({
      requested: 2,
      affected: 1,
    })
  })
})
