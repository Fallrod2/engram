import type { SearchCardsResponse } from '@engram/shared'
import type { PluralCategory, TFunction } from '@/lib/i18n'

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
 *
 * T-066 — waiting is only right while there is something to wait FOR. When the
 * probe has FAILED, `corpusTotal` is undefined for good and "keep the skeleton
 * up" becomes "shimmer for ever": the idle screen never resolved, and a search
 * that answered zero printed a bare "0 cartes" over an empty table instead of
 * its empty state. `corpusFailed` says which kind of unknown this is. It cannot
 * conjure the missing figure, so it does the two things it can: it lets a real
 * answer of zero be called `noResults` (true of the SEARCH, whatever the corpus
 * holds), and it leaves the idle case to the caller, which owes the user a
 * visible error and a retry rather than any empty state at all.
 */
export type SearchEmptyKind = 'idle' | 'noResults' | 'noCards'

export function searchEmptyKind(input: {
  /** Is a needle or a filter in force? (`isSearching` from `params.ts`.) */
  searching: boolean
  /** `total` of the CURRENT search, or `undefined` while it is unknown. */
  total: number | undefined
  /** Size of the whole corpus (the unfiltered probe), or `undefined`. */
  corpusTotal: number | undefined
  /** Did the corpus probe FAIL? (As opposed to merely not having landed.) */
  corpusFailed?: boolean
}): SearchEmptyKind | null {
  if (input.corpusTotal === undefined) {
    // Not merely unknown — unknowable without another request. Only a search
    // that came back with a real zero can still be described honestly.
    if (!input.corpusFailed) return null
    return input.searching && input.total === 0 ? 'noResults' : null
  }
  if (input.corpusTotal === 0) return 'noCards'
  if (!input.searching) return 'idle'
  if (input.total === undefined) return null
  return input.total === 0 ? 'noResults' : null
}

/**
 * What the results area of `/search` renders — the whole ladder, in order.
 *
 * It lived inline as a nested ternary, which was fine at three arms. T-066 adds
 * a fourth (`corpusError`) whose entire reason for existing is a case nobody can
 * reach from a unit test through the route component: the route reads its own
 * URL search params, so mounting it means mounting a router. Naming the arms
 * moves the decision somewhere it can be asserted, and the order — which is the
 * part that actually bites — is stated once instead of being inferred from
 * indentation.
 *
 * The order says: a failed SEARCH outranks everything (it is what the user just
 * asked for); a decided empty state outranks a lost corpus probe (we know what
 * to say, so say it); a lost probe outranks the skeleton ONLY when nothing else
 * is coming, because a search still in flight will resolve its own skeleton.
 */
export type SearchBody = 'resultsError' | 'empty' | 'corpusError' | 'skeleton' | 'results'

export function searchBody(input: {
  /** The search request itself failed. */
  resultsFailed: boolean
  /** `searchEmptyKind`'s verdict. */
  emptyKind: SearchEmptyKind | null
  /** The corpus probe failed (not merely pending). */
  corpusFailed: boolean
  /** Is a needle or a filter in force? */
  searching: boolean
  /** Is there a response to draw rows from? */
  hasData: boolean
}): SearchBody {
  if (input.resultsFailed) return 'resultsError'
  if (input.emptyKind !== null) return 'empty'
  if (input.corpusFailed && !input.searching) return 'corpusError'
  if (!input.hasData) return 'skeleton'
  return 'results'
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

/**
 * The count line above the table — "1–25 sur 57", "12 cartes", or neither.
 *
 * T-067 — it used to be written inline as `total ?? 0`, and the `??` fired in
 * exactly one situation: a response rejected as STALE (`isFreshFor` said it
 * answers an older needle). The rows of that older answer stay on screen,
 * greyed and inert, on purpose — collapsing the list under a typing user is
 * worse — but the line above them then read "0 cartes", which is not what the
 * screen shows, not what the server said, and not what the next answer will say
 * either. A zero is a claim about the search; the honest state here is "we do
 * not have the number yet", and the app already has a mark for that.
 *
 * `pages` is derived from the same `total`, so a stale page cannot show a pager
 * either; nothing in this line is invented from a value we do not hold.
 */
export function resultsCountLabel(
  t: TFunction,
  plural: (count: number) => PluralCategory,
  input: { total: number | undefined; pages: number; from: number; to: number },
): string {
  if (input.total === undefined) return t('search.resultsUnknown')
  if (input.pages > 1) {
    return t('search.range', { from: input.from, to: input.to, total: input.total })
  }
  return t(`search.results_${plural(input.total)}`, { count: input.total })
}
