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

export const RATINGS: readonly [RatingMeta, RatingMeta, RatingMeta, RatingMeta] = [
  { grade: 1, label: 'session.ratings.again', a11y: 'session.ratings.again', token: 'danger' },
  { grade: 2, label: 'session.ratings.hard', a11y: 'session.ratings.hard', token: 'warning' },
  { grade: 3, label: 'session.ratings.good', a11y: 'session.ratings.good', token: 'success' },
  { grade: 4, label: 'session.ratings.easy', a11y: 'session.ratings.easy', token: 'info' },
]

/** Preview response field (again/hard/good/easy) for a grade. */
export const PREVIEW_KEY: Record<Grade, 'again' | 'hard' | 'good' | 'easy'> = {
  1: 'again',
  2: 'hard',
  3: 'good',
  4: 'easy',
}
