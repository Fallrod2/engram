import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  bulkCardResultSchema,
  cardSchema,
  searchCardsResponseSchema,
  type BulkCardResult,
  type SearchCardsQuery,
  type SearchCardsResponse,
} from '@engram/shared'
import { ApiError, api, qs } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { usePlural, useT, type PluralCategory, type TFunction } from '@/lib/i18n'

/** How many rows the ⌘K palette shows. It is a shortcut, not the screen. */
export const PALETTE_LIMIT = 8

type ApiQuery = SearchCardsQuery & { limit: number; offset: number }

/** The query string exactly as the key records it — one shape, no drift. */
function paramsOf(q: ApiQuery): Record<string, string | number | boolean | undefined> {
  return {
    q: q.q,
    subjectId: q.subjectId,
    deckId: q.deckId,
    state: q.state,
    overdue: q.overdue,
    hideArchived: q.hideArchived,
    limit: q.limit,
    offset: q.offset,
  }
}

/**
 * One page of `GET /api/cards/search`.
 *
 * `staleTime` is short but not zero: within a few seconds of typing, going back
 * a character must reuse the answer instead of re-asking. Longer would keep
 * showing cards that a bulk delete just removed.
 */
export function cardSearchOptions(query: ApiQuery) {
  const params = paramsOf(query)
  return queryOptions({
    queryKey: qk.cardSearch.results(params),
    queryFn: ({ signal }) =>
      api.get(`/cards/search${qs(params)}`, searchCardsResponseSchema, signal),
    staleTime: 10_000,
  })
}

/**
 * How many cards the account holds at all — the unfiltered `total`, fetched
 * with `limit=1` so the server returns a count and a single row.
 *
 * This exists to keep one promise: never tell someone with an empty account
 * that their SEARCH found nothing. See `searchEmptyKind`.
 */
export function cardCorpusSizeOptions() {
  return queryOptions({
    queryKey: qk.cardSearch.corpusSize,
    queryFn: async ({ signal }): Promise<number> => {
      const res = await api.get(
        `/cards/search${qs({ q: '', limit: 1 })}`,
        searchCardsResponseSchema,
        signal,
      )
      return res.total
    },
    staleTime: 60_000,
  })
}

/** A single card by id — the fallback when a deep-linked `?edit=` is off-page. */
export function cardDetailOptions(cardId: string) {
  return queryOptions({
    queryKey: qk.cards.detail(cardId),
    queryFn: ({ signal }) => api.get(`/cards/${cardId}`, cardSchema, signal),
  })
}

/** Re-read the search response's `hits` type without re-declaring it. */
export type CardSearchPage = SearchCardsResponse

// --- Bulk operations -------------------------------------------------------

/**
 * Everything a batch of cards can move: the searches themselves, the per-deck
 * lists, the aggregate counts, the queue and the plan. Broad on purpose — a
 * bulk move re-attributes review history to another deck and another subject,
 * so a narrow invalidation would leave half the app quoting the old filing.
 */
function invalidateAfterBulk(qc: ReturnType<typeof useQueryClient>): void {
  for (const key of [
    qk.cardSearch.all,
    qk.cards.all,
    qk.decks.cardCountsAll,
    qk.decks.all,
    qk.subjects.all,
    qk.dueCounts.all,
    qk.planning.all,
    qk.analytics.all,
  ]) {
    void qc.invalidateQueries({ queryKey: key })
  }
}

/**
 * Turn a bulk failure into a sentence that says WHAT the server refused.
 *
 * The three statuses are three different situations and only one of them is the
 * user's to fix, so a single "something went wrong" would be useless:
 *  - 404: an id in the batch is gone (deleted in another tab, or in the session
 *    running on a phone). NOTHING was written — the batch is all-or-nothing.
 *  - 409: the destination deck sits under an archived subject, which would take
 *    the cards out of review; the move is refused rather than done quietly.
 *  - 400: over `CARD_BULK_MAX`. The UI caps first, so this is a last resort.
 */
function bulkErrorMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return t('search.bulk.errorGone')
    if (error.status === 409) return t('search.bulk.errorArchived')
    if (error.status === 400) return t('search.bulk.errorTooMany')
  }
  return t('search.bulk.errorGeneric')
}

/**
 * `affected` differs from `requested` only when the caller sent the same id
 * twice — a multi-select spanning two pages can. It is never a partial write,
 * but it IS a number the user did not expect, so it is said out loud instead of
 * being rounded into the happy path.
 */
function reportCount(
  t: TFunction,
  plural: (n: number) => PluralCategory,
  result: BulkCardResult,
  key: 'deleted' | 'moved',
): void {
  if (result.affected !== result.requested) {
    toast.success(t(`search.bulk.${key}Deduped`, { ...result }))
    return
  }
  toast.success(t(`search.bulk.${key}_${plural(result.affected)}`, { count: result.affected }))
}

/**
 * Delete a batch (`POST /api/cards/bulk/delete`).
 *
 * NOT OPTIMISTIC, deliberately. An optimistic removal would have to guess the
 * new `total`, re-page rows in from a server it has not asked yet, and undo all
 * of that on failure — for a rare, deliberate, already-confirmed action whose
 * failure mode (404) means nothing at all was written. A short pending state on
 * a disabled button is honest; a list that re-flows twice is not.
 */
export function useBulkDeleteCards() {
  const qc = useQueryClient()
  const t = useT()
  const plural = usePlural()
  return useMutation({
    mutationFn: (cardIds: string[]) =>
      api.post('/cards/bulk/delete', { cardIds }, bulkCardResultSchema),
    onSuccess: (result) => reportCount(t, plural, result, 'deleted'),
    onError: (error) => toast.error(bulkErrorMessage(t, error)),
    onSettled: () => invalidateAfterBulk(qc),
  })
}

/** Move a batch into another deck (`POST /api/cards/bulk/move`). */
export function useBulkMoveCards() {
  const qc = useQueryClient()
  const t = useT()
  const plural = usePlural()
  return useMutation({
    mutationFn: ({ cardIds, deckId }: { cardIds: string[]; deckId: string }) =>
      api.post('/cards/bulk/move', { cardIds, deckId }, bulkCardResultSchema),
    onSuccess: (result) => reportCount(t, plural, result, 'moved'),
    onError: (error) => toast.error(bulkErrorMessage(t, error)),
    onSettled: () => invalidateAfterBulk(qc),
  })
}

/**
 * Edit one card's front/back from the search screen.
 *
 * Separate from `useUpdateCard`, which patches the per-deck list cache it is
 * keyed on; here the row lives in a search page whose key carries the whole
 * query, so the only correct move is to invalidate the search prefix.
 */
export function useUpdateCardFromSearch() {
  const qc = useQueryClient()
  const t = useT()
  return useMutation({
    mutationFn: ({ id, front, back }: { id: string; front: string; back: string }) =>
      api.patch(`/cards/${id}`, { front, back }, cardSchema),
    onError: () => toast.error(t('toasts.cardUpdateError')),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.cardSearch.all })
      void qc.invalidateQueries({ queryKey: qk.cards.all })
    },
  })
}
