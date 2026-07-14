import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowDown,
  ArrowUp,
  GraduationCap,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import type { Card } from '@engram/shared'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/empty-state'
import { useT, usePlural } from '@/lib/i18n'
import { ErrorState } from '@/components/error-state'
import { CardsIllustration } from '@/components/illustrations'
import { CardsTableSkeleton } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/page-header'
import { SubjectDot } from '@/components/subject-dot'
import { FsrsStateGlyph } from '@/components/fsrs-state-glyph'
import { ConfirmDelete } from '@/components/confirm-delete'
import { useHotkeys } from '@/lib/use-hotkeys'
import { useRovingList } from '@/lib/use-roving'
import { useCoarsePointer } from '@/lib/use-media-query'
import { flattenMarkdown } from '@/lib/markdown'
import { formatDateTime, formatDue, formatReps } from '@/lib/format'
import { subjectDetailOptions } from '@/features/subjects/queries'
import { deckDetailOptions, useDeleteDeck, useUpdateDeck } from '@/features/decks/queries'
import {
  CARD_PAGE_LIMIT,
  cardsListOptions,
  useCreateCard,
  useDeleteCard,
  useUpdateCard,
} from '@/features/cards/queries'
import { CardComposer, type CardComposerHandle } from '@/features/cards/card-composer'
import { CardEditDialog } from '@/features/cards/card-edit-dialog'
import { DeckFormDialog } from '@/features/decks/deck-form-dialog'

export const Route = createFileRoute('/subjects/$subjectId/decks/$deckId')({
  // The loader blocks only on the subject + deck (fast, usually already cached
  // from the parent route). The card LIST is intentionally NOT awaited here: it
  // streams in via `useQuery` inside the page so the composer — the phase's
  // headline interaction (spec §4) — mounts ONCE and stays stable while the
  // table loads. Awaiting it here would force a `pendingComponent` swap that
  // remounts the composer and can drop a fast first submit (Phase 7 §4).
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(subjectDetailOptions(params.subjectId)),
      context.queryClient.ensureQueryData(deckDetailOptions(params.deckId)),
    ]),
  component: CardsPage,
  pendingComponent: CardsPending,
  errorComponent: CardsError,
})

/**
 * Cold-cache loading state (spec §4): shown only while the subject + deck load
 * (rare — they are usually cached from the parent route). No live composer here
 * so there is exactly ONE composer instance across the whole page lifecycle.
 */
function CardsPending() {
  return (
    <div>
      <Skeleton className="mb-4 h-44 rounded-md" />
      <CardsTableSkeleton />
    </div>
  )
}

function CardsError({ error }: { error: Error }) {
  const router = useRouter()
  const t = useT()
  const { subjectId } = Route.useParams()
  const notFound = error instanceof ApiError && error.status === 404
  return (
    <ErrorState
      kind={notFound ? 'deck' : 'cards'}
      {...(notFound
        ? {
            back: (
              <Link to="/subjects/$subjectId" params={{ subjectId }}>
                {t('decks.backToSubject')}
              </Link>
            ),
          }
        : { onRetry: () => void router.invalidate() })}
    />
  )
}

type Sort = 'createdDesc' | 'dueAsc' | 'state'

// Above this many rows the table body is windowed with `@tanstack/react-virtual`
// so a large deck never mounts more than a screenful of <tr> (Phase 7 §2.4).
// Below it, render every row directly — keeps the DOM simple for the common case.
// The list itself is still capped server-side at CARD_PAGE_LIMIT (500), so the
// window operates over at most 500 in-memory rows.
const VIRTUALIZE_THRESHOLD = 150
// Measured row height (px): `py-2` (16) + one line of `text-sm` (~24). The
// virtualizer measures real rows after mount; this is only the pre-measure
// estimate used for the initial scrollbar size.
const ROW_ESTIMATE = 41

