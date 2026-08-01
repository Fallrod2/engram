import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotion } from '@/lib/motion'
import { AlertTriangle, Check, Minus } from 'lucide-react'
import type { DemoSeedState } from '@engram/shared'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DEMO_BOOT_DEADLINE_MS,
  DEMO_BOOT_STEPS,
  demoBootStepStatus,
  type DemoBootState,
  type DemoBootStep,
  type DemoBootStepStatus,
} from './use-demo-boot'

/**
 * The "opening the demo" window (Alex, 29/07/2026: « une carte qui semble
 * détachée du site, avec un chargement et des étapes »).
 *
 * ────────────────────────────────────────────────────── WHAT IT IS ALLOWED TO SAY
 *
 * Only things that are true. The three rows are the three calls the browser
 * actually makes (`use-demo-boot.ts`), and the line under the last row is the
 * state `GET /api/demo/status` just returned — including `seeding`, which the
 * server answers by seeing its own seed lock held in `pg_locks`, not by guessing.
 * There is no fabricated sub-step, no scripted timing and no percentage: the
 * progress bar is INDETERMINATE because the duration genuinely is unknown.
 *
 * ────────────────────────────────────────────────────────────── DISMISSIBILITY
 *
 * While it is working the window has no ✕ and swallows Escape: the seeding
 * transaction it describes cannot be cancelled server-side, and dropping out
 * halfway is exactly the half-open session the demo flow must never produce.
 * That is only acceptable because the wait is bounded — the hook's hard deadline
 * always turns this into an error state, which IS dismissible and always offers
 * a way out. A window that could spin forever would be worse than no window.
 *
 * ───────────────────────────────────────────────────────────────────── MOTION
 *
 * The card's own open/close is the design system's dialog transition (180 ms,
 * CSS, already neutralised by the global `prefers-reduced-motion` block in
 * `styles.css`), as are the two indeterminate loaders. The only animation added
 * here — the server line sliding in under the active step — is `motion` at
 * 160 ms and is dropped outright under `prefers-reduced-motion`.
 */
