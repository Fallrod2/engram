import type { SearchCardsResponse } from '@engram/shared'

/**
 * Reading a search response honestly: which answer belongs to what is on
 * screen, and what to say when there is nothing to show.
 *
 * Pure on purpose — every rule here is a claim the UI makes to the user, and a
 * claim is worth a test.
 */

/**
 * Does this response answer the needle currently in the box?
 *
 * `query` is the trimmed needle the server echoes back, and it exists for
 * exactly this. Incremental search fires one request per (debounced) keystroke
 * over a network that does not preserve order: `kle` can land after `kleene`,
 * and rendering it would replace the right answer with an older one — the user
 * sees the list flicker back to a superset of what they asked for.
 *
 * The query cache keys by needle too, so this is belt AND braces; the braces
 * matter because `placeholderData: keepPreviousData` deliberately serves the
 * PREVIOUS needle's rows while the new ones load. Those rows are worth showing
 * (they stop the list from collapsing under the user's cursor) but they must be
 * announced as stale rather than counted as the answer.
 */
export function isFreshFor(needle: string, res: Pick<SearchCardsResponse, 'query'> | undefined) {
  return res !== undefined && res.query === needle
}

/**
 * Which "nothing to show" is this? THREE distinct situations that a single
 * "no results" would flatten into one, and the flattening is the bug:
 *
 *  - `idle`      — nothing asked yet. Not an error, not an absence: an invitation.
 *  - `noResults` — a real question with a real answer, and the answer is none.
 *  - `noCards`   — the account holds no cards AT ALL. Telling a brand-new user
 *                  "no results for your search" blames them for the emptiness of
 *                  a corpus they have not filled yet; this one offers a way in.
 *
 * `null` means "there are rows, render them". `corpusTotal === undefined` means
 * the corpus probe has not landed: we cannot yet tell `noResults` from
 * `noCards`, so the caller keeps its skeleton up rather than guessing.
 */
export type SearchEmptyKind = 'idle' | 'noResults' | 'noCards'

export function searchEmptyKind(input: {
  /** Is a needle or a filter in force? (`isSearching` from `params.ts`.) */
  searching: boolean
  /** `total` of the CURRENT search, or `undefined` while it is unknown. */
  total: number | undefined
  /** Size of the whole corpus (the unfiltered probe), or `undefined`. */
  corpusTotal: number | undefined
}): SearchEmptyKind | null {
  if (input.corpusTotal === undefined) return null
  if (input.corpusTotal === 0) return 'noCards'
  if (!input.searching) return 'idle'
  if (input.total === undefined) return null
  return input.total === 0 ? 'noResults' : null
}

/**
 * `[first, last]` 1-based row numbers of a page, for "13–24 of 57".
 *
 * `shown` is the length of the page the SERVER returned, and that is the whole
 * arithmetic: every filter — `hideArchived` included — is a WHERE predicate
 * applied before `count()`, so the rows on screen and `total` describe one
 * population. Nothing is dropped between the response and the table.
 */
export function pageBounds(offset: number, shown: number): { from: number; to: number } {
  return { from: shown === 0 ? 0 : offset + 1, to: offset + shown }
}
