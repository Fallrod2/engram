import { describe, expect, it } from 'vitest'
import { CARD_SEARCH_LIMIT_DEFAULT } from '@engram/shared'
import {
  SEARCH_PAGE_SIZE,
  activeFilterCount,
  hasFilters,
  isSearching,
  needleOf,
  pageCount,
  searchRouteSchema,
  toApiQuery,
  type SearchRouteSearch,
} from './params'

function s(over: Partial<SearchRouteSearch> = {}): SearchRouteSearch {
  return { q: '', page: 1, ...over }
}

describe('searchRouteSchema — a mistyped link degrades, it never throws', () => {
  it('accepts a full, well-formed search', () => {
    expect(
      searchRouteSchema.parse({
        q: 'kleene',
        subject: 'sub1',
        deck: 'deck1',
        state: 'review',
        overdue: true,
        hideArchived: true,
        page: 3,
        edit: 'card1',
      }),
    ).toEqual({
      q: 'kleene',
      subject: 'sub1',
      deck: 'deck1',
      state: 'review',
      overdue: true,
      hideArchived: true,
      page: 3,
      edit: 'card1',
    })
  })

  it('falls back to the neutral screen for garbage rather than erroring the route', () => {
    const parsed = searchRouteSchema.parse({
      q: 42,
      state: 'sleeping',
      overdue: 'yes',
      page: -7,
      subject: '',
    })
    expect(parsed).toEqual({ q: '', page: 1 })
  })

  it('drops a needle past the server ceiling instead of sending it', () => {
    // 200 chars is the contract's max; a pasted document is not a search.
    expect(searchRouteSchema.parse({ q: 'x'.repeat(201) }).q).toBe('')
    expect(searchRouteSchema.parse({ q: 'x'.repeat(200) }).q).toHaveLength(200)
  })
})

describe('isSearching — a filter alone is a question', () => {
  it('is false on the neutral screen', () => {
    expect(isSearching(s())).toBe(false)
    // Whitespace is not a needle: the server trims it away too.
    expect(isSearching(s({ q: '   ' }))).toBe(false)
  })

  it('is true for a needle', () => {
    expect(isSearching(s({ q: ' kleene ' }))).toBe(true)
  })

  it.each([
    ['subject', s({ subject: 'sub1' })],
    ['deck', s({ deck: 'deck1' })],
    ['state', s({ state: 'new' as const })],
    ['overdue', s({ overdue: true })],
    ['hideArchived', s({ hideArchived: true })],
  ])('is true for %s alone — "every overdue card of this subject" is one call', (_label, value) => {
    expect(isSearching(value)).toBe(true)
    expect(hasFilters(value)).toBe(true)
  })

  it('does not count a page or an open editor as a filter', () => {
    expect(hasFilters(s({ page: 4, edit: 'card1' }))).toBe(false)
    expect(activeFilterCount(s({ page: 4, edit: 'card1' }))).toBe(0)
    expect(activeFilterCount(s({ subject: 'a', overdue: true }))).toBe(2)
  })
})

describe('toApiQuery', () => {
  it('trims the needle and derives the offset from the page', () => {
    expect(toApiQuery(s({ q: '  kleene  ', page: 3 }))).toEqual({
      q: 'kleene',
      limit: SEARCH_PAGE_SIZE,
      offset: 2 * SEARCH_PAGE_SIZE,
    })
    expect(SEARCH_PAGE_SIZE).toBe(CARD_SEARCH_LIMIT_DEFAULT)
  })

  /**
   * The server distinguishes `overdue=false` ("not late yet") from an absent
   * `overdue` ("no due filter"). The chip does not: it has two positions, so it
   * only ever writes the `true` half. This pins the INTERFACE decision — a
   * future tri-state chip would change this test on purpose, not by accident.
   */
  it('never sends overdue=false — the chip is binary, though the server is not', () => {
    expect(toApiQuery(s({ overdue: undefined }))).not.toHaveProperty('overdue')
    expect(toApiQuery(s({ overdue: false }))).not.toHaveProperty('overdue')
    expect(toApiQuery(s({ overdue: true }))).toHaveProperty('overdue', true)
  })

  /**
   * The whole point of the fix: `hideArchived` reaches the SERVER, so `total`
   * and the page describe one population. Filtering the received page instead
   * made a page of 25 render 17 under a count that said otherwise.
   */
  it('sends hideArchived so the exclusion happens before the count', () => {
    expect(toApiQuery(s({ hideArchived: true }))).toEqual({
      q: '',
      hideArchived: true,
      limit: SEARCH_PAGE_SIZE,
      offset: 0,
    })
  })

  it('omits hideArchived when off — `false` only restates the server default', () => {
    expect(toApiQuery(s({ hideArchived: undefined }))).not.toHaveProperty('hideArchived')
    expect(toApiQuery(s({ hideArchived: false }))).not.toHaveProperty('hideArchived')
  })

  it('renames the URL keys onto the contract keys', () => {
    expect(toApiQuery(s({ subject: 'sub1', deck: 'deck1', state: 'relearning' }))).toMatchObject({
      subjectId: 'sub1',
      deckId: 'deck1',
      state: 'relearning',
    })
  })
})

describe('pageCount', () => {
  it('always has a page 1, even with nothing to show', () => {
    expect(pageCount(0)).toBe(1)
  })

  it('rounds up', () => {
    expect(pageCount(25)).toBe(1)
    expect(pageCount(26)).toBe(2)
    expect(pageCount(57)).toBe(3)
  })
})

describe('needleOf', () => {
  it('mirrors the server trim so the echoed query can be compared verbatim', () => {
    expect(needleOf('  théorie \n')).toBe('théorie')
  })
})
