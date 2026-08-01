import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search as SearchIcon, X } from 'lucide-react'
import type { CardSearchHit } from '@engram/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/error-state'
import { useHotkeys } from '@/lib/use-hotkeys'
import { usePlural, useT } from '@/lib/i18n'
import { subjectsListOptions } from '@/features/subjects/queries'
import { allDecksOptions } from '@/features/decks/queries'
import { CardEditDialog } from '@/features/cards/card-edit-dialog'
import {
  hasFilters,
  isSearching,
  needleOf,
  pageCount,
  searchRouteSchema,
  toApiQuery,
  type SearchRouteSearch,
} from '@/features/search/params'
import {
  cardCorpusSizeOptions,
  cardDetailOptions,
  cardSearchOptions,
  useBulkDeleteCards,
  useBulkMoveCards,
  useUpdateCardFromSearch,
} from '@/features/search/queries'
import { isFreshFor, pageBounds, searchBody, searchEmptyKind } from '@/features/search/results'
import {
  EMPTY_SELECTION,
  SELECTION_MAX,
  extendTo,
  forget,
  toggleOne,
  togglePage,
  type Selection,
  type SelectionResult,
} from '@/features/search/selection'
import { BulkDeleteConfirm } from '@/features/search/components/bulk-delete-confirm'
import { SearchEmpty } from '@/features/search/components/search-empty'
import { SearchFilters, type FilterPatch } from '@/features/search/components/search-filters'
import { SearchResultsTable } from '@/features/search/components/search-results-table'
import { SearchResultsSkeleton } from '@/features/search/components/search-skeleton'
import { SelectionBar } from '@/features/search/components/selection-bar'
import { MoveCardsDialog } from '@/features/search/components/move-cards-dialog'

/**
 * `/search` — the dedicated card search (T-030).
 *
 * ITS WHOLE STATE IS THE URL. A search is something you send to yourself, come
 * back to, and step out of with Back — including the card editor, which is
 * `?edit=<id>` rather than component state, so closing it is a history step and
 * a ⌘K hit can deep-link straight into it.
 *
 * The one exception is the multi-selection, which is not a view: see
 * `selection.ts` for why a list of ids has no business in a shareable link.
 */
export const Route = createFileRoute('/search')({
  validateSearch: searchRouteSchema,
  component: SearchPage,
  errorComponent: SearchError,
})

function SearchError() {
  const router = useRouter()
  return <ErrorState kind="cards" onRetry={() => void router.invalidate()} />
}

/** Long enough that a fast typist fires one request, short enough to feel live. */
const DEBOUNCE_MS = 250

function SearchPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const t = useT()
  const plural = usePlural()

  const inputRef = useRef<HTMLInputElement>(null)
  /** What is in the box. The URL carries the DEBOUNCED value. */
  const [draft, setDraft] = useState(search.q)
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  /**
   * Every hit the user has had on screen, by id. A selection survives paging,
   * so the delete confirmation would otherwise be unable to say what it is
   * about to destroy once the rows have scrolled out of the fetched page.
   */
  const [known, setKnown] = useState<Map<string, CardSearchHit>>(new Map())

  // --- URL writers ---------------------------------------------------------

  const patch = useCallback(
    (next: Partial<SearchRouteSearch>, opts?: { push?: boolean }) =>
      void navigate({ search: (prev) => ({ ...prev, ...next }), replace: opts?.push !== true }),
    [navigate],
  )

  // The needle is debounced INTO the URL, so the address bar does not churn once
  // per keystroke and Back steps through searches rather than through letters.
  useEffect(() => {
    if (draft === search.q) return
    const id = setTimeout(() => patch({ q: draft, page: 1 }), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [draft, search.q, patch])

  // A needle arriving from OUTSIDE (a ⌘K hand-off, Back, a pasted link) has to
  // land in the box; one the box itself produced must not bounce back into it.
  useEffect(() => {
    setDraft((current) => (current.trim() === search.q.trim() ? current : search.q))
  }, [search.q])

  // --- Data ----------------------------------------------------------------

  const needle = needleOf(search.q)
  const searching = isSearching(search)
  const apiQuery = toApiQuery(search)

  const resultsQuery = useQuery({
    ...cardSearchOptions(apiQuery),
    enabled: searching,
    // Keeps the previous page under the cursor while the next one loads, so
    // paging never collapses the list to zero height and back.
    placeholderData: keepPreviousData,
  })
  const corpusQuery = useQuery(cardCorpusSizeOptions())
  const subjects = useQuery(subjectsListOptions()).data ?? []
  const decks = useQuery(allDecksOptions()).data ?? []

  const data = searching ? resultsQuery.data : undefined
  /**
   * `query` is the server's echo of the needle it answered. A response that
   * does not carry OUR needle is a late answer to an older keystroke — kept on
   * screen (collapsing the list mid-typing is worse) but dimmed, inert, and
   * excluded from the count, so the numbers never describe a different search
   * from the rows underneath them.
   */
  const fresh = isFreshFor(needle, data)
  const stale = searching && data !== undefined && !fresh

  const hits = data?.hits ?? []
  const total = fresh ? data?.total : undefined
  const pages = pageCount(total ?? 0)
  // Every filter is a server-side predicate, so the page is rendered exactly as
  // received: "1–25 of 57" counts the same rows the table draws.
  const bounds = pageBounds(apiQuery.offset, hits.length)

  // T-066 — the corpus probe decides WHICH nothing this screen is showing, so a
  // failed probe used to freeze the screen on its skeleton: `emptyKind` stayed
  // null, `data` stayed undefined, and the idle screen shimmered until reload.
  // Its failure is now a state of its own, both here and one branch down.
  const corpusFailed = corpusQuery.isError && corpusQuery.data === undefined
  const emptyKind = searchEmptyKind({
    searching,
    total,
    corpusTotal: corpusQuery.data,
    corpusFailed,
  })
  const body = searchBody({
    resultsFailed: resultsQuery.isError,
    emptyKind,
    corpusFailed,
    searching,
    hasData: data !== undefined,
  })

  // --- Selection -----------------------------------------------------------

  const pageIds = useMemo(() => hits.map((h) => h.card.id), [hits])

  useEffect(() => {
    if (hits.length === 0) return
    setKnown((prev) => {
      const next = new Map(prev)
      for (const hit of hits) next.set(hit.card.id, hit)
      return next
    })
  }, [hits])

  const applySelection = useCallback(
    (result: SelectionResult) => {
      setSelection(result.selection)
      // The cap is refused HERE, out loud. Silently dropping ids would make
      // "delete the selection" delete a different set from the one on screen.
      if (result.rejected > 0) {
        toast.warning(
          t(`search.selection.capped_${plural(result.rejected)}`, {
            count: result.rejected,
            max: SELECTION_MAX,
          }),
        )
      }
    },
    [plural, t],
  )

  const clearSelection = useCallback(() => setSelection(EMPTY_SELECTION), [])

  // --- Mutations -----------------------------------------------------------

  const bulkDelete = useBulkDeleteCards()
  const bulkMove = useBulkMoveCards()
  const updateCard = useUpdateCardFromSearch()
  const busy = bulkDelete.isPending || bulkMove.isPending

  const selectedIds = selection.ids
  const selectedHits = selectedIds.map((id) => known.get(id)).filter((h) => h !== undefined)

  const confirmDelete = () => {
    const ids = [...selectedIds]
    setDeleteOpen(false)
    bulkDelete.mutate(ids, { onSuccess: () => setSelection((prev) => forget(prev, ids)) })
  }

  const confirmMove = (deckId: string) => {
    bulkMove.mutate({ cardIds: [...selectedIds], deckId }, { onSuccess: () => setMoveOpen(false) })
  }

  // --- Card editor (deep-linked) -------------------------------------------

  const editId = search.edit
  const hitForEdit = editId ? known.get(editId) : undefined
  // A ⌘K hand-off can name a card that is not on THIS page — same needle, but
  // the row may sit at offset 40. Fetch it by id rather than opening an empty
  // dialog, or worse, doing nothing after the user picked something.
  const editFallback = useQuery({
    ...cardDetailOptions(editId ?? ''),
    enabled: editId !== undefined && hitForEdit === undefined,
  })
  const editCard = hitForEdit?.card ?? (editId ? (editFallback.data ?? null) : null)

  // --- Keyboard ------------------------------------------------------------

  useHotkeys({
    '/': (e) => {
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    },
    a: (e) => {
      e.preventDefault()
      applySelection(togglePage(selection, pageIds))
    },
    m: (e) => {
      if (selectedIds.length === 0) return
      e.preventDefault()
      setMoveOpen(true)
    },
    backspace: (e) => {
      if (selectedIds.length === 0) return
      e.preventDefault()
      setDeleteOpen(true)
    },
    delete: (e) => {
      if (selectedIds.length === 0) return
      e.preventDefault()
      setDeleteOpen(true)
    },
    // NOTE: Escape is deliberately NOT here. It clears the selection, and a
    // window-level Escape cannot be told apart from the one cancelling the
    // delete dialog — see `search-results-table.tsx`, where it lives instead.
  })

  // --- Render --------------------------------------------------------------

  const resetFilters = () =>
    patch({
      subject: undefined,
      deck: undefined,
      state: undefined,
      overdue: undefined,
      hideArchived: undefined,
      page: 1,
    })

  const onFilterChange = (next: FilterPatch) => patch({ ...next, page: 1 })
  const corpusSize = corpusQuery.data ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
        <Input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.fieldAria')}
          className="h-10 pl-9 pr-9 text-base"
        />
        {draft.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDraft('')
              patch({ q: '', page: 1 })
              inputRef.current?.focus()
            }}
            aria-label={t('search.clear')}
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-text-faint transition-colors duration-fast hover:bg-surface-2 hover:text-text"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <SearchFilters
        value={search}
        subjects={subjects}
        decks={decks}
        onChange={onFilterChange}
        onReset={resetFilters}
      />

      {body === 'resultsError' ? (
        <ErrorState kind="cards" onRetry={() => void resultsQuery.refetch()} />
      ) : body === 'empty' && emptyKind !== null ? (
        <SearchEmpty
          kind={emptyKind}
          corpusSize={corpusSize}
          filtersActive={hasFilters(search)}
          onResetFilters={resetFilters}
          onQuickFilter={(next) => patch(next)}
        />
      ) : body === 'corpusError' ? (
        // Nothing asked, and the one read that could have furnished this screen
        // is gone. There is no honest empty state left to show — an invitation
        // quoting a corpus size we do not have, or an onboarding screen for an
        // account that may be full — so it says what happened and offers the
        // only thing that can fix it.
        <ErrorState kind="cards" onRetry={() => void corpusQuery.refetch()} />
      ) : body === 'skeleton' ? (
        <SearchResultsSkeleton label={t('search.loading')} />
      ) : (
        <>
          <p className="font-mono text-xs tabular-nums text-text-muted" role="status">
            {pages > 1
              ? t('search.range', { from: bounds.from, to: bounds.to, total: total ?? 0 })
              : t(`search.results_${plural(total ?? 0)}`, { count: total ?? 0 })}
          </p>

          <SearchResultsTable
            hits={hits}
            selection={selection}
            stale={stale}
            onToggle={(id) => applySelection(toggleOne(selection, id))}
            onExtend={(id) => applySelection(extendTo(selection, pageIds, id))}
            onTogglePage={() => applySelection(togglePage(selection, pageIds))}
            onClearSelection={clearSelection}
            onOpen={(hit) => patch({ edit: hit.card.id }, { push: true })}
          />

          {pages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={search.page <= 1}
                onClick={() => patch({ page: search.page - 1 })}
              >
                <ChevronLeft />
                {t('search.prevPage')}
              </Button>
              <span className="font-mono text-2xs tabular-nums text-text-faint">
                {t('search.pageOf', { page: search.page, pages })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={search.page >= pages}
                onClick={() => patch({ page: search.page + 1 })}
              >
                {t('search.nextPage')}
                <ChevronRight />
              </Button>
            </div>
          )}
        </>
      )}

      {selectedIds.length > 0 && (
        <SelectionBar
          count={selectedIds.length}
          busy={busy}
          onClear={clearSelection}
          onMove={() => setMoveOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />
      )}

      <BulkDeleteConfirm
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        count={selectedIds.length}
        hits={selectedHits}
        onConfirm={confirmDelete}
      />

      <MoveCardsDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        count={selectedIds.length}
        subjects={subjects}
        decks={decks}
        busy={bulkMove.isPending}
        onConfirm={confirmMove}
      />

      <CardEditDialog
        open={editId !== undefined && editCard !== null}
        onOpenChange={(open) => !open && patch({ edit: undefined })}
        card={editCard}
        onSubmit={(values) => {
          if (editCard) updateCard.mutate({ id: editCard.id, ...values })
          patch({ edit: undefined })
        }}
      />
    </div>
  )
}
