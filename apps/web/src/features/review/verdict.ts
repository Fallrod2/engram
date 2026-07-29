import type { TKey } from '@/lib/i18n'
import type { Grade } from './session-reducer'

/**
 * T-047 — "j'ai eu juste / j'ai eu faux", and the ONE table that turns it into an
 * FSRS grade.
 *
 * The QCM layer already answered this question: a card the user got wrong is a
 * lapse (1, Encore), a card they got right is an ordinary success (3, Bien).
 * That reading used to live inline in `use-review-session.ts`, as the ternary
 * behind `suggestedGrade`. It is lifted here unchanged — same two grades, same
 * direction — because a second consumer now asks the very same question about a
 * plain card, and two copies of a mapping are two mappings.
 *
 * Why 1 and 3 and not, say, 1 and 4. `Bien` is FSRS's neutral success: it moves
 * stability along the curve the scheduler was fitted on. `Facile` is a REQUEST to
 * accelerate and `Difficile` a request to slow down — they are corrections, and a
 * binary verdict carries no evidence for either. Recording one of them by default
 * would be inventing a signal the user did not give, which is exactly what the
 * hidden `1`-`4` keys are there for when the user does want to give it.
 */
export type Verdict = 'wrong' | 'right'

export const GRADE_BY_VERDICT = {
  wrong: 1,
  right: 3,
} as const satisfies Record<Verdict, Grade>

/** The grade a right/wrong verdict records. The single source, for both callers. */
export function gradeForVerdict(right: boolean): Grade {
  return right ? GRADE_BY_VERDICT.right : GRADE_BY_VERDICT.wrong
}

export interface VerdictMeta {
  verdict: Verdict
  grade: Grade
  /** i18n key of the sentence ON the button ("J'ai eu faux"). */
  label: TKey
}

/**
 * The two buttons, in the order they are laid out — wrong on the LEFT.
 *
 * Three reasons, none of them "it looks better":
 *
 *  1. `1` `2` `3` `4` are still live and still unlabelled. Wrong-left keeps the
 *     screen's left→right axis running bad→good exactly as the four-button grid
 *     did, so the half of the bar under the left hand is still the half the low
 *     grades live on. Flipping it would leave a keyboard user with a spatial
 *     mapping that contradicts the keys they are pressing.
 *  2. The frequent gesture belongs on the right. On a settled deck most answers
 *     are right, and on a phone the right half of the bar is the one a thumb
 *     reaches without crossing the screen.
 *  3. The two mistakes do not cost the same. A stray "juste" pushes a card the
 *     user has NOT recalled out by days, and the error is invisible until it
 *     comes back wrong; a stray "faux" costs one extra sighting of a card they
 *     knew, and `Annuler` is one key away. The costly button is therefore the one
 *     that must not sit where a hand rests by default — and on a left-to-right
 *     reading, the eye and the pointer land first on the left.
 *
 * Read by the bar to render, and by nothing else: no consumer may depend on the
 * POSITION of an entry, only on its `verdict`.
 */
export const VERDICTS: readonly [VerdictMeta, VerdictMeta] = [
  { verdict: 'wrong', grade: GRADE_BY_VERDICT.wrong, label: 'session.verdictWrong' },
  { verdict: 'right', grade: GRADE_BY_VERDICT.right, label: 'session.verdictRight' },
]
