import { useEffect, useReducer, useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MoreHorizontal, RotateCw, Sparkles, X } from 'lucide-react'
import type { Deck, Generation } from '@engram/shared'
import { ApiError } from '@/lib/api'
import { useT, usePlural } from '@/lib/i18n'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ProposalCard } from '@/components/import/proposal-card'
import { ReviewFooterBar } from '@/components/import/review-footer-bar'
import {
  ApiKeyMissingBanner,
  GenerationErrorState,
} from '@/components/import/generation-error-state'
import { useHotkeys } from '@/lib/use-hotkeys'
import { useRovingList } from '@/lib/use-roving'
import { noteDetailOptions } from '@/features/notes/queries'
import { allDecksOptions } from '@/features/decks/queries'
import {
  generationDetailOptions,
  useResolveGeneration,
  useStartGeneration,
} from '@/features/generations/queries'
import {
  countReview,
  initReviewItems,
  reviewReducer,
  toResolvePayload,
} from '@/features/generations/review-machine'
import { isApiKeyError } from '@/features/generations/errors'

export const Route = createFileRoute('/import/$noteId/generations/$generationId')({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(generationDetailOptions(params.generationId)),
      context.queryClient.ensureQueryData(noteDetailOptions(params.noteId)),
      context.queryClient.ensureQueryData(allDecksOptions()),
    ]),
  component: GenerationReviewPage,
  pendingComponent: () => <PendingSkeleton />,
  errorComponent: ReviewError,
})

function ReviewError({ error }: { error: Error }) {
  const router = useRouter()
  const t = useT()
  const { noteId } = Route.useParams()
  const notFound = error instanceof ApiError && error.status === 404
  return (
    <ErrorState
      kind="generation"
      {...(notFound
        ? {
            back: (
              <Link to="/import/$noteId" params={{ noteId }}>
                {t('generation.backToNote')}
              </Link>
            ),
          }
        : { onRetry: () => void router.invalidate() })}
    />
  )
}

function PendingSkeleton() {
  return (
    <div className="mx-auto max-w-[900px]">
      <div className="mb-6 h-8 w-64 animate-pulse rounded bg-surface-2" />
      <GhostCards />
    </div>
  )
}

function GhostCards({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border border-border bg-surface-1 px-4 py-3">
          <div className="mb-2 h-3 w-3/4 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  )
}

function GenerationReviewPage() {
  const { noteId, generationId } = Route.useParams()
  const t = useT()
  const generation = useQuery(generationDetailOptions(generationId)).data
  const note = useQuery(noteDetailOptions(noteId)).data
  const decks = useQuery(allDecksOptions()).data ?? []

  if (!generation || !note) return null
  const deck = decks.find((d) => d.id === generation.deckId) ?? null

  const kindLabel =
    generation.kind === 'quiz'
      ? t('generation.kindQuiz')
      : generation.kind === 'mixed'
        ? t('generation.kindMixed')
        : t('generation.kindCards')

  const header = (
    <ReviewHeader
      noteId={noteId}
      noteTitle={note.title}
      kindLabel={kindLabel}
      deckName={deck?.name ?? null}
      generation={generation}
    />
  )

  if (generation.status === 'pending') {
    return (
      <div className="mx-auto max-w-[900px]">
        {header}
        <PendingView noteId={noteId} createdAt={generation.createdAt} />
      </div>
    )
  }

  if (generation.status === 'failed') {
    const apiKey = isApiKeyError(generation.error)
    return (
      <div className="mx-auto max-w-[900px]">
        {header}
        {apiKey ? <ApiKeyMissingBanner /> : <FailedView noteId={noteId} generation={generation} />}
      </div>
    )
  }

  // succeeded
  if (generation.items.length === 0) {
    return (
      <div className="mx-auto max-w-[900px]">
        {header}
        <EmptyState
          icon={Sparkles}
          title={t('generation.emptyTitle')}
          meta={t('generation.emptyMeta')}
          action={
            <RelaunchButton
              noteId={noteId}
              generation={generation}
              label={t('generation.relaunch')}
            />
          }
        />
      </div>
    )
  }

  const mode = generation.items.some((i) => i.cardId !== undefined) ? 'resolved' : 'draft'
  return (
    <div className="mx-auto max-w-[900px]">
      {header}
      <ReviewBoard key={mode} generation={generation} deck={deck} />
    </div>
  )
}

function ReviewHeader({
  noteId,
  noteTitle,
  kindLabel,
  deckName,
  generation,
}: {
  noteId: string
  noteTitle: string
  kindLabel: string
  deckName: string | null
  generation: Generation
}) {
  const t = useT()
  return (
    <PageHeader
      breadcrumb={
        <>
          <Link to="/import" className="text-text-muted transition-colors hover:text-text">
            {t('pageTitle.import')}
          </Link>
          <span className="text-text-faint">/</span>
          <Link
            to="/import/$noteId"
            params={{ noteId }}
            className="truncate text-text-muted transition-colors hover:text-text"
          >
            {noteTitle}
          </Link>
          <span className="text-text-faint">/</span>
        </>
      }
      title={
        <span className="flex items-center gap-2">
          {kindLabel}
          {deckName && (
            <span className="font-mono text-sm font-normal text-text-muted">
              {t('generation.towards', { name: deckName })}
            </span>
          )}
        </span>
      }
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-text-muted"
              aria-label={t('generation.actionsAria')}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <RelaunchMenuItem noteId={noteId} generation={generation} />
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/import/$noteId" params={{ noteId }}>
                {t('generation.backToNote')}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  )
}

/** Elapsed timer + indeterminate progress + ghost cards (spec §4.2). */
function PendingView({ noteId, createdAt }: { noteId: string; createdAt: string }) {
  const navigate = useNavigate()
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  const [waitBase, setWaitBase] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const elapsed = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000))
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const tooLong = now - waitBase > 90_000

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2">
        <Progress aria-label={t('generation.generatingAria')} />
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-muted">{t('generation.generating')}</span>
          <span className="font-mono text-xs tabular-nums text-text-faint">
            {mm}:{ss}
          </span>
        </div>
      </div>

      {tooLong && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3">
          <p className="text-sm text-text-muted">{t('generation.tooLong')}</p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setWaitBase(Date.now())}>
              {t('generation.keepWaiting')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigate({ to: '/import/$noteId', params: { noteId } })}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      <GhostCards />
    </div>
  )
}

