import type { Grade } from './session-reducer'

/**
 * FR rating labels + token color per grade (spec §3.4, design §2). The four
 * FSRS tokens are reserved for ratings and used nowhere else: Again→danger,
 * Hard→warning, Good→success, Easy→info. The accent indigo is never a rating.
 */
export interface RatingMeta {
  grade: Grade
  /** Short FR label shown on the button. */
  label: string
  /** Longer a11y phrasing for the button's aria-label. */
  a11y: string
  /** Semantic token base name (`danger` | `warning` | `success` | `info`). */
  token: 'danger' | 'warning' | 'success' | 'info'
}

export const RATINGS: readonly [RatingMeta, RatingMeta, RatingMeta, RatingMeta] = [
  { grade: 1, label: 'Encore', a11y: 'Encore', token: 'danger' },
  { grade: 2, label: 'Difficile', a11y: 'Difficile', token: 'warning' },
  { grade: 3, label: 'Bien', a11y: 'Bien', token: 'success' },
  { grade: 4, label: 'Facile', a11y: 'Facile', token: 'info' },
]

/** Preview response field (again/hard/good/easy) for a grade. */
export const PREVIEW_KEY: Record<Grade, 'again' | 'hard' | 'good' | 'easy'> = {
  1: 'again',
  2: 'hard',
  3: 'good',
  4: 'easy',
}
