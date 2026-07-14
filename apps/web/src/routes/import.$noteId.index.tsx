import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileWarning, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Deck, Generation, GenerationKind, Subject } from '@engram/shared'
import { ApiError } from '@/lib/api'
import { formatRelativeTime } from '@/lib/format'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { NoteSkeleton } from '@/components/skeletons'
import { PageHeader } from '@/components/page-header'
import { SubjectDot } from '@/components/subject-dot'
import { ConfirmDelete } from '@/components/confirm-delete'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { GenerationLaunchPanel, type DeckGroup } from '@/components/import/generation-launch-panel'
import { GenerationStatusBadge } from '@/components/import/generation-status-badge'
import { ApiKeyMissingBanner } from '@/components/import/generation-error-state'
import { useHotkeys } from '@/lib/use-hotkeys'
import { useRovingList } from '@/lib/use-roving'
import { entityRowClass, EntityRow } from '@/components/entity-row'
import { subjectsListOptions } from '@/features/subjects/queries'
import { allDecksOptions, useCreateDeck } from '@/features/decks/queries'
import { DeckFormDialog } from '@/features/decks/deck-form-dialog'
import { noteDetailOptions, useDeleteNote, useUpdateNote } from '@/features/notes/queries'
import { NoteEditDialog } from '@/features/notes/note-edit-dialog'
import { generationsByNoteOptions, useStartGeneration } from '@/features/generations/queries'
import { classifyGenerationError } from '@/features/generations/errors'

export const Route = createFileRoute('/import/$noteId/')({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(noteDetailOptions(params.noteId)),
      context.queryClient.ensureQueryData(subjectsListOptions()),
      context.queryClient.ensureQueryData(allDecksOptions()),
      context.queryClient.ensureQueryData(generationsByNoteOptions(params.noteId)),
    ]),
  component: NotePage,
  pendingComponent: () => <NoteSkeleton />,
  errorComponent: NoteError,
})

