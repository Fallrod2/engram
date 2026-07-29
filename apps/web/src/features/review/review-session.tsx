import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { CloudOff, Hourglass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { RewardIllustration } from '@/components/illustrations'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useT, usePlural, type TFunction } from '@/lib/i18n'
import { useShell } from '@/components/shell/shell-context'
import type { QueueNewCards } from '@engram/shared'
import type { ReviewScope } from '@/lib/api'
import { CardEditDialog } from '@/features/cards/card-edit-dialog'
import { useReviewSession } from './use-review-session'
import { emptyReason } from './new-card-budget'
import { SessionExitButton, SessionHeader } from './session-header'
import { useTouchSession } from './pointer-labels'
import { ProgressBar } from './progress-bar'
import { CARD_BOX, ReviewCard } from './review-card'
import { RATING_ZONE, RatingBar, VERDICT_BOX } from './rating-bar'
import { CONTEXT_ACTION_ROW, CONTEXT_INFO_ROW, SessionContextBar } from './session-context-bar'
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
      <TerminalView onExit={api.requestExit}>
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
      <TerminalView onExit={api.requestExit}>
        <EmptyQueueView newCards={api.newCards} onExit={api.requestExit} />
      </TerminalView>
    )
  }

  if (api.phase === 'SUMMARY') {
    return (
      <div className="flex flex-1 items-center justify-center">
        {api.summary && (
          <SessionSummary
            summary={api.summary}
            newCards={api.newCards}
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
  const touch = useTouchSession()
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
          card, so nothing is ever silently truncated (no `vh` anywhere).

          T-023 anchored this block to the bottom, because centring it made every
          fixed point on the screen depend on how much content happened to be on
          it: at 1512×797 revealing a two-word card slid the question 22.7px UP
          (the block grew by the 45.4px the rating bar gains when the hint
          becomes four buttons, and centring split that in two), and the rating
          bar sat at y=501 on a short card but y=688 on a long one.

          T-044 centres it again — `justify-center` — and that is now safe, for a
          reason that did not hold then: NOTHING in this column changes size any
          more. The card is a constant `CARD_BOX`, the rating zone reserves one
          constant box across all its branches (`RATING_ZONE`), and the context
          strip is constant per pointer type. Centring a block of constant height
          in a region of constant height puts every row at a constant y — which
          is what the browser measurement says: at 1512×1300 the card top, the
          question, the context strip and the rating grid hold the same y across
          all 25 cards, in ASKING and in REVEALED alike. */}
      <div className="flex min-h-0 flex-1 flex-col items-center px-3 pb-4 sm:px-4 sm:pb-5">
        <div className="flex min-h-0 w-full max-w-[680px] flex-1 flex-col justify-center gap-3">
          {/* No `flex-1` any more: the slot takes its height from the card
              inside it (`CARD_BOX`), and the leftover space goes to
              `justify-center` above. `min-h-0` is still what lets the card give
              its height back on a short viewport — without it flexbox refuses to
              shrink this wrapper and the rating bar leaves the screen. */}
          <div className="flex min-h-0 flex-col">
            {current && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id}
                  // Auto basis, not `flex-1`: the card declares the height, and
                  // every wrapper between it and the region only has to let it
                  // through (`min-h-0` = shrinkable, no growth of its own).
                  className="flex min-h-0 flex-col"
                  initial={api.reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={api.reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
                >
                  <ReviewCard
                    front={current.front}
                    back={current.back}
                    qcm={api.qcm}
                    selectedChoice={api.selectedChoice}
                    revealed={api.revealed}
                    reduce={api.reduce}
                    onReveal={api.reveal}
                    onSelect={api.selectChoice}
                  />
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* Natural height, never compressed — and now the anchor of the whole
              screen: everything in here keeps a constant y (T-023). */}
          <div className="flex shrink-0 flex-col gap-2">
            <SessionContextBar
              remaining={api.remaining}
              difficulty={current?.fsrs.difficulty ?? null}
              canUndo={api.canUndo}
              undoing={api.undoing}
              onEdit={api.openEdit}
              onSkip={api.skip}
              onUndo={api.undo}
            />
            <RatingBar
              revealed={api.revealed}
              preview={api.preview}
              // Also while an undo is in flight: the reducer refuses RATE until it
              // lands (T-008), so the affordance must say so instead of eating the click.
              disabled={api.submitting || api.undoing}
              flashGrade={api.flashGrade}
              suggestedGrade={api.suggestedGrade}
              reduce={api.reduce}
              onReveal={api.reveal}
              onRate={api.rate}
            />
            {api.submitError && (
              <p className="text-center text-xs text-danger">{t('session.saveError')}</p>
            )}
            {/* Keyboard cheat-sheet — pointless (and a false promise) without a
                keyboard, so it is hidden on touch devices (fix-session §3).
                T-029 — its room is not left empty on touch: the 17px it gives
                back is re-spent, one row up, on the 44px labelled action row
                `SessionContextBar` opens there. The reservation is per pointer
                type and constant for the whole session, so nothing shifts
                between ASKING and REVEALED on either device — and the LOADING
                skeleton below mirrors it from the SAME two constants. */}
            {!touch && (
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
function CloseButton({ onExit }: { onExit: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-end px-4">
      <SessionExitButton onExit={onExit} />
    </div>
  )
}

function TerminalView({ children, onExit }: { children: React.ReactNode; onExit: () => void }) {
  return (
    <>
      <CloseButton onExit={onExit} />
      <div className="flex flex-1 items-center justify-center">{children}</div>
    </>
  )
}

/**
 * The empty queue, told truthfully. `total === 0` has three distinct causes and
 * they must not share one message (see `new-card-budget.ts`):
 *
 *  - nothing at all → the congratulation, which is earned;
 *  - the daily new-card budget is spent → N never-seen cards are waiting, and
 *    saying "tout est à jour" here is a lie;
 *  - the user paused new cards (limit 0) → also not "up to date", but not a
 *    limit they hit either: a choice they made, phrased as such.
 *
 * The tone is deliberate: the limit is a protection the user gave themselves, so
 * the copy explains what it buys them ("la charge des prochains jours") and
 * never scolds. The illustration is kept only for the earned case — rewarding
 * someone for a queue that is empty by policy is the defect being fixed.
 *
 * Exported for its test: like `ReviewCard`/`RatingBar` in `session-layout.test`,
 * the copy is asserted on the component itself rather than through the portal,
 * the shell context and a mocked hook.
 */
export function EmptyQueueView({
  newCards,
  onExit,
}: {
  newCards: QueueNewCards | undefined
  onExit: () => void
}) {
  const t = useT()
  const plural = usePlural()
  const reason = emptyReason(newCards)
  const back = <Button onClick={onExit}>{t('common.backToDashboard')}</Button>

  if (reason.kind === 'nothing') {
    return (
      <EmptyState
        illustration={<RewardIllustration />}
        title={t('empty.sessionTitle')}
        meta={t('empty.sessionMeta')}
        action={back}
      />
    )
  }

  const held = reason.withheld
  const title =
    reason.kind === 'paused'
      ? t('empty.sessionPausedTitle')
      : t(`empty.sessionHeldTitle_${plural(held)}`, { count: held })
  const meta =
    reason.kind === 'paused'
      ? t(`empty.sessionPausedMeta_${plural(held)}`, { count: held })
      : t('empty.sessionHeldMeta', { introduced: reason.introduced, limit: reason.limit })

  return (
    <EmptyState
      icon={Hourglass}
      title={title}
      meta={meta}
      action={
        <div className="flex flex-col items-center gap-3">
          <p className="max-w-[46ch] text-pretty text-sm leading-relaxed text-text-muted">
            {reason.kind === 'paused' ? t('empty.sessionPausedHint') : t('empty.sessionHeldHint')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {back}
            {/* The way to act on what this screen just explained (T-049). It was
                left out before because no such control existed anywhere; the
                shared pace control now lives in Settings, so naming the limit
                without offering to change it would be the odd choice. */}
            <Button variant="outline" asChild>
              <Link to="/settings">{t('settings.pace.adjust')}</Link>
            </Button>
          </div>
        </div>
      }
    />
  )
}

function LoadingView({ onExit, t }: { onExit: () => void; t: TFunction }) {
  const touch = useTouchSession()
  return (
    <>
      <div className="h-0.5 w-full bg-surface-2" />
      <CloseButton onExit={onExit} />
      {/* Mirrors PlayView's geometry exactly (same centred region, same 680px
          column, same 12px gap, same 24px context strip, same rating row) so
          LOADING → ASKING swaps content in place instead of jumping. Since
          T-023 that mirroring is cheap to hold: the play geometry no longer
          depends on the card, so the skeleton only has to copy constants.
          Measured, it was 25px out — the cheat-sheet line was missing, so the
          card skeleton stood 25px taller than the card that replaced it.
          T-044 adds one more constant to copy, `CARD_BOX`, and the same
          `justify-center`; both come from the play code, never from a number
          retyped here. */}
      <div className="flex min-h-0 flex-1 flex-col items-center px-3 pb-4 sm:px-4 sm:pb-5">
        <div className="flex min-h-0 w-full max-w-[680px] flex-1 flex-col justify-center gap-3">
          {/* `shrink` is explicit here where the card gets it from
              `overflow-hidden`: a `Skeleton` is a plain block, so without a
              stated minimum size of 0 it would refuse to give height back on a
              short viewport and push the rating grid off screen. */}
          <Skeleton className={cn(CARD_BOX, 'w-full min-h-0 shrink rounded-lg')} />
          <div className="flex shrink-0 flex-col gap-2">
            {/* Both heights come from `session-context-bar`, never from a number
                retyped here: mirroring by hand is exactly what left this
                skeleton 25px off the play screen before T-023. */}
            <Skeleton className={cn(CONTEXT_INFO_ROW, 'w-full rounded-sm')} />
            {touch && <Skeleton className={cn(CONTEXT_ACTION_ROW, 'w-full rounded-sm')} />}
            {/* The rating zone, mirrored from its OWN constants (T-047): the
                reserved box and the shape the verdict pair fills it with. The
                grid used to be retyped here as four `h-16` cells — which was
                only right by coincidence, since the reservation and the control
                inside it are two different decisions. */}
            <div className={RATING_ZONE}>
              <div className="grid h-full w-full grid-cols-2 gap-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className={cn(VERDICT_BOX, 'rounded-md')} />
                ))}
              </div>
            </div>
            {/* Not a skeleton: it is the very line PlayView renders, held
                invisible. A shimmering placeholder for a static cheat-sheet
                would promise content that never loads — this only reserves the
                space, on exactly the same `!coarse` condition, so the swap is
                pixel-identical on both pointer types. */}
            {!touch && (
              <p aria-hidden className="invisible text-center text-2xs uppercase tracking-[0.08em]">
                {t('session.footerHint')}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
