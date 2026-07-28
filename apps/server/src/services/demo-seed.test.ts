import { describe, expect, it } from 'vitest'
import { Rating } from 'ts-fsrs'
import { DEMO_QCM_CARDS, demoCardSpecs } from './demo.service'

/**
 * Invariants of the demo dataset (T-027). The bug this suite exists for: the
 * content pools were shorter than the number of slots and the builder cycled
 * them, so the Grammaires and Automates decks each shipped duplicated cards. A
 * visitor answered the same question twice in one session and the analytics
 * listed the same card twice — "l'impression d'une base corrompue".
 *
 * Fixing the content took five minutes; THIS is the deliverable. Any future
 * extension of the seed (more cards, a fourth deck, a new pool) trips these
 * assertions before it reaches a visitor.
 *
 * Vitest and not `bun:test`: `demoCardSpecs()` is pure data, no database. The
 * DB-level counterpart lives in `demo.service.spec.ts`.
 */

/** Case- and whitespace-insensitive: two cards that differ only by casing still read as a double. */
const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

const specs = demoCardSpecs()

describe('the demo seed is free of duplicates', () => {
  it('no two cards share a front', () => {
    const seen = new Map<string, string>()
    const duplicates: string[] = []
    for (const s of specs) {
      const key = normalize(s.front)
      if (seen.has(key)) duplicates.push(s.front)
      else seen.set(key, s.front)
    }
    expect(duplicates).toEqual([])
    expect(seen.size).toBe(specs.length)
  })

  it('no two cards share a back either', () => {
    // A shared answer is a weaker smell than a shared question, but in a
    // 25-card window it still reads as filler.
    const backs = new Set(specs.map((s) => normalize(s.back)))
    expect(backs.size).toBe(specs.length)
  })
})

describe('the demo seed keeps its shape', () => {
  it('holds 25 cards spread over the three decks as before', () => {
    expect(specs).toHaveLength(25)
    const perPool = [0, 1, 2].map((p) => specs.filter((s) => s.pool === p).length)
    // Automates 9 (7 + 2 QCM), Grammaires 8 (7 + 1), Vocabulaire 8 (7 + 1).
    expect(perPool).toEqual([9, 8, 8])
  })

  it('replays 60 reviews, i.e. the same FSRS history as before', () => {
    expect(specs.reduce((n, s) => n + s.reviews.length, 0)).toBe(60)
  })

  it('covers the five review profiles (new / learning / young / mature / lapsed)', () => {
    const shapes = new Set(specs.map((s) => s.reviews.length))
    expect([...shapes].sort()).toEqual([0, 1, 3, 4])
    // The lapsed profile is the one ending on an Again — it is what makes the
    // demo's "cartes difficiles" and the retention curve non-trivial.
    expect(specs.some((s) => s.reviews.at(-1)?.rating === Rating.Again)).toBe(true)
    // A brand-new card (no history) is due immediately: the session is never empty.
    expect(specs.some((s) => s.reviews.length === 0)).toBe(true)
  })

  it('keeps the four QCM intact, in front, with their declared decks and profiles', () => {
    const head = specs.slice(0, DEMO_QCM_CARDS.length)
    expect(head.map((s) => s.front)).toEqual(DEMO_QCM_CARDS.map((q) => q.front))
    expect(head.map((s) => s.back)).toEqual(DEMO_QCM_CARDS.map((q) => q.back))
    expect(head.map((s) => s.pool)).toEqual(DEMO_QCM_CARDS.map((q) => q.pool))
    // The learning-profile QCM (a single review 6 days ago) is the one that is
    // due on sight and first in the queue — see DEMO_QCM_CARDS.
    expect(head.some((s) => s.reviews.length === 1)).toBe(true)
  })

  it('writes real content, not filler', () => {
    for (const s of specs) {
      expect(s.front.trim().length).toBeGreaterThan(2)
      expect(s.back.trim().length).toBeGreaterThan(2)
      expect(normalize(s.front)).not.toBe(normalize(s.back))
    }
  })
})
