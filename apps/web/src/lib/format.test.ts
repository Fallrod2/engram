import { describe, expect, it } from 'vitest'
import {
  formatCountdown,
  formatDue,
  formatLongDay,
  formatMonthLabel,
  formatRelativeDay,
  formatReps,
  formatWeekLabel,
} from './format'

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

describe('formatCountdown', () => {
  const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString()
  const now = new Date(2026, 6, 12, 10)

  it('labels future / today / past by whole days, never red', () => {
    expect(formatCountdown(iso(2026, 6, 17, 9), now)).toBe('J-5')
    expect(formatCountdown(iso(2026, 6, 13, 1), now)).toBe('J-1')
    expect(formatCountdown(iso(2026, 6, 12, 23), now)).toBe("aujourd'hui")
    expect(formatCountdown(iso(2026, 6, 11, 23), now)).toBe('passé')
  })
})

describe('formatRelativeDay', () => {
  const now = new Date(2026, 6, 12, 10)
  it('labels a day key relative to now', () => {
    expect(formatRelativeDay('2026-07-12', now)).toBe("aujourd'hui")
    expect(formatRelativeDay('2026-07-13', now)).toBe('demain')
    expect(formatRelativeDay('2026-07-11', now)).toBe('hier')
    expect(formatRelativeDay('2026-07-15', now)).toBe('dans 3 jours')
    expect(formatRelativeDay('2026-07-09', now)).toBe('il y a 3 jours')
  })
})

describe('formatLongDay', () => {
  it('formats a day key as weekday + date', () => {
    expect(formatLongDay('2026-07-12')).toBe('dim. 12 juil. 2026')
  })
})

describe('formatMonthLabel / formatWeekLabel', () => {
  it('formats the month toolbar label', () => {
    expect(formatMonthLabel(new Date(2026, 6, 12))).toBe('juillet 2026')
  })

  it('formats a same-month week span', () => {
    expect(formatWeekLabel(new Date(2026, 6, 12))).toBe('6–12 juil. 2026')
  })

  it('formats a cross-month week span', () => {
    // Week of 2026-06-29 (Mon) → 2026-07-05 (Sun).
    expect(formatWeekLabel(new Date(2026, 5, 30))).toBe('29 juin – 5 juil. 2026')
  })
})
