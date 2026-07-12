import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CloudOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { RewardIllustration } from '@/components/illustrations'
import { Skeleton } from '@/components/ui/skeleton'
import { useT, type TFunction } from '@/lib/i18n'
import { useShell } from '@/components/shell/shell-context'
import type { ReviewScope } from '@/lib/api'
import { useReviewSession } from './use-review-session'
import { SessionHeader } from './session-header'
import { ProgressBar } from './progress-bar'
import { FlipCard } from './flip-card'
import { RatingBar } from './rating-bar'
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
    containerRef.current?.focus()
    return () => {
      setSessionActive(false)
      document.body.style.overflow = prev
    }
  }, [setSessionActive])

  const overlay = (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-bg text-text outline-none"
    >
      <PhaseView api={api} />
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
            onExit={api.confirmExit}
            onReviewAgain={api.reviewAgain}
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
  const current = api.current
  return (
    <>
      <ProgressBar done={api.progress.done} total={api.progress.total} reduce={api.reduce} />
      <SessionHeader
        scope={api.scope}
        current={Math.min(api.progress.done + 1, api.progress.total)}
        total={api.progress.total}
        onExit={api.requestExit}
      />

      <div className="flex flex-1 items-center justify-center overflow-hidden px-4">
        <div className="flex w-full max-w-[680px] justify-center">
          {current && (
            <AnimatePresence mode="wait">
              <motion.div
                key={current.id}
                className="w-full"
                initial={api.reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={api.reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
              >
                <FlipCard
                  front={current.front}
                  back={current.back}
                  revealed={api.revealed}
                  reduce={api.reduce}
                />
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Screen-reader announcement of the reveal (spec §15). */}
      <div aria-live="polite" className="sr-only">
        {api.revealed ? t('session.revealed') : ''}
      </div>

      <div className="flex flex-col items-center gap-3 px-4 pb-6">
        <div className="w-full max-w-[680px]">
          <RatingBar
            revealed={api.revealed}
            preview={api.preview}
            disabled={api.submitting}
            flashGrade={api.flashGrade}
            reduce={api.reduce}
            onRate={api.rate}
          />
          {api.submitError && (
            <p className="mt-2 text-center text-xs text-danger">{t('session.saveError')}</p>
          )}
        </div>
        <p className="text-2xs uppercase tracking-[0.08em] text-text-faint">
          {t('session.footerHint')}
        </p>
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
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
        <Skeleton className="h-[280px] w-full max-w-[680px] rounded-lg" />
        <div className="grid w-full max-w-[680px] grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-md" />
          ))}
        </div>
      </div>
    </>
  )
}
