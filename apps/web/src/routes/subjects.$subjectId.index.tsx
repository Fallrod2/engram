import { useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { GraduationCap, Layers, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Deck } from '@engram/shared'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/empty-state'
import { useT, usePlural } from '@/lib/i18n'
import { ErrorState } from '@/components/error-state'
import { DecksIllustration } from '@/components/illustrations'
import { DecksSkeleton } from '@/components/skeletons'
import { PageHeader } from '@/components/page-header'
import { EntityRow, RowActions, entityRowClass } from '@/components/entity-row'
import { SubjectDot } from '@/components/subject-dot'
import { CountStat } from '@/components/count-stat'
import { DueCount } from '@/components/due-count'
import { ConfirmDelete } from '@/components/confirm-delete'
import { useHotkeys } from '@/lib/use-hotkeys'
import { useRovingList } from '@/lib/use-roving'
import {
  subjectDetailOptions,
  useArchiveSubject,
  useDeleteSubject,
  useUpdateSubject,
} from '@/features/subjects/queries'
import {
  decksListOptions,
  deckCardCountsOptions,
  useCreateDeck,
  useDeleteDeck,
  useUpdateDeck,
} from '@/features/decks/queries'
import { dueCountsOptions, byDeckMap, bySubjectMap } from '@/features/due-counts/queries'
import { SubjectFormDialog } from '@/features/subjects/subject-form-dialog'
import { DeckFormDialog } from '@/features/decks/deck-form-dialog'

export const Route = createFileRoute('/subjects/$subjectId/')({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(subjectDetailOptions(params.subjectId)),
      context.queryClient.ensureQueryData(decksListOptions(params.subjectId)),
    ]),
  component: DecksPage,
  pendingComponent: () => <DecksSkeleton />,
  errorComponent: DecksError,
})

function DecksError({ error }: { error: Error }) {
  const router = useRouter()
  const notFound = error instanceof ApiError && error.status === 404
  return (
    <ErrorState
      kind={notFound ? 'subject' : 'decks'}
      {...(notFound
        ? { back: <Link to="/subjects">Retour aux matières</Link> }
        : { onRetry: () => void router.invalidate() })}
    />
  )
}

