import { useMemo, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  GraduationCap,
  MoreHorizontal,
  Pencil,
  Plus,
  SquareStack,
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
import { ErrorState } from '@/components/error-state'
import { CardsTableSkeleton } from '@/components/skeletons'
import { PageHeader } from '@/components/page-header'
import { SubjectDot } from '@/components/subject-dot'
import { FsrsStateGlyph } from '@/components/fsrs-state-glyph'
import { ConfirmDelete } from '@/components/confirm-delete'
import { useHotkeys } from '@/lib/use-hotkeys'
import { useRovingList } from '@/lib/use-roving'
import { flattenMarkdown } from '@/lib/markdown'
import { formatDateTime, formatDue, formatReps } from '@/lib/format'
import { subjectDetailOptions } from '@/features/subjects/queries'
import { deckDetailOptions, useDeleteDeck, useUpdateDeck } from '@/features/decks/queries'
import {
  cardsListOptions,
  useCreateCard,
  useDeleteCard,
  useUpdateCard,
} from '@/features/cards/queries'
import { CardComposer, type CardComposerHandle } from '@/features/cards/card-composer'
import { CardEditDialog } from '@/features/cards/card-edit-dialog'
import { DeckFormDialog } from '@/features/decks/deck-form-dialog'

export const Route = createFileRoute('/subjects/$subjectId/decks/$deckId')({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(subjectDetailOptions(params.subjectId)),
      context.queryClient.ensureQueryData(deckDetailOptions(params.deckId)),
      context.queryClient.ensureQueryData(cardsListOptions(params.deckId)),
    ]),
  component: CardsPage,
  pendingComponent: CardsPending,
  errorComponent: CardsError,
})

/**
 * Cold-cache loading state (spec §4): the composer — the phase's headline
 * interaction — is available immediately, independent of the table, so a fast
 * keyboard user can start typing cards before the list resolves. The table
 * below it shows a 10-row skeleton until the loader settles.
 */
function CardsPending() {
  const { subjectId, deckId } = Route.useParams()
  const createCard = useCreateCard(deckId, subjectId)
  return (
    <div>
      <div className="mb-4">
        <CardComposer onAdd={(front, back) => createCard.mutate({ deckId, front, back })} />
      </div>
      <CardsTableSkeleton />
    </div>
  )
}

function CardsError({ error }: { error: Error }) {
  const router = useRouter()
  const { subjectId } = Route.useParams()
  const notFound = error instanceof ApiError && error.status === 404
  return (
    <ErrorState
      kind={notFound ? 'deck' : 'cards'}
      {...(notFound
        ? {
            back: (
              <Link to="/subjects/$subjectId" params={{ subjectId }}>
                Retour à la matière
              </Link>
            ),
          }
        : { onRetry: () => void router.invalidate() })}
    />
  )
}

type Sort = 'createdDesc' | 'dueAsc' | 'state'

function CardsPage() {
  const { subjectId, deckId } = Route.useParams()
  const navigate = useNavigate()

  const subject = useQuery(subjectDetailOptions(subjectId)).data
  const deck = useQuery(deckDetailOptions(deckId)).data
  const cards = useQuery(cardsListOptions(deckId)).data ?? []

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

  if (!deck || !subject) return null

  return (
    <div>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/subjects" className="text-text-muted transition-colors hover:text-text">
              Matières
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
                Réviser
                <span className="ml-1 font-mono text-xs tabular-nums text-text-muted">
                  {deckDue}
                </span>
              </Button>
            )}
            <Button onClick={() => composerRef.current?.focus()}>
              <Plus />
              Ajouter une carte
              <Kbd className="ml-1 border-accent-fg/30 bg-transparent text-accent-fg">n</Kbd>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-text-muted"
                  aria-label="Actions du deck"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditDeckOpen(true)}>
                  <Pencil />
                  Éditer le deck
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-danger [&_svg]:text-danger"
                  onSelect={() => setDeleteDeckOpen(true)}
                >
                  <Trash2 />
                  Supprimer
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

      {sorted.length === 0 ? (
        <EmptyState
          icon={SquareStack}
          title="Aucune carte"
          meta="Saisissez un recto/verso ci-dessus et ⌘↵ pour enchaîner."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8">
                  <SortButton
                    label="État"
                    active={sort === 'state'}
                    onClick={() => setSort('state')}
                  />
                </TableHead>
                <TableHead>
                  <SortButton
                    label="Recto"
                    active={sort === 'createdDesc'}
                    onClick={() => setSort('createdDesc')}
                  />
                </TableHead>
                <TableHead className="hidden md:table-cell">Verso</TableHead>
                <TableHead className="w-24">
                  <SortButton
                    label="Dû"
                    active={sort === 'dueAsc'}
                    onClick={() => setSort('dueAsc')}
                  />
                </TableHead>
                <TableHead className="hidden w-16 xl:table-cell">Reps</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody onKeyDown={roving.onKeyDown}>
              {sorted.map((c, i) => {
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
                              aria-label="Actions de la carte"
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditCard(c)}>
                              <Pencil />
                              Éditer
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-danger [&_svg]:text-danger"
                              onSelect={() => setDeleteCard(c)}
                            >
                              <Trash2 />
                              Supprimer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
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
        title="Supprimer cette carte ?"
        description="Supprime cette carte et son historique de révision. Irréversible."
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
        title={`Supprimer « ${deck.name} » ?`}
        description={
          <>
            Supprime définitivement ce deck, ses{' '}
            <strong className="text-text">{cards.length} cartes</strong> et leur historique.
            Irréversible.
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
  active,
  onClick,
}: {
  label: string
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
        (label === 'Dû' || label === 'État' ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        ))}
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
