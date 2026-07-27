import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CloudOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { RewardIllustration } from '@/components/illustrations'
import { Skeleton } from '@/components/ui/skeleton'
import { useT, type TFunction } from '@/lib/i18n'
import { useCoarsePointer } from '@/lib/use-media-query'
import { useShell } from '@/components/shell/shell-context'
import type { ReviewScope } from '@/lib/api'
import { CardEditDialog } from '@/features/cards/card-edit-dialog'
import { useReviewSession } from './use-review-session'
import { SessionHeader } from './session-header'
import { ProgressBar } from './progress-bar'
import { ReviewCard } from './review-card'
import { RatingBar } from './rating-bar'
import { SessionContextBar } from './session-context-bar'
import { SessionSummary } from './session-summary'
import { ExitConfirm } from './exit-confirm'
import { IdleOverlay } from './idle-overlay'

/**
 * The session orchestrator (spec §4.1, §12). Renders full-screen via a portal to
 * `document.body` — the route's Outlet sits in a transformed `motion.div`, which
 * would break a `fixed` child (§0.2). Owns the body-scroll lock, the shell's
 * `sessionActive` flag and initial focus; delegates all logic to the hook.
 */
export function ReviewSession({ scope }: { scope: ReviewScope }) {
  const api = useReviewSession(scope)
  const { setSessionActive } = useShell()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSessionActive(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Trap focus: the full-screen session lives in a body portal, so making the
    // app shell `inert` removes everything behind it from the tab order and the
    // accessibility tree — Tab can never escape the session (a11y §3.2). The
    // shell sits inside `#root`; the portal is a sibling of it, so it stays
    // interactive.
    const shell = document.getElementById('app-shell')
    shell?.setAttribute('inert', '')
    containerRef.current?.focus()
    return () => {
      setSessionActive(false)
      document.body.style.overflow = prev
      shell?.removeAttribute('inert')
      // Restore focus on exit (a11y §3.2, "retour de focus en sortie"). We do
      // NOT capture the launching control: `/review` is a top-level route, so
      // the launch page (e.g. the deck view's "Réviser" button) has already
      // unmounted by the time this session mounts — `document.activeElement` is
      // `<body>` at that point — and `router.history.back()` REMOUNTS that page
      // with fresh DOM nodes, so any captured node is stale (and the button may
      // no longer render at all once the deck's due count drops to 0). Instead
      // move focus to the persistent `#main-content` landmark, which lives in
      // the shell and never unmounts: focus lands on a real, focusable region
      // (`tabIndex=-1`) rather than falling to `<body>`. Focus it AFTER clearing
      // `inert` (an inert element cannot receive focus) and while the overlay is
      // still mounted, so the portal's removal does not bounce focus to `<body>`.
      document.getElementById('main-content')?.focus()
    }
  }, [setSessionActive])

  const overlay = (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-bg text-text outline-none"
    >
      <PhaseView api={api} />
      {/* Reuses the deck screen's card editor rather than growing a second one.
          Radix portals it to `document.body`, OUTSIDE `#app-shell`, so the
          `inert` the session puts on the shell never reaches it. */}
      <CardEditDialog
        open={api.editing}
        onOpenChange={(open) => {
          if (!open) api.closeEdit()
        }}
        card={api.current ?? null}
        onSubmit={api.submitEdit}
      />
      {api.confirmingExit && <ExitConfirm onResume={api.cancelExit} onQuit={api.confirmExit} />}
      {api.paused && <IdleOverlay onResume={api.resume} />}
    </div>
  )

  return createPortal(overlay, document.body)
}

function PhaseView({ api }: { api: ReturnType<typeof useReviewSession> }) {
  const t = useT()
  if (api.phase === 'LOADING') return <LoadingView onExit={api.requestExit} t={t} />

  if (api.phase === 'ERROR') {
    return (
      <TerminalView onExit={api.requestExit} t={t}>
        <EmptyState
          icon={CloudOff}
          title={t('empty.sessionErrorTitle')}
          meta={t('empty.sessionErrorMeta')}
          action={<Button onClick={api.retryQueue}>{t('common.retry')}</Button>}
        />
      </TerminalView>
    )
  }

  if (api.phase === 'EMPTY') {
    return (
      <TerminalView onExit={api.requestExit} t={t}>
        <EmptyState
          illustration={<RewardIllustration />}
          title={t('empty.sessionTitle')}
          meta={t('empty.sessionMeta')}
          action={<Button onClick={api.requestExit}>{t('common.backToDashboard')}</Button>}
        />
      </TerminalView>
    )
  }

  if (api.phase === 'SUMMARY') {
    return (
      <div className="flex flex-1 items-center justify-center">
        {api.summary && (
          <SessionSummary
            summary={api.summary}
            canReviewAgain={api.canReviewAgain}
            canUndo={api.canUndo}
            undoing={api.undoing}
            onExit={api.confirmExit}
            onReviewAgain={api.reviewAgain}
            onUndo={api.undo}
          />
        )}
      </div>
    )
  }

  // Flow: ASKING / REVEALED / SUBMITTING.
  return <PlayView api={api} />
}