function DecksPage() {
  const { subjectId } = Route.useParams()
  const navigate = useNavigate()
  const t = useT()
  const plural = usePlural()

  const subject = useQuery(subjectDetailOptions(subjectId)).data
  const decks = useQuery(decksListOptions(subjectId)).data ?? []
  const dueCounts = useQuery(dueCountsOptions()).data

  // Per-deck card totals from ONE aggregate request (Phase 7 §2.2) — no more
  // per-deck `limit=1` probe fan-out. Undefined until loaded (→ skeleton); a
  // deck absent from the payload has 0 cards.
  const cardCounts = useQuery(deckCardCountsOptions()).data
  const cardCountByDeck = useMemo(() => {
    const m = new Map<string, number | undefined>()
    for (const d of decks) m.set(d.id, cardCounts ? (cardCounts.get(d.id) ?? 0) : undefined)
    return m
  }, [decks, cardCounts])

  const dueByDeck = useMemo(() => byDeckMap(dueCounts), [dueCounts])
  const subjectDue = useMemo(
    () => bySubjectMap(dueCounts).get(subjectId) ?? 0,
    [dueCounts, subjectId],
  )
  const totalCards = useMemo(
    () => decks.reduce((sum, d) => sum + (cardCountByDeck.get(d.id) ?? 0), 0),
    [decks, cardCountByDeck],
  )

  const sorted = useMemo(
    () => [...decks].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [decks],
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [editDeck, setEditDeck] = useState<Deck | null>(null)
  const [deleteDeck, setDeleteDeck] = useState<Deck | null>(null)
  const [editSubjectOpen, setEditSubjectOpen] = useState(false)
  const [deleteSubjectOpen, setDeleteSubjectOpen] = useState(false)

  const createDeck = useCreateDeck(subjectId)
  const updateDeck = useUpdateDeck(subjectId)
  const deleteDeckMut = useDeleteDeck(subjectId)
  const updateSubject = useUpdateSubject()
  const archiveSubject = useArchiveSubject()
  const deleteSubjectMut = useDeleteSubject()

  const roving = useRovingList<HTMLAnchorElement>(sorted.length, (i) => {
    const d = sorted[i]
    if (d)
      void navigate({
        to: '/subjects/$subjectId/decks/$deckId',
        params: { subjectId, deckId: d.id },
      })
  })
  const activeDeck = sorted[roving.active]

  useHotkeys({
    // preventDefault stops the trigger key from leaking into an autofocused input.
    n: (e) => {
      e.preventDefault()
      setCreateOpen(true)
    },
    e: (e) => {
      e.preventDefault()
      if (activeDeck) setEditDeck(activeDeck)
    },
    x: (e) => {
      e.preventDefault()
      if (activeDeck) setDeleteDeck(activeDeck)
    },
    backspace: (e) => {
      e.preventDefault()
      if (activeDeck) setDeleteDeck(activeDeck)
    },
  })

  if (!subject) return null

  return (
    <div>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/subjects" className="text-text-muted transition-colors hover:text-text">
              Matières
            </Link>
            <span className="text-text-faint">/</span>
          </>
        }
        title={
          <>
            <SubjectDot color={subject.color} className="size-2.5" />
            <span className="truncate">{subject.name}</span>
          </>
        }
        actions={
          <>
            {subjectDue > 0 && (
              <Button
                variant="secondary"
                onClick={() => void navigate({ to: '/review', search: { subjectId } })}
              >
                <GraduationCap />
                Réviser
                <span className="ml-1 font-mono text-xs tabular-nums text-text-muted">
                  {subjectDue}
                </span>
              </Button>
            )}
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Nouveau deck
              <Kbd className="ml-1 border-accent-fg/30 bg-transparent text-accent-fg">n</Kbd>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-text-muted"
                  aria-label="Actions de la matière"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditSubjectOpen(true)}>
                  <Pencil />
                  Éditer la matière
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    archiveSubject.mutate({ id: subject.id, archived: !subject.archived })
                  }
                >
                  {subject.archived ? 'Désarchiver' : 'Archiver'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-danger [&_svg]:text-danger"
                  onSelect={() => setDeleteSubjectOpen(true)}
                >
                  <Trash2 />
                  Supprimer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {/* Recap banner */}
      <p className="mb-4 font-mono text-xs tabular-nums text-text-muted">
        {totalCards} cartes<span className="mx-1.5 text-border-strong">·</span>
        {subjectDue} à réviser
      </p>

      {sorted.length === 0 ? (
        <EmptyState
          illustration={<DecksIllustration />}
          title={t('empty.decksTitle')}
          meta={t('empty.decksMeta')}
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              {t('shortcuts.keys.newDeck')}
              <Kbd className="ml-1 border-accent-fg/30 bg-transparent text-accent-fg">n</Kbd>
            </Button>
          }
        />
      ) : (
        <div>
          <div className="hidden grid-cols-[1fr_72px_96px_40px] items-center px-3 pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint sm:grid">
            <span>Deck</span>
            <span className="text-right">Cartes</span>
            <span className="text-right">Dues</span>
            <span />
          </div>
          <ul className="flex flex-col" onKeyDown={roving.onKeyDown}>
            {sorted.map((d, i) => {
              const cards = cardCountByDeck.get(d.id)
              const due = dueByDeck.get(d.id) ?? 0
              return (
                <EntityRow key={d.id}>
                  <Link
                    {...roving.getItemProps(i)}
                    to="/subjects/$subjectId/decks/$deckId"
                    params={{ subjectId, deckId: d.id }}
                    className={entityRowClass(
                      // Stacked on phones so the deck name gets the full width, the
                      // dense grid returns at sm (fix-mobile-shell §lists).
                      'flex flex-col items-stretch justify-center gap-0.5 py-1.5 sm:grid sm:grid-cols-[1fr_72px_96px_40px] sm:items-center sm:gap-0 sm:py-0',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Layers className="size-4 shrink-0 text-text-muted" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-text">{d.name}</span>
                        {d.description && (
                          <span className="truncate text-xs text-text-muted">{d.description}</span>
                        )}
                      </span>
                    </span>
                    {/* Mobile-only meta sub-line. */}
                    <span className="flex items-center gap-1.5 pl-[1.625rem] font-mono text-2xs tabular-nums text-text-muted sm:hidden">
                      <span>
                        {t(`listMeta.cards_${plural(cards ?? 0)}`, { count: cards ?? 0 })}
                      </span>
                      <span className="text-border-strong">·</span>
                      <span>{t(`listMeta.due_${plural(due)}`, { count: due })}</span>
                    </span>
                    <CountStat value={cards} className="hidden justify-self-end sm:block" />
                    <DueCount
                      value={due}
                      colorHex={subject.color}
                      className="hidden justify-self-end sm:inline-flex"
                    />
                    <span className="hidden sm:block" />
                  </Link>
                  <RowActions>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 pointer-coarse:size-11 text-text-muted"
                          aria-label={`Actions pour ${d.name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditDeck(d)}>
                          <Pencil />
                          Éditer
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-danger [&_svg]:text-danger"
                          onSelect={() => setDeleteDeck(d)}
                        >
                          <Trash2 />
                          Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </RowActions>
                </EntityRow>
              )
            })}
          </ul>
        </div>
      )}

      <DeckFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(values) =>
          createDeck.mutate({ subjectId, name: values.name, description: values.description })
        }
      />
      <DeckFormDialog
        open={editDeck !== null}
        onOpenChange={(o) => !o && setEditDeck(null)}
        {...(editDeck ? { deck: editDeck } : {})}
        onSubmit={(values) => {
          if (editDeck)
            updateDeck.mutate({
              id: editDeck.id,
              patch: { name: values.name, description: values.description },
            })
        }}
      />
      <ConfirmDelete
        open={deleteDeck !== null}
        onOpenChange={(o) => !o && setDeleteDeck(null)}
        title={`Supprimer « ${deleteDeck?.name} » ?`}
        description={
          <>
            Supprime définitivement ce deck, ses{' '}
            <strong className="text-text">
              {cardCountByDeck.get(deleteDeck?.id ?? '') ?? 0} cartes
            </strong>{' '}
            et leur historique. Irréversible.
          </>
        }
        onConfirm={() => deleteDeck && deleteDeckMut.mutate({ id: deleteDeck.id })}
      />

      <SubjectFormDialog
        open={editSubjectOpen}
        onOpenChange={setEditSubjectOpen}
        subject={subject}
        onSubmit={(values) => updateSubject.mutate({ id: subject.id, patch: values })}
      />
      <ConfirmDelete
        open={deleteSubjectOpen}
        onOpenChange={setDeleteSubjectOpen}
        title={`Supprimer « ${subject.name} » ?`}
        description={
          <>
            Cela supprimera définitivement cette matière, ses{' '}
            <strong className="text-text">{decks.length} decks</strong>, leurs cartes et tout
            l'historique. Action irréversible.
          </>
        }
        onConfirm={() => {
          deleteSubjectMut.mutate({ id: subject.id })
          toast('Matière supprimée')
          void navigate({ to: '/subjects' })
        }}
      />
    </div>
  )
}
