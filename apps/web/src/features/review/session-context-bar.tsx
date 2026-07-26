import { FSRS_STATE_LABEL_KEYS, glyphClass } from '@/components/fsrs-state-glyph'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { REMAINING_KEY_BY_STATE, REMAINING_STATES, type RemainingByState } from './queue-stats'

/**
 * The strip between the card and the ratings: 24px of session instrumentation
 * that never touches the reading surface. It holds what is still ahead — the
 * four FSRS counters, right-aligned — and reserves its left half for the
 * per-card actions that land in the next steps of the plan.
 */
export function SessionContextBar({ remaining }: { remaining: RemainingByState }) {
  const t = useT()
  return (
    <div className="flex h-6 shrink-0 items-center justify-between text-2xs">
      {/* Left slot: kept empty on purpose so `justify-between` anchors the
          counters to the right edge of the column. */}
      <div />
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
