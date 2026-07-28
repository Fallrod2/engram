import type { ReviewPreview } from '@engram/shared'
import type { TKey } from '@/lib/i18n'
import type { Grade } from './session-reducer'

/**
 * Rating labels (i18n keys) + token color per grade (spec §3.4, design §2). The
 * four FSRS tokens are reserved for ratings and used nowhere else: Again→danger,
 * Hard→warning, Good→success, Easy→info. The accent indigo is never a rating.
 */
export interface RatingMeta {
  grade: Grade
  /** i18n key for the short label shown on the button (resolved with `t(...)`). */
  label: TKey
  /** i18n key for the a11y phrasing (name) of the button. */
  a11y: TKey
  /** Semantic token base name (`danger` | `warning` | `success` | `info`). */
  token: 'danger' | 'warning' | 'success' | 'info'
}

/**
 * The table keyed by grade IS the source (T-019): every entry is reached by its
 * key, never by a position. `RatingMeta & { grade: G }` pins each `grade` field
 * to the key it sits under, so a copy/paste that leaves `grade: 2` under `3`
 * fails to compile instead of shipping a button that rates the wrong thing.
 */
export const RATING_BY_GRADE: { [G in Grade]: RatingMeta & { grade: G } } = {
  1: { grade: 1, label: 'session.ratings.again', a11y: 'session.ratings.again', token: 'danger' },
  2: { grade: 2, label: 'session.ratings.hard', a11y: 'session.ratings.hard', token: 'warning' },
  3: { grade: 3, label: 'session.ratings.good', a11y: 'session.ratings.good', token: 'success' },
  4: { grade: 4, label: 'session.ratings.easy', a11y: 'session.ratings.easy', token: 'info' },
}

/**
 * The four ratings in bar order (Again → Easy), for anything that iterates:
 * rating bar, summary distribution, analytics legend. Built by explicit key, so
 * the order is stated once, here, and nothing else depends on a position.
 */
export const RATINGS: readonly [RatingMeta, RatingMeta, RatingMeta, RatingMeta] = [
  RATING_BY_GRADE[1],
  RATING_BY_GRADE[2],
  RATING_BY_GRADE[3],
  RATING_BY_GRADE[4],
]

/**
 * Preview response field for a grade. The value type is derived from the shared
 * Zod schema (`ReviewPreview` minus its `now`), so renaming a field server-side
 * breaks this map at compile time rather than silently returning `undefined`.
 */
export const PREVIEW_KEY: Record<Grade, Exclude<keyof ReviewPreview, 'now'>> = {
  1: 'again',
  2: 'hard',
  3: 'good',
  4: 'easy',
}
