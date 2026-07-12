import { describe, expect, it } from 'vitest'
import { formatDue, formatReps } from './format'

describe('formatDue', () => {
  // Build instants from local components so the day math is timezone-agnostic.
  const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString()
  const now = new Date(2026, 6, 12, 10)

  it('labels today, future and overdue by whole days (never colored)', () => {
    expect(formatDue(iso(2026, 6, 12, 20), now)).toBe('auj.')
    expect(formatDue(iso(2026, 6, 15, 9), now)).toBe('J+3')
    expect(formatDue(iso(2026, 6, 10, 9), now)).toBe('en retard 2j')
  })
})

describe('formatReps', () => {
  it('joins reps and lapses with a middle dot', () => {
    expect(formatReps(12, 1)).toBe('12·1')
    expect(formatReps(0, 0)).toBe('0·0')
  })
})
