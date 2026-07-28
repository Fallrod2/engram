import { describe, expect, it } from 'vitest'
import { PREVIEW_KEY, RATING_BY_GRADE, RATINGS } from './labels'

/**
 * T-019: the grade→meta table is the source and `RATINGS` is derived from it by
 * key. The mapped type already makes a mismatched `grade` a compile error; these
 * assertions pin what a type cannot express — that the tuple keeps the bar order
 * Again → Easy, which the rating bar, the summary distribution and the analytics
 * legend all render in.
 */
describe('review labels', () => {
  it('keys every rating under its own grade', () => {
    for (const grade of [1, 2, 3, 4] as const) {
      expect(RATING_BY_GRADE[grade].grade).toBe(grade)
    }
  })

  it('exposes RATINGS in bar order, each entry being the table row of its grade', () => {
    expect(RATINGS.map((r) => r.grade)).toEqual([1, 2, 3, 4])
    for (const meta of RATINGS) expect(meta).toBe(RATING_BY_GRADE[meta.grade])
  })

  it('maps each grade to its preview field', () => {
    expect(PREVIEW_KEY).toEqual({ 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' })
  })

  it('gives each rating its own reserved token', () => {
    expect(RATINGS.map((r) => r.token)).toEqual(['danger', 'warning', 'success', 'info'])
  })
})
