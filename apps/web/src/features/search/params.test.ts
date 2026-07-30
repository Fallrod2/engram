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

  it('never sends overdue=false — the server reads a falsy value as no filter', () => {
    expect(toApiQuery(s({ overdue: undefined }))).not.toHaveProperty('overdue')
    expect(toApiQuery(s({ overdue: true }))).toHaveProperty('overdue', true)
  })

  it('never sends hideArchived: the API has no such parameter (applied on the page)', () => {
    expect(toApiQuery(s({ hideArchived: true }))).toEqual({
      q: '',
      limit: SEARCH_PAGE_SIZE,
      offset: 0,
    })
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
