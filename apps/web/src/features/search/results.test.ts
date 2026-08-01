import { describe, expect, it } from 'vitest'
import type { CardSearchHit, SearchCardsResponse } from '@engram/shared'
import { isFreshFor, pageBounds, searchBody, searchEmptyKind } from './results'

function hit(id: string): CardSearchHit {
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
    subject: { id: 'sub1', name: 'TL', color: '#7999f5', icon: 'brain', archived: false },
  }
}

function response(query: string): SearchCardsResponse {
  return { total: 1, query, limit: 25, offset: 0, hits: [hit('c1')] }
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

/**
 * T-066 — "unknown corpus" used to mean one thing: wait. It means two, and the
 * second one never ends. While the probe is in flight, waiting is right. Once it
 * has FAILED, waiting is a skeleton that outlives the session: the idle screen
 * shimmered for ever, and a search answered with zero printed a bare "0 cartes"
 * over an empty table because no empty state was allowed to fire.
 */
describe('searchEmptyKind — a failed corpus probe is not a pending one', () => {
  it('still waits while the probe is merely in flight', () => {
    expect(
      searchEmptyKind({ searching: false, total: undefined, corpusTotal: undefined }),
    ).toBeNull()
    expect(
      searchEmptyKind({
        searching: false,
        total: undefined,
        corpusTotal: undefined,
        corpusFailed: false,
      }),
    ).toBeNull()
  })

  it('calls a real zero "no results" once the probe has failed', () => {
    // True of the SEARCH whatever the corpus holds: the server answered, and
    // the answer was none. The nuance lost is "you have no cards at all", which
    // is a gentler version of the same fact, never its opposite.
    expect(
      searchEmptyKind({ searching: true, total: 0, corpusTotal: undefined, corpusFailed: true }),
    ).toBe('noResults')
  })

  it('refuses to invent an empty state for the idle screen', () => {
    // `idle` quotes the corpus size and `noCards` claims the account is empty —
    // both need the figure that just failed to arrive. `null` hands the case
    // back to the caller, which owes the user an error and a retry.
    expect(
      searchEmptyKind({
        searching: false,
        total: undefined,
        corpusTotal: undefined,
        corpusFailed: true,
      }),
    ).toBeNull()
  })

  it('keeps waiting for the SEARCH even when the corpus is lost', () => {
    // The needle's own answer is still on its way; that skeleton does resolve.
    expect(
      searchEmptyKind({
        searching: true,
        total: undefined,
        corpusTotal: undefined,
        corpusFailed: true,
      }),
    ).toBeNull()
  })

  it('changes nothing once the probe HAS landed', () => {
    for (const corpusFailed of [true, false]) {
      expect(
        searchEmptyKind({ searching: false, total: undefined, corpusTotal: 0, corpusFailed }),
      ).toBe('noCards')
      expect(
        searchEmptyKind({ searching: false, total: undefined, corpusTotal: 120, corpusFailed }),
      ).toBe('idle')
      expect(
        searchEmptyKind({ searching: true, total: 7, corpusTotal: 120, corpusFailed }),
      ).toBeNull()
    }
  })
})

/**
 * NOTE — there is no `withoutArchived` here any more, and its two tests were
 * DELETED rather than adapted. Hiding archived subjects used to be done on the
 * received page, which made `total` count rows the table did not draw; it is now
 * `hideArchived` on `GET /api/cards/search`, a WHERE predicate applied before
 * `count()`. The behaviour is owned by the server and pinned there
 * (`card-search.service.spec.ts`, including the "`total` stays honest across
 * pages" case); the web's remaining share of it is sending the parameter, which
 * `params.test.ts` pins on `toApiQuery`.
 */

/**
 * The render ladder. The arm that matters is `corpusError`: before T-066 there
 * was none, so an idle screen whose corpus probe had failed fell through to the
 * skeleton and stayed there. The route cannot be mounted without a router, which
 * is exactly why the decision lives here.
 */
describe('searchBody — which arm of the results area', () => {
  const base = {
    resultsFailed: false,
    emptyKind: null,
    corpusFailed: false,
    searching: false,
    hasData: false,
  } as const

  it('puts a failed search above everything else', () => {
    expect(searchBody({ ...base, resultsFailed: true, emptyKind: 'noResults' })).toBe(
      'resultsError',
    )
    expect(searchBody({ ...base, resultsFailed: true, corpusFailed: true })).toBe('resultsError')
  })

  it('prefers a decided empty state to a lost corpus probe', () => {
    // `noResults` was reached WITHOUT the probe; saying it is better than
    // saying "something broke".
    expect(
      searchBody({ ...base, emptyKind: 'noResults', corpusFailed: true, searching: true }),
    ).toBe('empty')
  })

  it('shows the corpus error where the idle screen used to shimmer for ever', () => {
    expect(searchBody({ ...base, corpusFailed: true })).toBe('corpusError')
  })

  it('keeps the skeleton while the SEARCH is still in flight, corpus or no corpus', () => {
    // This one does resolve: the needle's own answer is coming.
    expect(searchBody({ ...base, corpusFailed: true, searching: true })).toBe('skeleton')
    expect(searchBody({ ...base, searching: true })).toBe('skeleton')
  })

  it('renders rows as soon as there are rows', () => {
    expect(searchBody({ ...base, searching: true, hasData: true })).toBe('results')
    // Even with a lost probe: the rows on screen are real.
    expect(searchBody({ ...base, searching: true, hasData: true, corpusFailed: true })).toBe(
      'results',
    )
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
