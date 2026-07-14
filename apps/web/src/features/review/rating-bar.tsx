import { motion } from 'motion/react'
import type { ReviewPreview } from '@engram/shared'
import { useT } from '@/lib/i18n'
import { Kbd } from '@/components/ui/kbd'
import { Button } from '@/components/ui/button'
import { useCoarsePointer } from '@/lib/use-media-query'
import type { Grade } from './session-reducer'
import { PREVIEW_KEY, RATINGS } from './labels'
import { formatInterval } from './interval-format'
import { RatingButton } from './rating-button'

/**
 * The rating zone (spec §4.2). ASKING: a calm `Espace pour révéler` hint on a
 * keyboard, or a full-width ≥48px tap target on a touch device (fix-session §1 —
 * the only way to reveal at the finger). REVEALED/SUBMITTING: the 4 rating
 * buttons with their projected intervals, faded in short (§7.2). The interval is
 * a bonus — a pending preview renders a `·` placeholder and the rating stays
 * fully functional (§3.4).
 */
export function RatingBar({
  revealed,
  preview,
  disabled,
  flashGrade,
  reduce,
  onReveal,
  onRate,
}: {
  revealed: boolean
  preview: ReviewPreview | undefined
  disabled: boolean
  flashGrade: Grade | null
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

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {RATINGS.map((meta) => {
        const grade = preview?.[PREVIEW_KEY[meta.grade]]
        const interval = grade
          ? formatInterval(grade.due, preview.now, grade.scheduledDays)
          : undefined
        return (
          <RatingButton
            key={meta.grade}
            meta={meta}
            interval={interval}
            disabled={disabled}
            flash={flashGrade === meta.grade}
            onRate={() => onRate(meta.grade)}
          />
        )
      })}
    </motion.div>
  )
}
