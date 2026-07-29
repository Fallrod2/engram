import { describe, expect, it } from 'vitest'
import { STUDY_NEW_CARDS_PER_DAY_DEFAULT, STUDY_PACE_MAX } from '@engram/shared'
import {
  DAILY_GOAL_PRESETS,
  NEW_CARDS_PRESETS,
  parsePaceInput,
  projectedDailyReviews,
} from './pace'

describe('projectedDailyReviews', () => {
  it('turns the default limit into the load it actually implies', () => {
    // The whole point of the copy: 20 new cards a day is NOT 20 reviews a day.
    expect(projectedDailyReviews(STUDY_NEW_CARDS_PER_DAY_DEFAULT)).toEqual({ min: 60, max: 100 })
  })

  it('is zero for a paused limit — the only honest projection', () => {
    expect(projectedDailyReviews(0)).toEqual({ min: 0, max: 0 })
  })

  it('never projects a negative or fractional load', () => {
    expect(projectedDailyReviews(-5)).toEqual({ min: 0, max: 0 })
    expect(projectedDailyReviews(2.7)).toEqual({ min: 6, max: 10 })
  })
})

describe('parsePaceInput', () => {
  it('returns null for anything that is not a number to commit', () => {
    // A half-typed field must leave the STORED value alone — never fall back to
    // a default, which is how a settings screen silently loses a choice.
    for (const raw of ['', '   ', 'abc', '-', 'NaN', 'Infinity']) {
      expect(parsePaceInput(raw, { min: 0 }), raw).toBeNull()
    }
  })

  it('accepts a plain integer, spaces included', () => {
    expect(parsePaceInput(' 42 ', { min: 0 })).toBe(42)
  })

  it('truncates rather than rounds — the field is an integer count', () => {
    expect(parsePaceInput('7.9', { min: 0 })).toBe(7)
  })

  it('clamps to the shared schema bounds instead of no-op’ing', () => {
    expect(parsePaceInput('-3', { min: 0 })).toBe(0)
    expect(parsePaceInput('-3', { min: 1 })).toBe(1)
    expect(parsePaceInput(String(STUDY_PACE_MAX + 500), { min: 0 })).toBe(STUDY_PACE_MAX)
  })

  it('honours the per-field minimum (0 pauses new cards, a goal cannot be 0)', () => {
    expect(parsePaceInput('0', { min: 0 })).toBe(0)
    expect(parsePaceInput('0', { min: 1 })).toBe(1)
  })
})

describe('the offered presets', () => {
  it('every preset is a value the API accepts', () => {
    for (const n of NEW_CARDS_PRESETS) {
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(STUDY_PACE_MAX)
    }
    for (const n of DAILY_GOAL_PRESETS) {
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(STUDY_PACE_MAX)
    }
  })

  it('offers the pause explicitly, and the coded default', () => {
    expect(NEW_CARDS_PRESETS).toContain(0)
    expect(NEW_CARDS_PRESETS).toContain(STUDY_NEW_CARDS_PER_DAY_DEFAULT)
  })
})
