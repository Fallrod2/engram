import { describe, expect, it } from 'vitest'
import { Rating } from 'ts-fsrs'
import {
  DEMO_PRERECORDED_MODEL,
  DEMO_QCM_CARDS,
  DEMO_SAMPLE_NOTE_CONTENT,
  demoCardSpecs,
  demoSampleGenerationItems,
} from './demo.service'

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

/**
 * The pre-recorded generation (T-031). Its point is that the visitor does the
 * REAL review, so what has to hold is exactly what would hold after a live run:
 * every proposal untriaged, both formats present, no duplicate, and — the part
 * that is not cosmetic — nothing anywhere claiming a model produced it.
 */
describe('the demo sample generation is a credible run, honestly labelled', () => {
  const items = demoSampleGenerationItems()

  it('proposes 6 to 8 cards, all still to triage', () => {
    expect(items.length).toBeGreaterThanOrEqual(6)
    expect(items.length).toBeLessThanOrEqual(8)
    expect(items.every((i) => i.status === 'pending')).toBe(true)
    expect(items.every((i) => i.cardId === undefined)).toBe(true)
    // Ids are what the review board keys on; a collision would silently merge two
    // proposals into one row.
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  })

  it('materialises at least one cloze, blanked the way the live path blanks it', () => {
    const cloze = items.filter((i) => i.kind === 'cloze')
    expect(cloze.length).toBeGreaterThanOrEqual(2)
    for (const c of cloze) {
      // `expandCloze` renders the masked span as `**[…]**` on the front and the
      // answer in bold on the back. Asserting the rendering, not just the flag,
      // is what proves these went through the real expander.
      expect(c.front).toContain('**[…]**')
      expect(c.back).not.toContain('**[…]**')
      expect(c.clozeText).toBeDefined()
    }
    // …and the two masks of one template produce two DIFFERENT cards.
    expect(new Set(cloze.map((c) => c.front)).size).toBe(cloze.length)
  })

  it('mixes the two formats and carries the evaluation metadata', () => {
    const kinds = new Set(items.map((i) => i.kind))
    expect(kinds.has('qa')).toBe(true)
    expect(kinds.has('cloze')).toBe(true)
    // `mixed` runs badge every item with a content type; a missing one would show
    // up as a proposal with no badge next to six that have one.
    expect(items.every((i) => i.contentType !== undefined)).toBe(true)
  })

  it('never repeats a proposal', () => {
    expect(new Set(items.map((i) => normalize(i.front))).size).toBe(items.length)
    expect(new Set(items.map((i) => normalize(i.back))).size).toBe(items.length)
    for (const i of items) expect(normalize(i.front)).not.toBe(normalize(i.back))
  })

  it('is answerable FROM the sample note — the cards are not about something else', () => {
    // A generation whose cards do not come from the note on screen would be the
    // second lie (after the provenance). Cheap but real check: every proposal
    // mentions a term the note actually defines.
    const note = normalize(DEMO_SAMPLE_NOTE_CONTENT)
    const anchors = ['lexème', 'unité lexicale', 'motif', 'attribut', 'commentaire', 'thompson']
    for (const a of anchors) expect(note).toContain(a)
    for (const i of items) {
      const text = normalize(`${i.front} ${i.back}`)
      expect(anchors.some((a) => text.includes(a))).toBe(true)
    }
  })

  it('names no model — the `model` column must not assert a false thing', () => {
    expect(DEMO_PRERECORDED_MODEL).not.toMatch(/claude|gpt|mistral|llama|sonnet|opus|haiku|o\d/i)
    // And it says what it is, rather than being an opaque sentinel a reader of
    // the raw table would have to look up.
    expect(DEMO_PRERECORDED_MODEL.toLowerCase()).toContain('hand-written')
  })
})
