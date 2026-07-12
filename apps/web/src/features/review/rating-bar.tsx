import { motion } from 'motion/react'
import type { ReviewPreview } from '@engram/shared'
import { Kbd } from '@/components/ui/kbd'
import type { Grade } from './session-reducer'
import { PREVIEW_KEY, RATINGS } from './labels'
import { formatInterval } from './interval-format'
import { RatingButton } from './rating-button'

/**
 * The rating zone (spec §4.2). ASKING: a calm `Espace pour révéler` hint.
 * REVEALED/SUBMITTING: the 4 rating buttons with their projected intervals,
 * faded in short (§7.2). The interval is a bonus — a pending preview renders a
 * `·` placeholder and the rating stays fully functional (§3.4).
 */
export function RatingBar({
  revealed,
  preview,
  disabled,
  flashGrade,
  reduce,
  onRate,
}: {
  revealed: boolean
  preview: ReviewPreview | undefined
  disabled: boolean
  flashGrade: Grade | null
  reduce: boolean
  onRate: (grade: Grade) => void
}) {
  if (!revealed) {
    return (
      <p className="flex items-center justify-center gap-2 font-mono text-sm text-text-faint">
        <Kbd>Espace</Kbd>
        <span>pour révéler</span>
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