function PlayView({ api }: { api: ReturnType<typeof useReviewSession> }) {
  const t = useT()
  const coarse = useCoarsePointer()
  const current = api.current
  return (
    <>
      <ProgressBar done={api.progress.done} total={api.progress.total} reduce={api.reduce} />
      <SessionHeader
        scope={api.scope}
        current={Math.min(api.progress.done + 1, api.progress.total)}
        total={api.progress.total}
        fsrs={current?.fsrs}
        onExit={api.requestExit}
      />

      {/* Elastic region. `min-h-0` is what ALLOWS shrinking below the intrinsic
          size — without it flexbox refuses and the rating bar is pushed out of
          the viewport. No `overflow-hidden`: the overflow scrolls INSIDE the
          card, so nothing is ever silently truncated (no `vh` anywhere). */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 pb-4 sm:px-4 sm:pb-5">
        {/* Card + ratings are ONE centred block: on a tall screen the bar no
            longer anchors to the bottom edge, it stays 12px under the card. */}
        <div className="flex max-h-full w-full max-w-[680px] flex-col gap-3">
          {/* No `flex-1` here — that would re-inflate the zone and push the
              ratings back down. The default `flex-shrink: 1` lets it give way
              under pressure and hands the overflow to the card's scroller. */}
          <div className="flex min-h-0 flex-col">
            {current && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id}
                  className="flex min-h-0 flex-col"
                  initial={api.reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={api.reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
                >
                  <ReviewCard
                    front={current.front}
                    back={current.back}
                    revealed={api.revealed}
                    reduce={api.reduce}
                    onReveal={api.reveal}
                  />
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* Natural height, never compressed. */}
          <div className="flex shrink-0 flex-col gap-2">
            <SessionContextBar
              remaining={api.remaining}
              canUndo={api.canUndo}
              undoing={api.undoing}
              onEdit={api.openEdit}
              onSkip={api.skip}
              onUndo={api.undo}
            />
            <RatingBar
              revealed={api.revealed}
              preview={api.preview}
              disabled={api.submitting}
              flashGrade={api.flashGrade}
              reduce={api.reduce}
              onReveal={api.reveal}
              onRate={api.rate}
            />
            {api.submitError && (
              <p className="text-center text-xs text-danger">{t('session.saveError')}</p>
            )}
            {/* Keyboard cheat-sheet — pointless (and a false promise) without a
                keyboard, so it is hidden on touch devices (fix-session §3). */}
            {!coarse && (
              <p className="text-center text-2xs uppercase tracking-[0.08em] text-text-faint">
                {t('session.footerHint')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Screen-reader announcement of the reveal (spec §15). `sr-only` is
          absolutely positioned, so it costs the flex column nothing. */}
      <div aria-live="polite" className="sr-only">
        {api.revealed ? t('session.revealed') : ''}
      </div>
    </>
  )
}

/** A close affordance for the terminal load states (Échap also exits). */
function CloseButton({ onExit, t }: { onExit: () => void; t: TFunction }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-end px-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onExit}
        aria-label={t('session.exitAria')}
        className="text-text-muted"
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}

function TerminalView({
  children,
  onExit,
  t,
}: {
  children: React.ReactNode
  onExit: () => void
  t: TFunction
}) {
  return (
    <>
      <CloseButton onExit={onExit} t={t} />
      <div className="flex flex-1 items-center justify-center">{children}</div>
    </>
  )
}

function LoadingView({ onExit, t }: { onExit: () => void; t: TFunction }) {
  return (
    <>
      <div className="h-0.5 w-full bg-surface-2" />
      <CloseButton onExit={onExit} t={t} />
      {/* Mirrors PlayView's geometry exactly (same elastic region, same 680px
          column, same 12px gap) so LOADING → ASKING swaps content in place
          instead of jumping. */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 pb-4 sm:px-4 sm:pb-5">
        <div className="flex max-h-full w-full max-w-[680px] flex-col gap-3">
          <Skeleton className="h-[280px] min-h-0 w-full rounded-lg" />
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-md" />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