function FailedView({ noteId, generation }: { noteId: string; generation: Generation }) {
  const navigate = useNavigate()
  const t = useT()
  const startGen = useStartGeneration()
  return (
    <GenerationErrorState
      error={generation.error}
      retrying={startGen.isPending}
      onRetry={() =>
        startGen.mutate(
          {
            noteId,
            kind: generation.kind,
            ...(generation.deckId ? { deckId: generation.deckId } : {}),
          },
          {
            onSuccess: (gen) =>
              void navigate({
                to: '/import/$noteId/generations/$generationId',
                params: { noteId, generationId: gen.id },
              }),
            onError: () => toast.error(t('generation.relaunchError')),
          },
        )
      }
    />
  )
}

function RelaunchButton({
  noteId,
  generation,
  label,
}: {
  noteId: string
  generation: Generation
  label: string
}) {
  const navigate = useNavigate()
  const t = useT()
  const startGen = useStartGeneration()
  return (
    <Button
      disabled={startGen.isPending}
      onClick={() =>
        startGen.mutate(
          {
            noteId,
            kind: generation.kind,
            ...(generation.deckId ? { deckId: generation.deckId } : {}),
          },
          {
            onSuccess: (gen) =>
              void navigate({
                to: '/import/$noteId/generations/$generationId',
                params: { noteId, generationId: gen.id },
              }),
            onError: () => toast.error(t('generation.relaunchError')),
          },
        )
      }
    >
      <RotateCw />
      {label}
    </Button>
  )
}

function RelaunchMenuItem({ noteId, generation }: { noteId: string; generation: Generation }) {
  const navigate = useNavigate()
  const t = useT()
  const startGen = useStartGeneration()
  return (
    <DropdownMenuItem
      onSelect={() =>
        startGen.mutate(
          {
            noteId,
            kind: generation.kind,
            ...(generation.deckId ? { deckId: generation.deckId } : {}),
          },
          {
            onSuccess: (gen) =>
              void navigate({
                to: '/import/$noteId/generations/$generationId',
                params: { noteId, generationId: gen.id },
              }),
            onError: () => toast.error(t('generation.relaunchError')),
          },
        )
      }
    >
      <RotateCw />
      {t('generation.relaunchFull')}
    </DropdownMenuItem>
  )
}

