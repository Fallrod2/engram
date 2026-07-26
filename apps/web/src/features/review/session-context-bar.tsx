import { SkipForward } from 'lucide-react'
import { FSRS_STATE_LABEL_KEYS, glyphClass } from '@/components/fsrs-state-glyph'
import { Kbd } from '@/components/ui/kbd'
import { useT } from '@/lib/i18n'
import { useCoarsePointer } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { REMAINING_KEY_BY_STATE, REMAINING_STATES, type RemainingByState } from './queue-stats'

/**
 * The strip between the card and the ratings: 24px of session instrumentation
 * that never touches the reading surface. It holds what is still ahead — the
 * four FSRS counters, right-aligned — and the per-card actions on the left.
 */
export function SessionContextBar({
  remaining,
  onSkip,
}: {
  remaining: RemainingByState
  onSkip: () => void
}) {
  const t = useT()
  // No keyboard on touch → drop the `S` chip (fix-session §3).
  const coarse = useCoarsePointer()
  return (
    <div className="flex h-6 shrink-0 items-center justify-between text-2xs">
      {/* Left slot: the per-card actions. A flex row, so the steps that follow
          can drop their own buttons next to this one. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSkip}
          // The label collapses under 640px (the bar must hold at 320px), so the
          // aria-label always carries the full meaning, shortcut included.
          aria-label={t('session.skipAria')}
          // Focus is the global double-ring indigo (styles.css :focus-visible).
          className="flex items-center gap-1.5 text-text-faint transition-colors hover:text-text-muted"
        >
          <SkipForward aria-hidden className="size-3" />
          <span className="hidden sm:inline">{t('session.skip')}</span>
          {!coarse && <Kbd>S</Kbd>}
        </button>
      </div>
      <div
        role="group"
        aria-label={t('session.remainingAria')}
        className="flex items-center gap-3 font-mono tabular-nums"
      >
        {REMAINING_STATES.map((state) => {
          const value = remaining[REMAINING_KEY_BY_STATE[state]]
          return (
            <span key={state} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn('inline-block size-2 shrink-0 rounded-xs', glyphClass(state))}
              />
              {/* The square carries no text, so the state name is spoken from
                  here: the group reads "Nouvelle 3, Apprentissage 1, …". */}
              <span className="sr-only">{t(FSRS_STATE_LABEL_KEYS[state])}</span>
              <span className={value === 0 ? 'text-text-faint' : 'text-text-muted'}>{value}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