function CardsPage() {
  const { subjectId, deckId } = Route.useParams()
  const navigate = useNavigate()
  const t = useT()
  const plural = usePlural()
  const coarse = useCoarsePointer()

  const subject = useQuery(subjectDetailOptions(subjectId)).data
  const deck = useQuery(deckDetailOptions(deckId)).data
  // Cards stream in here (not via the route loader) so the composer stays mounted
  // once while the table loads (Phase 7 §4).
  const cardsQuery = useQuery(cardsListOptions(deckId))
  const cardsPage = cardsQuery.data
  const cards = cardsPage?.cards ?? []
  // The list fetches a single capped page; surface — never hide — the overflow
  // when a deck holds more cards than the page cap (Phase 7 §2.4).
  const total = cardsPage?.total ?? cards.length
  const truncated = total > cards.length

  const [sort, setSort] = useState<Sort>('createdDesc')
  const [editCard, setEditCard] = useState<Card | null>(null)
  const [deleteCard, setDeleteCard] = useState<Card | null>(null)
  const [editDeckOpen, setEditDeckOpen] = useState(false)
  const [deleteDeckOpen, setDeleteDeckOpen] = useState(false)

  const composerRef = useRef<CardComposerHandle>(null)

  const createCard = useCreateCard(deckId, subjectId)
  const updateCard = useUpdateCard(deckId)
  const deleteCardMut = useDeleteCard(deckId, subjectId)
  const updateDeck = useUpdateDeck(subjectId)
  const deleteDeckMut = useDeleteDeck(subjectId)

  const sorted = useMemo(() => sortCards(cards, sort), [cards, sort])
  // Due-now count for this deck, derived from the loaded cards (avoids a second
  // request) — drives the "Réviser" entry into a deck-scoped session (spec §3.1).
  const deckDue = useMemo(() => {
    const now = Date.now()
    return cards.filter((c) => new Date(c.fsrs.due).getTime() <= now).length
  }, [cards])

  const roving = useRovingList<HTMLTableRowElement>(sorted.length, (i) => {
    const c = sorted[i]
    if (c) setEditCard(c)
  })
  const activeCard = sorted[roving.active]

  // Virtualize the body only for large decks (Phase 7 §2.4). The virtualizer is
  // always instantiated (hooks must run unconditionally) but only drives the DOM
  // in the windowed branch; in the direct branch `scrollRef` stays null and it
  // is inert.
  const virtualized = sorted.length > VIRTUALIZE_THRESHOLD
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  })
  // Keep the roving-selected row mounted so keyboard focus can land on it even
  // when it is scrolled out of the window.
  useEffect(() => {
    if (virtualized) rowVirtualizer.scrollToIndex(roving.active)
  }, [virtualized, roving.active, rowVirtualizer])

  useHotkeys({
    // preventDefault stops the trigger key from leaking into the composer/dialog input.
    n: (e) => {
      e.preventDefault()
      composerRef.current?.focus()
    },
    c: (e) => {
      e.preventDefault()
      composerRef.current?.focus()
    },
    e: (e) => {
      e.preventDefault()
      if (activeCard) setEditCard(activeCard)
    },
    x: (e) => {
      e.preventDefault()
      if (activeCard) setDeleteCard(activeCard)
    },
    backspace: (e) => {
      e.preventDefault()
      if (activeCard) setDeleteCard(activeCard)
    },
  })

  // Row renderer shared by the direct and virtualized branches (Phase 7 §2.4) so
  // both paths stay byte-identical in markup — only which rows are mounted differs.
  const renderRow = (c: Card, i: number) => {
    const optimistic = c.id.startsWith('optimistic:')
    return (
      <TableRow
        key={c.id}
        {...roving.getItemProps(i)}
        onClick={() => setEditCard(c)}
        className={cn('cursor-pointer', optimistic && 'opacity-60')}
      >
        <TableCell>
          <FsrsStateGlyph fsrs={c.fsrs} />
        </TableCell>
        <TableCell className="max-w-0">
          <span className="block truncate text-text" title={c.front}>
            {flattenMarkdown(c.front)}
          </span>
        </TableCell>
        <TableCell className="hidden max-w-0 md:table-cell">
          <span className="block truncate text-xs text-text-muted" title={c.back}>
            {flattenMarkdown(c.back)}
          </span>
        </TableCell>
        <TableCell>
          <span
            className="font-mono text-xs tabular-nums text-text-muted"
            title={formatDateTime(c.fsrs.due)}
          >
            {formatDue(c.fsrs.due)}
          </span>
        </TableCell>
        <TableCell className="hidden xl:table-cell">
          <span className="font-mono text-2xs tabular-nums text-text-faint">
            {formatReps(c.fsrs.reps, c.fsrs.lapses)}
          </span>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="opacity-0 transition-opacity duration-fast group-hover/tr:opacity-100 [&:has(:focus-visible)]:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-text-muted"
                  aria-label={t('cards.menuActions')}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditCard(c)}>
                  <Pencil />
                  {t('common.edit')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-danger [&_svg]:text-danger"
                  onSelect={() => setDeleteCard(c)}
                >
                  <Trash2 />
                  {t('common.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  if (!deck || !subject) return null

  return (
    <div>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/subjects" className="text-text-muted transition-colors hover:text-text">
              {t('pageTitle.subjects')}
            </Link>
            <span className="text-text-faint">/</span>
            <Link
              to="/subjects/$subjectId"
              params={{ subjectId }}
              className="flex items-center gap-1.5 text-text-muted transition-colors hover:text-text"
            >
              <SubjectDot color={subject.color} />
              {subject.name}
            </Link>
            <span className="text-text-faint">/</span>
          </>
        }
        title={<span className="truncate">{deck.name}</span>}
        actions={
          <>
            {deckDue > 0 && (
              <Button
                variant="secondary"
                onClick={() => void navigate({ to: '/review', search: { deckId } })}
              >
                <GraduationCap />
                {t('subjects.review')}
                <span className="ml-1 font-mono text-xs tabular-nums text-text-muted">
                  {deckDue}
                </span>
              </Button>
            )}
            <Button onClick={() => composerRef.current?.focus()}>
              <Plus />
              {t('cards.add')}
              {!coarse && (
                <Kbd className="ml-1 border-accent-fg/30 bg-transparent text-accent-fg">n</Kbd>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-text-muted"
                  aria-label={t('decks.menuActions')}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditDeckOpen(true)}>
                  <Pencil />
                  {t('decks.editDeck')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-danger [&_svg]:text-danger"
                  onSelect={() => setDeleteDeckOpen(true)}
                >
                  <Trash2 />
                  {t('common.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="mb-4">
        <CardComposer
          ref={composerRef}
          onAdd={(front, back) => createCard.mutate({ deckId, front, back })}
        />
      </div>

      {cardsQuery.isError ? (
        <ErrorState kind="cards" onRetry={() => void cardsQuery.refetch()} />
      ) : cardsQuery.isPending ? (
        <CardsTableSkeleton />
      ) : sorted.length === 0 ? (
        <EmptyState
          illustration={<CardsIllustration />}
          title={t('empty.cardsTitle')}
          meta={t('empty.cardsMeta')}
        />
      ) : (
        <>
          <div
            ref={virtualized ? scrollRef : undefined}
            className={cn('overflow-x-auto', virtualized && 'max-h-[70vh] overflow-y-auto')}
          >
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-8">
                    <SortButton
                      label={t('cards.colState')}
                      dir="asc"
                      active={sort === 'state'}
                      onClick={() => setSort('state')}
                    />
                  </TableHead>
                  <TableHead>
                    <SortButton
                      label={t('cards.colFront')}
                      dir="desc"
                      active={sort === 'createdDesc'}
                      onClick={() => setSort('createdDesc')}
                    />
                  </TableHead>
                  <TableHead className="hidden md:table-cell">{t('cards.colBack')}</TableHead>
                  <TableHead className="w-24">
                    <SortButton
                      label={t('cards.colDue')}
                      dir="asc"
                      active={sort === 'dueAsc'}
                      onClick={() => setSort('dueAsc')}
                    />
                  </TableHead>
                  <TableHead className="hidden w-16 xl:table-cell">{t('cards.colReps')}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody onKeyDown={roving.onKeyDown}>
                {virtualized
                  ? (() => {
                      const items = rowVirtualizer.getVirtualItems()
                      const first = items[0]
                      const last = items[items.length - 1]
                      const paddingTop = first ? first.start : 0
                      const paddingBottom = last ? rowVirtualizer.getTotalSize() - last.end : 0
                      return (
                        <>
                          {/* Spacer rows preserve table column alignment while
                            keeping only the visible window of <tr> mounted. */}
                          {paddingTop > 0 && (
                            <tr aria-hidden="true">
                              <td colSpan={6} style={{ height: paddingTop }} />
                            </tr>
                          )}
                          {items.map((vi) => {
                            const c = sorted[vi.index]
                            return c ? renderRow(c, vi.index) : null
                          })}
                          {paddingBottom > 0 && (
                            <tr aria-hidden="true">
                              <td colSpan={6} style={{ height: paddingBottom }} />
                            </tr>
                          )}
                        </>
                      )
                    })()
                  : sorted.map((c, i) => renderRow(c, i))}
              </TableBody>
            </Table>
          </div>
          {truncated && (
            <p role="status" className="mt-2 px-3 text-xs text-text-muted">
              {t('cards.truncated', { limit: CARD_PAGE_LIMIT, total })}
            </p>
          )}
        </>
      )}

      <CardEditDialog
        open={editCard !== null}
        onOpenChange={(o) => !o && setEditCard(null)}
        card={editCard}
        onSubmit={(values) => {
          if (editCard) updateCard.mutate({ id: editCard.id, patch: values })
        }}
      />
      <ConfirmDelete
        open={deleteCard !== null}
        onOpenChange={(o) => !o && setDeleteCard(null)}
        title={t('cards.deleteTitle')}
        description={t('cards.deleteDesc')}
        onConfirm={() => deleteCard && deleteCardMut.mutate({ id: deleteCard.id })}
      />

      <DeckFormDialog
        open={editDeckOpen}
        onOpenChange={setEditDeckOpen}
        deck={deck}
        onSubmit={(values) =>
          updateDeck.mutate({
            id: deck.id,
            patch: { name: values.name, description: values.description },
          })
        }
      />
      <ConfirmDelete
        open={deleteDeckOpen}
        onOpenChange={setDeleteDeckOpen}
        title={t('subjects.deleteTitle', { name: deck.name })}
        description={
          <>
            {t('decks.deleteLead')}{' '}
            <strong className="text-text">
              {t(`listMeta.cards_${plural(total)}`, { count: total })}
            </strong>
            {t('decks.deleteTail')}
          </>
        }
        onConfirm={() => {
          deleteDeckMut.mutate({ id: deck.id })
          void navigate({ to: '/subjects/$subjectId', params: { subjectId } })
        }}
      />
    </div>
  )
}

function SortButton({
  label,
  dir,
  active,
  onClick,
}: {
  label: string
  /** Arrow shown when active: ascending (state/due) points up, descending (recency) down. */
  dir: 'asc' | 'desc'
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-xs uppercase tracking-[0.08em]',
        'transition-colors duration-fast hover:text-text',
        active && 'text-text',
      )}
    >
      {label}
      {active &&
        (dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  )
}

function sortCards(cards: Card[], sort: Sort): Card[] {
  const copy = [...cards]
  switch (sort) {
    case 'dueAsc':
      return copy.sort((a, b) => a.fsrs.due.localeCompare(b.fsrs.due))
    case 'state':
      return copy.sort(
        (a, b) => a.fsrs.state - b.fsrs.state || a.fsrs.due.localeCompare(b.fsrs.due),
      )
    case 'createdDesc':
    default:
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
}