function NoteError({ error }: { error: Error }) {
  const router = useRouter()
  const notFound = error instanceof ApiError && error.status === 404
  return (
    <ErrorState
      kind="note"
      {...(notFound
        ? { back: <Link to="/import">Retour à l'import</Link> }
        : { onRetry: () => void router.invalidate() })}
    />
  )
}

function buildDeckGroups(subjects: Subject[], decks: Deck[]): DeckGroup[] {
  const bySubject = new Map<string, Deck[]>()
  for (const d of decks) bySubject.set(d.subjectId, [...(bySubject.get(d.subjectId) ?? []), d])
  return [...subjects]
    .filter((s) => !s.archived)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((subject) => ({
      subject,
      decks: (bySubject.get(subject.id) ?? []).sort(
        (a, b) => a.position - b.position || a.name.localeCompare(b.name),
      ),
    }))
}

/**
 * Accepted/rejected recap appended to a history row's meta line — only once a
 * generation has been triaged (its items carry a card id). Keeps the run
 * distinguishable at a glance (finding: rows were indistinguishable "Cartes ✓").
 */
function GenerationOutcome({ generation }: { generation: Generation }) {
  if (generation.status !== 'succeeded') return null
  const resolved = generation.items.some((it) => it.cardId !== undefined)
  if (!resolved) return null
  const accepted = generation.items.filter((it) => it.cardId !== undefined).length
  const rejected = generation.items.filter((it) => it.status === 'rejected').length
  return (
    <>
      <span className="px-1 text-border-strong">·</span>
      <span className="tabular-nums">
        {accepted} acceptée{accepted > 1 ? 's' : ''} / {rejected} rejetée{rejected > 1 ? 's' : ''}
      </span>
    </>
  )
}

function NotePage() {
  const { noteId } = Route.useParams()
  const navigate = useNavigate()

  const note = useQuery(noteDetailOptions(noteId)).data
  const subjects = useQuery(subjectsListOptions()).data ?? []
  const decks = useQuery(allDecksOptions()).data ?? []
  const generations = useQuery(generationsByNoteOptions(noteId)).data ?? []

  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()
  const startGen = useStartGeneration()

  const [kind, setKind] = useState<GenerationKind>('cards')
  const [deckId, setDeckId] = useState<string | undefined>(undefined)
  const [apiKeyMissing, setApiKeyMissing] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newDeckOpen, setNewDeckOpen] = useState(false)

  const deckGroups = useMemo(() => buildDeckGroups(subjects, decks), [subjects, decks])
  const noteSubject = note ? (subjects.find((s) => s.id === note.subjectId) ?? null) : null

  // Smart default: first deck of the note's subject (spec §3.3), set once decks
  // are known and no deck is picked yet.
  useEffect(() => {
    if (deckId !== undefined || !note) return
    const preferred = note.subjectId
      ? decks
          .filter((d) => d.subjectId === note.subjectId)
          .sort((a, b) => a.position - b.position)[0]
      : undefined
    if (preferred) setDeckId(preferred.id)
  }, [note, decks, deckId])

  const createDeck = useCreateDeck(note?.subjectId ?? '')

  const roving = useRovingList<HTMLAnchorElement>(generations.length, (i) => {
    const g = generations[i]
    if (g)
      void navigate({
        to: '/import/$noteId/generations/$generationId',
        params: { noteId, generationId: g.id },
      })
  })

  const contentEmpty = (note?.content.trim() ?? '') === ''

  function launch() {
    if (!note || !deckId) return
    setApiKeyMissing(false)
    startGen.mutate(
      { noteId, kind, deckId },
      {
        onSuccess: (gen) => {
          void navigate({
            to: '/import/$noteId/generations/$generationId',
            params: { noteId, generationId: gen.id },
          })
        },
        onError: (err) => {
          if (classifyGenerationError(err) === 'apiKeyMissing') {
            setApiKeyMissing(true)
          } else {
            toast.error('Lancement de la génération échoué', {
              action: { label: 'Réessayer', onClick: () => launch() },
            })
          }
        },
      },
    )
  }

  useHotkeys({
    e: (e) => {
      e.preventDefault()
      setEditOpen(true)
    },
    x: (e) => {
      e.preventDefault()
      setDeleteOpen(true)
    },
    backspace: (e) => {
      e.preventDefault()
      setDeleteOpen(true)
    },
    g: (e) => {
      e.preventDefault()
      const el = document.querySelector<HTMLElement>('#launch-panel [aria-label="Deck cible"]')
      el?.scrollIntoView({ block: 'center' })
      el?.focus()
    },
  })

  if (!note) return null

  // Captured const so TS narrows it through the guard + closure below (no `as`).
  const noteSubjectId = note.subjectId

  return (
    <div>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/import" className="text-text-muted transition-colors hover:text-text">
              Import
            </Link>
            <span className="text-text-faint">/</span>
            {noteSubject && (
              <>
                <span className="flex items-center gap-1.5 text-text-muted">
                  <SubjectDot color={noteSubject.color} />
                  {noteSubject.name}
                </span>
                <span className="text-text-faint">/</span>
              </>
            )}
          </>
        }
        title={<span className="truncate">{note.title}</span>}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-text-muted"
                aria-label="Actions de la note"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil />
                Renommer / matière
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-danger [&_svg]:text-danger"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 />
                Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <div id="launch-panel">
            <GenerationLaunchPanel
              kind={kind}
              onKindChange={setKind}
              deckId={deckId}
              onDeckChange={setDeckId}
              deckGroups={deckGroups}
              contentEmpty={contentEmpty}
              onLaunch={launch}
              pending={startGen.isPending}
              {...(note.subjectId ? { onNewDeck: () => setNewDeckOpen(true) } : {})}
              {...(apiKeyMissing ? { banner: <ApiKeyMissingBanner /> } : {})}
            />
          </div>

          <div>
            <p className="mb-2 px-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
              Historique
            </p>
            {generations.length === 0 ? (
              <p className="px-1 text-xs text-text-muted">
                Aucune génération. Choisissez un type et un deck, puis Générer.
              </p>
            ) : (
              <ul className="flex flex-col" onKeyDown={roving.onKeyDown}>
                {generations.map((g, i) => {
                  const gDeck = decks.find((d) => d.id === g.deckId) ?? null
                  return (
                    <EntityRow key={g.id}>
                      <Link
                        {...roving.getItemProps(i)}
                        to="/import/$noteId/generations/$generationId"
                        params={{ noteId, generationId: g.id }}
                        className={entityRowClass('items-start gap-2 py-2')}
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex min-w-0 items-baseline gap-1.5">
                            <span className="text-sm text-text">
                              {g.kind === 'quiz' ? 'Quiz' : g.kind === 'mixed' ? 'Mixte' : 'Cartes'}
                            </span>
                            {gDeck && (
                              <span className="truncate text-xs text-text-muted">
                                → {gDeck.name}
                              </span>
                            )}
                          </span>
                          <span className="text-2xs text-text-faint">
                            {formatRelativeTime(g.createdAt)}
                            <GenerationOutcome generation={g} />
                          </span>
                        </span>
                        <span className="ml-auto shrink-0 pt-0.5">
                          <GenerationStatusBadge generation={g} />
                        </span>
                      </Link>
                    </EntityRow>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="min-w-0">
          {contentEmpty ? (
            <EmptyState
              icon={FileWarning}
              title="Aucun texte extrait"
              meta="Ce PDF ne contient probablement pas de texte sélectionnable."
            />
          ) : (
            <ScrollArea className="max-h-[calc(100dvh-10rem)] rounded-lg border border-border bg-surface-1 p-4">
              <Markdown source={note.content} />
            </ScrollArea>
          )}
        </div>
      </div>

      <NoteEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        note={note}
        subjects={subjects}
        onSubmit={(patch) => updateNote.mutate({ id: note.id, patch })}
      />
      <ConfirmDelete
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Supprimer « ${note.title} » ?`}
        description="Supprime cette note et toutes ses générations. Les cartes déjà insérées ne sont pas touchées. Irréversible."
        onConfirm={() => {
          deleteNote.mutate({ id: note.id })
          void navigate({ to: '/import' })
        }}
      />
      {noteSubjectId && (
        <DeckFormDialog
          open={newDeckOpen}
          onOpenChange={setNewDeckOpen}
          onSubmit={(values) =>
            createDeck.mutate(
              {
                subjectId: noteSubjectId,
                name: values.name,
                description: values.description,
              },
              { onSuccess: (created) => setDeckId(created.id) },
            )
          }
        />
      )}
    </div>
  )
}
