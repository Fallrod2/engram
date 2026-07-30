import { describe, expect, it } from 'vitest'
import type { CardSearchHit, SearchCardsResponse } from '@engram/shared'
import { isFreshFor, pageBounds, searchEmptyKind, withoutArchived } from './results'

function hit(id: string, archived: boolean): CardSearchHit {
  return {
    card: {
      id,
      deckId: 'deck1',
      front: `front ${id}`,
      back: `back ${id}`,
      fsrs: {
        due: '2026-07-30T00:00:00.000Z',
        stability: 1,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 1,
        learningSteps: 0,
        reps: 0,
        lapses: 0,
        state: 0,
        lastReview: null,
      },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    deck: { id: 'deck1', name: 'Automates' },
    subject: { id: 'sub1', name: 'TL', color: '#7999f5', icon: 'brain', archived },
  }
}

function response(query: string): SearchCardsResponse {
  return { total: 1, query, limit: 25, offset: 0, hits: [hit('c1', false)] }
}

/**
 * The behaviour the server's `query` echo exists for. Incremental search fires
 * one request per debounced keystroke over a network that does not preserve
 * order; without this guard the answer to `kle` can land after the answer to
 * `kleene` and replace it.
 */
describe('isFreshFor — a late answer never passes for the current one', () => {
  it('accepts the response that carries the needle we asked for', () => {
    expect(isFreshFor('kleene', response('kleene'))).toBe(true)
  })

  it('rejects the answer to an earlier, shorter needle', () => {
    expect(isFreshFor('kleene', response('kle'))).toBe(false)
  })

  it('rejects the answer to a needle the user has since deleted back to', () => {
    expect(isFreshFor('kle', response('kleene'))).toBe(false)
  })

  it('rejects nothing at all — an absent response is not fresh', () => {
    expect(isFreshFor('kleene', undefined)).toBe(false)
  })

  it('holds for the empty needle, which is a legitimate query and not "no query"', () => {
    expect(isFreshFor('', response(''))).toBe(true)
    expect(isFreshFor('', response('kleene'))).toBe(false)
  })
})

/**
 * The three empty states. The whole point is that they are NOT interchangeable:
 * an account with no cards has not failed to match anything.
 */
describe('searchEmptyKind', () => {
  it('says "no cards at all" for an empty corpus, whatever was typed', () => {
    expect(searchEmptyKind({ searching: false, total: undefined, corpusTotal: 0 })).toBe('noCards')
    expect(searchEmptyKind({ searching: true, total: 0, corpusTotal: 0 })).toBe('noCards')
  })

  it('says "idle" when nothing has been asked and there IS a corpus', () => {
    expect(searchEmptyKind({ searching: false, total: undefined, corpusTotal: 120 })).toBe('idle')
  })

  it('says "no results" only for a real question answered with none', () => {
    expect(searchEmptyKind({ searching: true, total: 0, corpusTotal: 120 })).toBe('noResults')
  })

  it('says nothing while the corpus probe is still unknown', () => {
    // Guessing here is what would produce "no results" on a fresh account.
    expect(searchEmptyKind({ searching: true, total: 0, corpusTotal: undefined })).toBeNull()
  })

  it('says nothing while the search itself is unknown', () => {
    expect(searchEmptyKind({ searching: true, total: undefined, corpusTotal: 120 })).toBeNull()
  })

  it('says nothing when there are rows to render', () => {
    expect(searchEmptyKind({ searching: true, total: 7, corpusTotal: 120 })).toBeNull()
  })
})

describe('withoutArchived', () => {
  it('keeps cards whose subject is live and drops the archived ones', () => {
    const hits = [hit('a', false), hit('b', true), hit('c', false)]
    expect(withoutArchived(hits).map((h) => h.card.id)).toEqual(['a', 'c'])
  })

  it('does not mutate the page it was handed', () => {
    const hits = [hit('a', true)]
    withoutArchived(hits)
    expect(hits).toHaveLength(1)
  })
})

describe('pageBounds', () => {
  it('numbers the rows from 1 within the whole match set', () => {
    expect(pageBounds(0, 25)).toEqual({ from: 1, to: 25 })
    expect(pageBounds(50, 7)).toEqual({ from: 51, to: 57 })
  })

  it('collapses to 0–0 on an empty page rather than claiming a row 1', () => {
    expect(pageBounds(0, 0)).toEqual({ from: 0, to: 0 })
  })
})
