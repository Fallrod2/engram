import { describe, expect, it } from 'vitest'
import { RATING_BY_GRADE } from './labels'
import { GRADE_BY_VERDICT, VERDICTS, gradeForVerdict } from './verdict'

/**
 * T-047 — the binary verdict is the QCM's mapping, reused.
 *
 * What matters here is not that the numbers are 1 and 3 in the abstract, but that
 * the plain card and the answered QCM record the SAME grade for the same
 * evidence. `use-review-session.ts` derives the QCM suggestion through
 * `gradeForVerdict`, so proving the function proves both paths at once — there is
 * no second table left to drift.
 */
describe('gradeForVerdict', () => {
  it('records Encore (1) for a wrong answer and Bien (3) for a right one', () => {
    expect(gradeForVerdict(false)).toBe(1)
    expect(gradeForVerdict(true)).toBe(3)
  })

  it('is the table itself, not a second reading of it', () => {
    expect(gradeForVerdict(false)).toBe(GRADE_BY_VERDICT.wrong)
    expect(gradeForVerdict(true)).toBe(GRADE_BY_VERDICT.right)
  })

  it('never records a correction the user did not make', () => {
    // Difficile (2) and Facile (4) are requests to slow down or speed up. A
    // yes/no answer carries no evidence for either, so neither may be the grade
    // a verdict writes — they stay reachable only through the `1`-`4` keys.
    for (const right of [true, false]) {
      expect([2, 4]).not.toContain(gradeForVerdict(right))
    }
  })
})

describe('VERDICTS', () => {
  it('lays the wrong answer out on the left and the right one on the right', () => {
    expect(VERDICTS.map((v) => v.verdict)).toEqual(['wrong', 'right'])
  })

  it('keeps the bar reading bad → good, like the four grades it replaces', () => {
    // The `1`-`4` keys stay live and unlabelled: the spatial order on screen must
    // not contradict the numeric order under the fingers.
    const grades = VERDICTS.map((v) => v.grade)
    expect(grades[0]).toBeLessThan(grades[1]!)
  })

  it('carries a grade that the rating table knows how to name and color', () => {
    for (const v of VERDICTS) {
      expect(RATING_BY_GRADE[v.grade].grade).toBe(v.grade)
      expect(RATING_BY_GRADE[v.grade].token).toBeTruthy()
    }
  })
})
