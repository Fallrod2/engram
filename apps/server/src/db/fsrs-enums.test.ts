import { describe, expect, it } from 'vitest'
import { Rating, State } from 'ts-fsrs'
import {
  fsrsRatingSchema,
  fsrsStateSchema,
  fsrsGradeSchema,
  fsrsStateNameSchema,
  FSRS_STATE_BY_NAME,
} from '@engram/shared'

/**
 * Guard the Zod FSRS literals against the real ts-fsrs enum values. If a
 * ts-fsrs upgrade renumbers an enum, this test breaks before anything ships.
 */
describe('FSRS enum conformity (ts-fsrs 5.4.1)', () => {
  it('State literals match ts-fsrs', () => {
    expect(State.New).toBe(0)
    expect(State.Learning).toBe(1)
    expect(State.Review).toBe(2)
    expect(State.Relearning).toBe(3)
    for (const v of [0, 1, 2, 3]) {
      expect(fsrsStateSchema.safeParse(v).success).toBe(true)
    }
    expect(fsrsStateSchema.safeParse(4).success).toBe(false)
  })

  it('Rating literals match ts-fsrs', () => {
    expect(Rating.Manual).toBe(0)
    expect(Rating.Again).toBe(1)
    expect(Rating.Hard).toBe(2)
    expect(Rating.Good).toBe(3)
    expect(Rating.Easy).toBe(4)
    for (const v of [0, 1, 2, 3, 4]) {
      expect(fsrsRatingSchema.safeParse(v).success).toBe(true)
    }
    expect(fsrsRatingSchema.safeParse(5).success).toBe(false)
  })

  it('Grade schema accepts session ratings 1..4 only', () => {
    for (const v of [1, 2, 3, 4]) {
      expect(fsrsGradeSchema.safeParse(v).success).toBe(true)
    }
    expect(fsrsGradeSchema.safeParse(0).success).toBe(false)
  })

  /**
   * `?state=review` in the search API resolves through `FSRS_STATE_BY_NAME`.
   * If ts-fsrs ever renumbers `State`, this breaks here rather than silently
   * filtering the wrong bucket in production.
   */
  it('state NAMES map to the ts-fsrs State integers', () => {
    expect(FSRS_STATE_BY_NAME.new).toBe(State.New)
    expect(FSRS_STATE_BY_NAME.learning).toBe(State.Learning)
    expect(FSRS_STATE_BY_NAME.review).toBe(State.Review)
    expect(FSRS_STATE_BY_NAME.relearning).toBe(State.Relearning)
  })

  it('every state name has a mapping, and no extra one', () => {
    const names = fsrsStateNameSchema.options
    expect(Object.keys(FSRS_STATE_BY_NAME).sort()).toEqual([...names].sort())
    // The four integers are exactly the four the DB CHECK constraint allows.
    expect(Object.values(FSRS_STATE_BY_NAME).sort()).toEqual([0, 1, 2, 3])
  })
})
