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
/**
 * The height the rating zone occupies, whatever it currently renders — the
 * single anchor the whole session screen is hung from (T-023).
 *
 * It is the height of the four-button grid, and it is NOT one number: the grid
 * is `grid-cols-2 sm:grid-cols-4`, so under 640px it is two 64px rows plus the
 * 8px gap (2×64 + 8 = 136), and from 640px up a single 64px row. The `h-16`
 * that used to stand alone here was measured against the wide case only, which
 * is why a 390px viewport still slid the context strip 72px on every reveal
 * after the desktop drift was fixed.
 *
 * Every branch that REPLACES the grid — the reveal hint, the touch reveal
 * button, the QCM "Suivant" — is laid out inside this box. The grid itself is
 * left to define the truth rather than being forced into it, so a change to the
 * button height shows up as an overflow in review instead of being silently
 * clipped by a stale constant.
 */
const RATING_ZONE = 'flex h-[136px] items-center justify-center sm:h-16'

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
    // T-023 — the ASKING branch reserves the box the four rating buttons will
    // occupy. It used to be an 18.6px line of text, so revealing grew the block
    // by 45.4px and shoved the context strip (Éditer / Passer / Annuler, and
    // the remaining-by-state counters) up by that much on every single card.
    // The hint and the buttons now share one box, which is the last thing this
    // screen needed for its geometry to stop depending on its state: the
    // buttons appear exactly where the hint was, so `1`-`4` land where the eye
    // (and the hand) already were.
    return (
      <div className={RATING_ZONE}>
        {coarse ? (
          // Touch: a real ≥48px tap target — the keyboard hint is meaningless
          // and inoperative without a keyboard (fix-session §1 & §3).
          <Button
            type="button"
            size="lg"
            variant="secondary"
            className="h-12 w-full text-sm"
            onClick={onReveal}
          >
            {t('session.revealButton')}
          </Button>
        ) : (
          <p className="flex items-center justify-center gap-2 font-mono text-sm text-text-faint">
            <Kbd>{t('session.keySpace')}</Kbd>
            <span>{t('session.revealHint')}</span>
          </p>
        )}
      </div>
    )
  }

  if (suggestedGrade !== null) {
    const meta = RATING_BY_GRADE[suggestedGrade]
    const interval = projectedInterval(preview, suggestedGrade)
    return (
      <motion.div
        className={RATING_ZONE}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* One row tall inside the reserved zone: the block below the card never
            grows nor shrinks, whichever branch renders (T-023). */}
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
