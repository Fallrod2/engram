import { motion } from 'motion/react'
import type { ReviewPreview } from '@engram/shared'
import { useT } from '@/lib/i18n'
import { Kbd } from '@/components/ui/kbd'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCoarsePointer } from '@/lib/use-media-query'
import type { Grade } from './session-reducer'
import { PREVIEW_KEY, RATING_BY_GRADE, RATINGS } from './labels'
import { formatInterval } from './interval-format'
import { INTERVAL_TOKEN, RatingButton } from './rating-button'

/**
 * The rating zone (spec §4.2). ASKING: a calm `Espace pour révéler` hint on a
 * keyboard, or a full-width ≥48px tap target on a touch device (fix-session §1 —
 * the only way to reveal at the finger). REVEALED/SUBMITTING: the 4 rating
 * buttons with their projected intervals, faded in short (§7.2). The interval is
 * a bonus — a pending preview renders a `·` placeholder and the rating stays
 * fully functional (§3.4).
 *
 * On a QCM the user actually answered, the result already argues a grade
 * (`suggestedGrade`): asking for a difficulty on top of that is asking twice, so
 * the four buttons collapse into a single full-width Next that records exactly
 * that grade. The grade and its projected interval are printed under the label —
 * nothing is written in the user's name without being shown. Keys 1-4 keep
 * overriding it silently; the screen no longer begs for them.
 */
export function RatingBar({
  revealed,
  preview,
  disabled,
  flashGrade,
  suggestedGrade = null,
  reduce,
  onReveal,
  onRate,
}: {
  revealed: boolean
  preview: ReviewPreview | undefined
  disabled: boolean
  flashGrade: Grade | null
  /** Grade deduced from the QCM result; null = none, and the 4 buttons show. */
  suggestedGrade?: Grade | null
  reduce: boolean
  onReveal: () => void
  onRate: (grade: Grade) => void
}) {
  const t = useT()
  const coarse = useCoarsePointer()

  if (!revealed) {
    // Touch: a real ≥48px tap target — the keyboard hint is meaningless and
    // inoperative without a keyboard (fix-session §1 & §3).
    if (coarse) {
      return (
        <Button
          type="button"
          size="lg"
          variant="secondary"
          className="h-12 w-full text-sm"
          onClick={onReveal}
        >
          {t('session.revealButton')}
        </Button>
      )
    }
    return (
      <p className="flex items-center justify-center gap-2 font-mono text-sm text-text-faint">
        <Kbd>{t('session.keySpace')}</Kbd>
        <span>{t('session.revealHint')}</span>
      </p>
    )
  }

  if (suggestedGrade !== null) {
    const meta = RATING_BY_GRADE[suggestedGrade]
    const interval = projectedInterval(preview, suggestedGrade)
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* h-16 = one row of the grid it replaces: the block below the card never
            grows, whichever branch renders. */}
        <Button
          type="button"
          size="lg"
          variant="secondary"
          disabled={disabled}
          aria-keyshortcuts="Enter"
          onClick={() => onRate(suggestedGrade)}
          className="h-16 w-full flex-col gap-1"
        >
          <span className="flex items-center gap-1.5">
            <span>{t('session.next')}</span>
            {!coarse && <Kbd aria-hidden>{t('session.keyEnter')}</Kbd>}
          </span>
          <span className="flex items-center gap-1.5 font-mono text-2xs tabular-nums text-text-faint">
            <span>{t(meta.label)}</span>
            <span aria-hidden>—</span>
            <span className={cn(interval && INTERVAL_TOKEN[meta.token])}>{interval ?? '·'}</span>
          </span>
        </Button>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {RATINGS.map((meta) => (
        <RatingButton
          key={meta.grade}
          meta={meta}
          interval={projectedInterval(preview, meta.grade)}
          disabled={disabled}
          flash={flashGrade === meta.grade}
          onRate={() => onRate(meta.grade)}
        />
      ))}
    </motion.div>
  )
}

/** Formatted projection for a grade, or undefined while the preview is pending. */
function projectedInterval(preview: ReviewPreview | undefined, grade: Grade): string | undefined {
  const projection = preview?.[PREVIEW_KEY[grade]]
  return projection
    ? formatInterval(projection.due, preview.now, projection.scheduledDays)
    : undefined
}
