import { STUDY_PACE_MAX } from '@engram/shared'

/**
 * The arithmetic behind the pacing control, kept pure and out of the component
 * so the claim the screen makes to the user can be asserted directly.
 */

/**
 * How many reviews ONE new card costs over its first week.
 *
 * This is the number the whole setting exists for, and the reason "20 new cards"
 * does not mean "20 reviews": a card introduced today comes back through its
 * learning steps and its first two intervals, so it is answered three to five
 * times before it settles. Someone who imports a 300-card course and asks for
 * "all of it, now" is not asking for 300 reviews, they are asking for ~1200
 * spread over the following days — which is exactly how a spaced-repetition
 * habit dies on day three.
 *
 * The range is stated rather than averaged because it IS a range: an easy card
 * graded `Good` every time takes the low end, one that lapses takes the high
 * end. Showing a single number would be a false precision the scheduler cannot
 * back.
 */
export const REVIEWS_PER_NEW_CARD_MIN = 3
export const REVIEWS_PER_NEW_CARD_MAX = 5

/**
 * The steady-state daily load implied by a new-card limit: what the following
 * days will actually ask of the user once the pipeline is full.
 */
export function projectedDailyReviews(newCardsPerDay: number): { min: number; max: number } {
  const n = Math.max(0, Math.trunc(newCardsPerDay))
  return { min: n * REVIEWS_PER_NEW_CARD_MIN, max: n * REVIEWS_PER_NEW_CARD_MAX }
}

/**
 * Read a number field back into a value the API will accept, or `null` when
 * there is nothing to commit.
 *
 * `null` — and not "fall back to the default" — for an empty or unparsable
 * field: a half-typed value must leave the stored setting alone. Silently
 * writing 20 because the user selected-all and had not typed the replacement yet
 * is the classic way a settings screen loses somebody's choice.
 *
 * Out-of-range values are CLAMPED rather than rejected: the bounds come from the
 * shared schema, the field already carries them as `min`/`max`, and a browser
 * that lets a paste through should get the nearest legal value instead of a
 * silent no-op.
 */
export function parsePaceInput(raw: string, opts: { min: number }): number | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  return Math.min(STUDY_PACE_MAX, Math.max(opts.min, Math.trunc(n)))
}

/**
 * The quick picks offered next to the new-card field. `0` is on the list because
 * pausing new cards is a legitimate, reversible decision (an exam week where only
 * the due backlog matters), and it is invisible unless it is offered.
 */
export const NEW_CARDS_PRESETS = [0, 10, 20, 40] as const
/** Quick picks for the daily goal. No `0`: a goal of zero is not a goal. */
export const DAILY_GOAL_PRESETS = [10, 30, 60, 100] as const
