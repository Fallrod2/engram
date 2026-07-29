import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { TKey } from '@/lib/i18n'
import { Kbd } from '@/components/ui/kbd'
import { useTouchSession } from './pointer-labels'
import { RATING_BY_GRADE, type RatingMeta } from './labels'
import type { Grade } from './session-reducer'

/**
 * One button of the rating zone — the ONE shape every branch of the bar renders
 * (spec §4.3, T-047).
 *
 * It says three things, in this order and always all three:
 *
 *   · what the user is claiming — "J'ai eu juste", "Suivant";
 *   · what will be WRITTEN for that claim — the FSRS grade, named;
 *   · when the card comes back if it is.
 *
 * The second line is the whole point of the component and the reason it exists
 * once instead of twice. It arrived with the QCM "Suivant", where the app grades
 * on the user's behalf and therefore owes them the grade in full; T-047 made the
 * plain card work the same way (two verdicts instead of four self-assessments),
 * and the same debt came with it. A button that deduces a grade and does not
 * print it is the failure mode this file is built to prevent.
 *
 * Border is neutral at rest; hover/focus borrows the grade's token color + its
 * `-subtle` fill, and a press flashes it. Never a full colored fill at rest
 * (design: color reserved). Focus is the global indigo double-ring.
 *
 * T-029 — no keyboard chip on a coarse pointer. `shortcut` is an ADVERTISEMENT,
 * not a binding: the keys live in the session's global router either way, so a
 * tablet with a keyboard case loses the chip and keeps the shortcut. The two
 * verdict buttons pass no `shortcut` at all on any pointer — `1`-`4` stay live
 * and stay unlabelled, which is the arbitration behind T-047.
 *
 * Geometry is fixed and identical in every configuration: `h-16`, a first row of
 * `max(Kbd 16px, label 20px) = 20px` with or without the chip, a second row of
 * one 2xs mono line. Whatever the bar renders, the anchored control stack (T-023)
 * measures the same.
 */

interface TokenClasses {
  hover: string
  flash: string
}

// Literal class names (no interpolation) so Tailwind v4 keeps them.
const TOKENS: Record<RatingMeta['token'], TokenClasses> = {
  danger: {
    hover: 'hover:border-danger hover:bg-danger-subtle',
    flash: 'border-danger bg-danger-subtle',
  },
  warning: {
    hover: 'hover:border-warning hover:bg-warning-subtle',
    flash: 'border-warning bg-warning-subtle',
  },
  success: {
    hover: 'hover:border-success hover:bg-success-subtle',
    flash: 'border-success bg-success-subtle',
  },
  info: {
    hover: 'hover:border-info hover:bg-info-subtle',
    flash: 'border-info bg-info-subtle',
  },
}

/** Projected-interval text color per rating token. Literal names, same reason. */
const INTERVAL_TOKEN: Record<RatingMeta['token'], string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
  info: 'text-info',
}

export function GradeButton({
  grade,
  label,
  shortcut,
  keys,
  interval,
  disabled,
  flash,
  className,
  onRate,
}: {
  /** The FSRS grade this button records — it is named on the button itself. */
  grade: Grade
  /** i18n key of the sentence on the button ("J'ai eu juste", "Suivant"). */
  label: TKey
  /** i18n key of a keyboard chip to advertise, on a fine pointer only. */
  shortcut?: TKey
  /**
   * `aria-keyshortcuts` value — the key that really fires THIS button. Defaults
   * to the grade's own digit, which is what a verdict answers to; the QCM
   * `Suivant` overrides it with `Enter`, the key its chip shows.
   */
  keys?: string
  /** Formatted interval, or undefined while the preview is pending → `·`. */
  interval: string | undefined
  disabled: boolean
  flash: boolean
  className?: string
  onRate: () => void
}) {
  const t = useT()
  const touch = useTouchSession()
  const meta = RATING_BY_GRADE[grade]
  const tokenCls = TOKENS[meta.token]
  const claim = t(label)
  const gradeLabel = t(meta.label)
  // The accessible name carries the same three facts as the visible button, in
  // the same order — and never the shortcut, which `aria-keyshortcuts` states
  // properly and which a phone does not have (WCAG 2.5.3, T-029).
  const name = interval
    ? t('session.gradeAriaNext', { label: claim, grade: gradeLabel, interval })
    : t('session.gradeAriaRate', { label: claim, grade: gradeLabel })
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onRate}
      aria-label={name}
      aria-keyshortcuts={keys ?? String(grade)}
      className={cn(
        'flex h-16 flex-col items-center justify-center gap-1 rounded-md border bg-surface-2',
        'transition-colors duration-fast ease-out disabled:pointer-events-none',
        flash ? tokenCls.flash : 'border-border',
        !flash && tokenCls.hover,
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-text">{claim}</span>
        {shortcut && !touch && <Kbd aria-hidden>{t(shortcut)}</Kbd>}
      </span>
      {/* What gets written, spelled out. `aria-hidden`: the accessible name above
          already says it, and letting the screen reader read the row too would
          announce the grade twice. */}
      <span
        aria-hidden
        className="flex items-center gap-1.5 font-mono text-2xs tabular-nums text-text-faint"
      >
        <span>{gradeLabel}</span>
        <span>—</span>
        <span className={cn(interval && INTERVAL_TOKEN[meta.token])}>{interval ?? '·'}</span>
      </span>
    </button>
  )
}
