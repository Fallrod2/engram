import { type ReactNode } from 'react'
import { Info } from 'lucide-react'
import type { GenerationOrigin } from '@engram/shared'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Provenance disclosure for a `origin: 'prerecorded'` generation (T-031).
 *
 * The demo account ships one generation whose cards were written by hand, so a
 * visitor with no API key can still do the real card-by-card review. That
 * staging is disclosed HERE, and the disclosure is deliberately:
 *
 *  - PERSISTENT, not a toast or a tooltip. A visitor who arrives mid-scroll, or
 *    comes back to the screen later, must still be told. Something you can miss
 *    by blinking is not a disclosure.
 *  - DRIVEN BY THE STORED FIELD, never by "is this the demo account". The claim
 *    lives in `generation.origin`, so the banner cannot drift away from the row.
 *  - NOT AN ERROR. It uses the `info` hue and `role="note"` — never `warning`
 *    (which this screen reserves for "no provider configured") and never
 *    `role="alert"`. Nothing is wrong here; something is being declared.
 *
 * It carries three facts, and dropping any one of them would make it misleading:
 * the cards were pre-written, nothing was generated or billed, and the review
 * below is genuinely real.
 */
export function PrerecordedNotice({ className }: { className?: string }) {
  const t = useT()
  return (
    <div
      role="note"
      className={cn(
        'rounded-md border border-info/30 bg-info-subtle px-4 py-3',
        'flex items-start gap-3',
        className,
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-info" strokeWidth={2} aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium text-text">{t('generation.prerecordedTitle')}</p>
        <p className="text-xs leading-relaxed text-text-muted">{t('generation.prerecordedBody')}</p>
      </div>
    </div>
  )
}

/**
 * The same claim, compressed to a list row (generation history, notes list) so
 * the staging is visible BEFORE opening the screen — nobody should discover it
 * only once they are already inside. Monochrome on purpose: a list is scanned,
 * and a coloured pill there would compete with the run-status badge next to it.
 */
export function PrerecordedBadge({ className }: { className?: string }) {
  const t = useT()
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-xs bg-surface-3 px-1.5',
        'text-2xs text-text-muted',
        className,
      )}
    >
      {t('generation.prerecordedBadge')}
    </span>
  )
}

/**
 * The single frame of the generation review screen — header, then the provenance
 * notice, then whatever the run's status calls for.
 *
 * It exists so the disclosure is emitted ONCE, above every branch. The screen has
 * four (pending / failed / succeeded-empty / succeeded-with-items) and each used
 * to build its own wrapper, i.e. four independent chances to forget the notice —
 * and the branch that forgot would look exactly like a real generation. Routing
 * every branch through one frame turns "remember to disclose" into "you cannot
 * render this screen without disclosing".
 *
 * A component and not a closure inside the page: a function redeclared each
 * render is a NEW type to React, so the subtree would remount every time and the
 * triage board would lose the visitor's work.
 */
export function GenerationReviewFrame({
  header,
  origin,
  children,
}: {
  header: ReactNode
  origin: GenerationOrigin
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-[900px]">
      {header}
      {origin === 'prerecorded' && <PrerecordedNotice className="mb-4" />}
      {children}
    </div>
  )
}