/** The keyboard triage board (spec §4.3–4.6). Local state until `resolve`. */
function ReviewBoard({ generation, deck }: { generation: Generation; deck: Deck | null }) {
  const { noteId } = Route.useParams()
  const t = useT()
  const plural = usePlural()
  const [items, dispatch] = useReducer(reviewReducer, generation.items, initReviewItems)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const resolveMut = useResolveGeneration()

  const resolved = items.some((i) => i.frozen)
  const counts = countReview(items)

  const roving = useRovingList<HTMLElement>(items.length)
  const active = items[roving.active]

  function advance() {
    roving.focusIndex(Math.min(items.length - 1, roving.active + 1))
  }

  useHotkeys(
    {
      a: (e) => {
        e.preventDefault()
        if (e.shiftKey) {
          dispatch({ type: 'acceptAllPending' })
          return
        }
        if (active) {
          dispatch({ type: 'accept', id: active.id })
          advance()
        }
      },
      r: (e) => {
        e.preventDefault()
        if (active) {
          dispatch({ type: 'reject', id: active.id })
          advance()
        }
      },
      e: (e) => {
        e.preventDefault()
        if (active) setEditingId(active.id)
      },
      u: (e) => {
        e.preventDefault()
        if (active) dispatch({ type: 'undo', id: active.id })
      },
      'mod+enter': (e) => {
        e.preventDefault()
        if (counts.toInsert > 0) setConfirmOpen(true)
      },
    },
    { enabled: editingId === null && !resolved },
  )

  function insert() {
    resolveMut.mutate(
      { id: generation.id, items: toResolvePayload(items) },
      {
        onSuccess: (resolvedGen) => {
          const n = resolvedGen.items.filter((i) => i.cardId !== undefined).length
          const inDeck = deck ? t('generation.toastInDeck', { name: deck.name }) : ''
          toast.success(`${t(`generation.insertedToast_${plural(n)}`, { count: n })}${inDeck}`)
        },
        onError: () =>
          toast.error(t('generation.insertError'), {
            action: { label: t('common.retry'), onClick: () => insert() },
          }),
      },
    )
    setConfirmOpen(false)
  }

  const insertedCount = items.filter((i) => i.frozen && i.status !== 'rejected').length
  const rejectedCount = items.filter((i) => i.status === 'rejected').length

  return (
    <div>
      {resolved && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3">
          <p className="text-sm text-text">
            <span className="font-mono tabular-nums text-text">{insertedCount}</span>{' '}
            {t(`generation.resolvedInserted_${plural(insertedCount)}`)}
            {deck ? t('generation.inDeck', { name: deck.name }) : ''}
            <span className="px-1.5 text-border-strong">·</span>
            <span className="font-mono tabular-nums text-text-muted">{rejectedCount}</span>{' '}
            {t(`generation.resolvedRejected_${plural(rejectedCount)}`)}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {deck && insertedCount > 0 && (
              <Button asChild variant="secondary" size="sm">
                <Link to="/review" search={{ deckId: deck.id }}>
                  {t('common.reviewNow')}
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link to="/import/$noteId" params={{ noteId }}>
                {t('generation.newGeneration')}
              </Link>
            </Button>
          </div>
        </div>
      )}

      <div
        className="flex flex-col gap-3"
        onKeyDown={editingId === null ? roving.onKeyDown : undefined}
      >
        {items.map((item, i) => (
          <ProposalCard
            key={item.id}
            item={item}
            index={i + 1}
            cursorActive={i === roving.active}
            editing={editingId === item.id}
            readOnly={resolved}
            {...(item.frozen && deck
              ? {
                  deckLink: {
                    to: '/subjects/$subjectId/decks/$deckId' as const,
                    params: { subjectId: deck.subjectId, deckId: deck.id },
                  },
                }
              : {})}
            rowProps={roving.getItemProps(i)}
            onAccept={() => {
              dispatch({ type: 'accept', id: item.id })
            }}
            onReject={() => {
              dispatch({ type: 'reject', id: item.id })
            }}
            onEdit={(front, back) => {
              dispatch({ type: 'edit', id: item.id, front, back })
              setEditingId(null)
              // Restore focus to the card so j/k/↑/↓ roving keeps working
              // (leaving the textarea would drop focus onto <body>, spec §4.8).
              roving.focusIndex(i)
            }}
            onUndo={() => dispatch({ type: 'undo', id: item.id })}
            onStartEdit={() => setEditingId(item.id)}
            onCancelEdit={() => {
              setEditingId(null)
              roving.focusIndex(i)
            }}
          />
        ))}
      </div>

      {!resolved && (
        <ReviewFooterBar
          counts={counts}
          insertPending={resolveMut.isPending}
          onInsert={() => setConfirmOpen(true)}
        />
      )}

      <InsertConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        count={counts.toInsert}
        deckName={deck?.name ?? null}
        onConfirm={insert}
      />
    </div>
  )
}

/** Non-destructive insertion confirm (spec §4.5) — focus lands on "Insérer". */
function InsertConfirmDialog({
  open,
  onOpenChange,
  count,
  deckName,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  deckName: string | null
  onConfirm: () => void
}) {
  const t = useT()
  const plural = usePlural()
  const inDeck = deckName ? t('generation.inDeck', { name: deckName }) : ''
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {`${t(`generation.insertConfirm_${plural(count)}`, { count })}${inDeck} ?`}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('generation.insertConfirmDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <X className="size-4" />
            {t('common.cancel')}
          </AlertDialogCancel>
          {/* Constructive action → accent variant + initial focus (safe here). */}
          <AlertDialogAction
            autoFocus
            className="bg-accent-fill text-accent-fg hover:bg-accent-fill-hover active:bg-accent-fill-active"
            onClick={onConfirm}
          >
            {t('generation.insert')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
