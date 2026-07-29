import { motion } from 'motion/react'
import type { ReviewPreview } from '@engram/shared'
import { useT } from '@/lib/i18n'
import { Kbd } from '@/components/ui/kbd'
import { Button } from '@/components/ui/button'
import { useTouchSession } from './pointer-labels'
import type { Grade } from './session-reducer'
import { PREVIEW_KEY } from './labels'
import { VERDICTS } from './verdict'
import { formatInterval } from './interval-format'
import { GradeButton } from './rating-button'

/**
 * The rating zone (spec §4.2). Three branches, one box.
 *
 * ASKING — a calm `Espace pour révéler` hint on a keyboard, or a full-width ≥48px
 * tap target on a touch device (fix-session §1 — the only way to reveal at the
 * finger).
 *
 * REVEALED, with objective evidence (`suggestedGrade`: a QCM the user actually
 * answered) — the result already argues a grade, so asking for a difficulty on
 * top of it is asking twice. One full-width `Suivant` records exactly that grade.
 *
 * REVEALED, without evidence — the two verdicts, `J'ai eu faux` / `J'ai eu juste`
 * (T-047). Alex's complaint, after using the app for real: grading your own
 * recall on a four-step scale is a judgement nobody wants to make twenty times in
 * a row. So the plain card now asks the question the QCM asks itself — did you
 * get it? — and `verdict.ts` turns the answer into the same two grades the QCM
 * deduces. The four levels are NOT gone: `1`-`4` stay live in the session's key
 * router and stay unadvertised here, so `Difficile` and `Facile` (the signals
 * that tell FSRS to slow down or speed up) remain one keystroke away for whoever
 * wants them, and cost nothing to whoever does not.
 *
 * Every branch prints the grade it will record and its projected interval —
 * nothing is written in the user's name without being shown (see `GradeButton`).
 * A pending preview renders a `·` placeholder and the button stays fully
 * functional (§3.4).
 */
/**
 * The height the rating zone occupies, whatever it currently renders — the
 * single anchor the whole session screen is hung from (T-023).
 *
 * It is NOT one number: under 640px it is 136px (what the original four-button
 * grid measured there — two 64px rows plus the 8px gap) and from 640px up a
 * single 64px row. The `h-16` that used to stand alone here was measured against
 * the wide case only, which is why a 390px viewport still slid the context strip
 * 72px on every reveal after the desktop drift was fixed.
 *
 * T-047 replaced the four-button grid with two buttons, and deliberately did NOT
 * touch these two numbers. The grid used to define the reservation by simply
 * being the tallest branch; now the constant stands on its own, and that is the
 * point — the reservation is a promise about the SCREEN (the question at a
 * constant y, the rating bar at a constant position, on both pointer types and at
 * both breakpoints), not a side effect of whichever control happens to be inside
 * it. Shrinking it to `h-16` everywhere would move the entire phone layout for
 * the sake of a control that is not the reason the box exists.
 *
 * Every branch is laid out INSIDE this box, and the narrow case is spent rather
 * than left empty: the two verdicts fill the 136px (`VERDICT_BOX`), which is the
 * same ink the four-button grid put there and a thumb target that cannot be
 * missed. Exported because the LOADING skeleton mirrors it — the lesson of
 * `CONTEXT_INFO_ROW`: a number retyped by hand is a number that drifts.
 */
export const RATING_ZONE = 'flex h-[136px] items-center justify-center sm:h-16'

/**
 * The verdict pair fills the reserved box on a narrow screen and is one 64px row
 * from 640px up. Same total ink as the grid it replaces, no dead band under the
 * card on a phone, and a target a thumb finds without aiming.
 *
 * Exported for the LOADING skeleton, which mirrors this branch: the two
 * placeholders must be the two buttons that replace them, or the swap jumps.
 */
export const VERDICT_BOX = 'h-full sm:h-16'

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
  /** Grade deduced from the QCM result; null = none, and the verdicts show. */
  suggestedGrade?: Grade | null
  reduce: boolean
  onReveal: () => void
  onRate: (grade: Grade) => void
}) {
  const t = useT()
  const touch = useTouchSession()

  if (!revealed) {
    // T-023 — the ASKING branch reserves the box the rating buttons will occupy.
    // It used to be an 18.6px line of text, so revealing grew the block by
    // 45.4px and shoved the context strip (Éditer / Passer / Annuler, and the
    // remaining-by-state counters) up by that much on every single card. The
    // hint and the buttons now share one box, which is the last thing this
    // screen needed for its geometry to stop depending on its state: the buttons
    // appear exactly where the hint was, so the hand is already there.
    return (
      <div className={RATING_ZONE}>
        {touch ? (
          // Touch: a real ≥48px tap target — the keyboard hint is meaningless
          // and inoperative without a keyboard (fix-session §1 & §3). It sits
          // INSIDE the same reserved box as the rating buttons, so the question
          // above it does not move when the answer appears (T-023).
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
    return (
      <motion.div
        className={RATING_ZONE}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* One row tall inside the reserved zone: the block below the card never
            grows nor shrinks, whichever branch renders (T-023). */}
        <GradeButton
          grade={suggestedGrade}
          label="session.next"
          shortcut="session.keyEnter"
          keys="Enter"
          interval={projectedInterval(preview, suggestedGrade)}
          disabled={disabled}
          flash={flashGrade === suggestedGrade}
          className="w-full"
          onRate={() => onRate(suggestedGrade)}
        />
      </motion.div>
    )
  }

  return (
    <motion.div
      className={RATING_ZONE}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="grid h-full w-full grid-cols-2 gap-2">
        {VERDICTS.map((meta) => (
          <GradeButton
            key={meta.verdict}
            grade={meta.grade}
            label={meta.label}
            // No chip, on any pointer: the arbitration behind T-047 is that the
            // gesture is binary and the four levels stay available WITHOUT being
            // advertised on it. `aria-keyshortcuts` still declares the key
            // (GradeButton), and the footer cheat-sheet still states `1-4`.
            interval={projectedInterval(preview, meta.grade)}
            disabled={disabled}
            // Only the grade actually pressed lights up. A hidden `2` or `4`
            // corrects in silence, exactly as it already does over the QCM
            // suggestion — an acknowledgement on a button that says something
            // else would be worse than none.
            flash={flashGrade === meta.grade}
            className={VERDICT_BOX}
            onRate={() => onRate(meta.grade)}
          />
        ))}
      </div>
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