export function DemoBootWindow(props: {
  open: boolean
  state: DemoBootState
  onRetry: () => void
  onDismiss: () => void
  onEnterAnyway: () => void
}) {
  const { open, state, onRetry, onDismiss, onEnterAnyway } = props
  const t = useT()
  const reduce = useReducedMotion()

  const failed = state.phase === 'failed' ? state : null
  const working = state.phase === 'working' ? state : null

  // The failure kinds map 1:1 onto a title/body pair, so the window names the
  // real cause instead of one generic "something went wrong".
  const errorCopy = failed
    ? {
        title: t(`landing.demoBoot.error.${failed.failure}Title`),
        body:
          failed.failure === 'timeout'
            ? t('landing.demoBoot.error.timeoutBody', {
                seconds: Math.round(DEMO_BOOT_DEADLINE_MS / 1000),
              })
            : t(`landing.demoBoot.error.${failed.failure}Body`),
      }
    : null

  /**
   * What a screen reader hears as things move. Silent in the error state — the
   * error paragraph is a `role="alert"` and would otherwise be read twice.
   */
  const live = failed
    ? ''
    : state.phase === 'ready'
      ? t('landing.demoBoot.ready')
      : working
        ? `${t(`landing.demoBoot.steps.${working.step}`)} — ${t('landing.demoBoot.stepStatus.active')}`
        : ''

  /**
   * UNMOUNT rather than lean on Radix's exit animation — a simplicity choice, not
   * a workaround. Closing this window is either followed immediately by a
   * navigation (nothing to animate into) or by a dismissal the visitor asked for,
   * so there is no exit worth staging; returning `null` makes "closed" mean
   * "gone" with nothing to reason about. Mounting with `open` already true still
   * plays the enter transition.
   *
   * NOT a defect being routed around. `Presence` only unmounts a closed overlay
   * after `animationend`, and the shared `<Dialog>` is fine as things stand: the
   * `prefers-reduced-motion` block in `styles.css` clamps animations to `0.01ms`,
   * which still fires `animationstart`/`animationend` — that IS why the canonical
   * value is `0.01ms` and not `0`. Measured in Chrome with the OS preference on,
   * across the app's real dialogs: they unmount every time. (An earlier note here
   * claimed otherwise; it was reading the DOM in the same frame as the Escape,
   * which shows `data-state="closed"` a moment before the unmount.)
   *
   * The failure class it feared is only reachable if that rule is ever rewritten
   * to SUSPEND or DEFER the animation — `animation-play-state: paused` (only
   * `animationstart` arrives) or a non-zero `animation-delay` (only
   * `animationcancel` arrives). `styles-reduced-motion.test.ts` now forbids both,
   * so that is a guarded edge, not a live bug.
   */
  if (!open) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Radix only reaches here via the ✕ or Escape, both of which exist only
        // in the error state — so a close request is always a real dismissal.
        if (!next) onDismiss()
      }}
    >
      <DialogContent
        className="max-w-md gap-0 overflow-hidden p-0 ring-1 ring-accent/10"
        hideClose={!failed}
        // Escape is honoured only once there is something to escape from.
        onEscapeKeyDown={(e) => {
          if (!failed) e.preventDefault()
        }}
        // A stray click on the backdrop must never abandon a boot in progress,
        // nor silently discard an error the visitor has not read.
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Top edge: an INDETERMINATE bar. We do not know how long this takes,
            so we do not draw a percentage. Gone the moment it is over. */}
        <div className="h-1">
          {working ? (
            <Progress aria-label={t('landing.demoBoot.progressLabel')} className="rounded-none" />
          ) : (
            <div className={cn('h-full w-full', failed ? 'bg-danger' : 'bg-accent')} aria-hidden />
          )}
        </div>

        <div className="relative">
          {/* The one flourish that detaches the card from the page behind it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-32 overflow-hidden"
          >
            <div className="absolute left-1/2 top-[-70px] h-[180px] w-[380px] -translate-x-1/2 rounded-full bg-accent/12 blur-[70px]" />
          </div>

          <DialogHeader className="px-6 pb-5 pt-6">
            <span className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.12em] text-text-faint">
              <span
                className="flex size-4 items-center justify-center rounded-[3px] bg-accent text-accent-fg"
                aria-hidden
              >
                <span className="text-[7px] leading-none">◆</span>
              </span>
              {t('landing.demoBoot.eyebrow')}
            </span>
            <DialogTitle className="mt-2 text-md">
              {errorCopy ? errorCopy.title : t('landing.demoBoot.title')}
            </DialogTitle>
            <DialogDescription>
              {errorCopy ? (
                <span role="alert">{errorCopy.body}</span>
              ) : (
                t('landing.demoBoot.description')
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <ol className="flex flex-col gap-3 border-t border-border/60 px-6 py-5">
          {DEMO_BOOT_STEPS.map((step) => (
            <StepRow
              key={step}
              step={step}
              status={demoBootStepStatus(state, step)}
              reduce={reduce === true}
              server={working?.step === step ? working.server : null}
              // "Données prêtes." only when they really are — never after a skip.
              ready={state.phase === 'ready' && step === 'prepare' && state.skipped !== 'prepare'}
            />
          ))}
        </ol>

        <p className="sr-only" role="status" aria-live="polite">
          {live}
        </p>

        {failed && (
          <DialogFooter className="border-t border-border/60 px-6 py-4">
            {/* Offered only when a token pair really was granted — otherwise
                "enter anyway" would be a button with nothing behind it. */}
            {failed.resumable && (
              <Button variant="ghost" onClick={onEnterAnyway}>
                {t('landing.demoBoot.error.enterAnyway')}
              </Button>
            )}
            <Button variant="outline" onClick={onDismiss}>
              {t('common.close')}
            </Button>
            <Button onClick={onRetry}>{t('common.retry')}</Button>
          </DialogFooter>
        )}
        {failed?.resumable && (
          <p className="px-6 pb-5 text-2xs leading-relaxed text-text-faint">
            {t('landing.demoBoot.error.enterAnywayHint')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** One step: an icon carrying the state, the label, and the truthful sub-line. */
function StepRow({
  step,
  status,
  server,
  ready,
  reduce,
}: {
  step: DemoBootStep
  status: DemoBootStepStatus
  /** Latest `GET /api/demo/status` state, only for the step actually waiting on it. */
  server: DemoSeedState | null
  /** The boot is over: the last row gets to say so before the window closes. */
  ready: boolean
  reduce: boolean
}) {
  const t = useT()
  const sub = ready
    ? t('landing.demoBoot.server.ready')
    : server
      ? t(`landing.demoBoot.server.${server}`)
      : null

  return (
    <li className="flex items-start gap-3">
      <StepIcon status={status} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm leading-5 transition-colors duration-base',
            (status === 'todo' || status === 'skipped') && 'text-text-faint',
            status === 'active' && 'text-text',
            status === 'done' && 'text-text-muted',
            status === 'failed' && 'text-danger',
          )}
        >
          {t(`landing.demoBoot.steps.${step}`)}
          {/* The icon is decorative; this is how the state reaches a screen reader. */}
          <span className="sr-only"> — {t(`landing.demoBoot.stepStatus.${status}`)}</span>
        </p>
        <AnimatePresence initial={false} mode="wait">
          {sub && (
            <motion.p
              key={sub}
              initial={reduce ? false : { opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="mt-1 text-xs leading-4 text-text-faint"
            >
              {sub}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </li>
  )
}

function StepIcon({ status }: { status: DemoBootStepStatus }) {
  const base = 'mt-px flex size-5 shrink-0 items-center justify-center rounded-full border'
  if (status === 'done') {
    return (
      <span className={cn(base, 'border-accent/40 bg-accent-subtle text-accent')} aria-hidden>
        <Check className="size-3" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className={cn(base, 'border-danger/40 bg-danger/10 text-danger')} aria-hidden>
        <AlertTriangle className="size-3" />
      </span>
    )
  }
  if (status === 'skipped') {
    return (
      <span className={cn(base, 'border-border text-text-faint')} aria-hidden>
        <Minus className="size-3" />
      </span>
    )
  }
  if (status === 'active') {
    return (
      <span className={cn(base, 'border-accent/50 bg-accent-subtle')} aria-hidden>
        {/* CSS pulse, not `motion`: the global prefers-reduced-motion block in
            styles.css already freezes it, exactly like <Skeleton>. */}
        <span className="size-1.5 animate-pulse rounded-full bg-accent" />
      </span>
    )
  }
  return <span className={cn(base, 'border-border')} aria-hidden />
}
