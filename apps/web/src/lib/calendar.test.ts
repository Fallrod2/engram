import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  dayDiff,
  isWeekend,
  localDayKey,
  monthMatrix,
  parseDayKey,
  rangeFor,
  startOfWeekMonday,
  weekDays,
} from './calendar'

describe('localDayKey / parseDayKey', () => {
  it('formats a local date to YYYY-MM-DD zero-padded', () => {
    expect(localDayKey(new Date(2026, 6, 5))).toBe('2026-07-05')
    expect(localDayKey(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(localDayKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('round-trips a key through local midnight (never UTC-parsed)', () => {
    const d = parseDayKey('2026-02-09')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(1)
    expect(d.getDate()).toBe(9)
    expect(d.getHours()).toBe(0)
    expect(localDayKey(d)).toBe('2026-02-09')
  })
})

describe('addDays / addMonths', () => {
  it('crosses month and year boundaries', () => {
    expect(localDayKey(addDays(new Date(2026, 6, 31), 1))).toBe('2026-08-01')
    expect(localDayKey(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31')
  })

  it('clamps the day of month when the target month is shorter', () => {
    expect(localDayKey(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28')
    expect(localDayKey(addMonths(new Date(2026, 2, 15), -1))).toBe('2026-02-15')
    expect(localDayKey(addMonths(new Date(2026, 11, 15), 1))).toBe('2027-01-15')
  })
})

describe('startOfWeekMonday', () => {
  it('returns the Monday for any day, including Sunday', () => {
    // 2026-07-12 is a Sunday → Monday is 2026-07-06.
    expect(localDayKey(startOfWeekMonday(new Date(2026, 6, 12)))).toBe('2026-07-06')
    // 2026-07-06 is a Monday → itself.
    expect(localDayKey(startOfWeekMonday(new Date(2026, 6, 6)))).toBe('2026-07-06')
    // 2026-07-08 (Wed) → 2026-07-06.
    expect(localDayKey(startOfWeekMonday(new Date(2026, 6, 8)))).toBe('2026-07-06')
  })
})

describe('isWeekend', () => {
  it('flags Saturday and Sunday only', () => {
    expect(isWeekend(new Date(2026, 6, 11))).toBe(true) // Sat
    expect(isWeekend(new Date(2026, 6, 12))).toBe(true) // Sun
    expect(isWeekend(new Date(2026, 6, 13))).toBe(false) // Mon
  })
})

describe('dayDiff', () => {
  it('is a signed whole-day difference', () => {
    expect(dayDiff(new Date(2026, 6, 12), new Date(2026, 6, 15))).toBe(3)
    expect(dayDiff(new Date(2026, 6, 12), new Date(2026, 6, 12))).toBe(0)
    expect(dayDiff(new Date(2026, 6, 12, 23), new Date(2026, 6, 10, 1))).toBe(-2)
  })
})

describe('monthMatrix', () => {
  const now = new Date(2026, 6, 12)
  const grid = monthMatrix(new Date(2026, 6, 12), now)

  it('is 6 rows × 7 columns starting on the Monday ≤ the 1st', () => {
    expect(grid).toHaveLength(6)
    for (const row of grid) expect(row).toHaveLength(7)
    // July 2026: the 1st is a Wednesday → grid starts Mon 2026-06-29.
    expect(grid[0]![0]!.key).toBe('2026-06-29')
    expect(grid[5]![6]!.key).toBe('2026-08-09')
  })

  it('marks inMonth, today and weekends', () => {
    expect(grid[0]![0]!.inMonth).toBe(false) // 29 June
    const twelfth = grid.flat().find((c) => c.key === '2026-07-12')!
    expect(twelfth.inMonth).toBe(true)
    expect(twelfth.isToday).toBe(true)
    expect(twelfth.isWeekend).toBe(true) // Sunday
  })
})

describe('weekDays', () => {
  it('returns Monday→Sunday of the anchor week', () => {
    const days = weekDays(new Date(2026, 6, 12))
    expect(days).toHaveLength(7)
    expect(days[0]!.key).toBe('2026-07-06')
    expect(days[6]!.key).toBe('2026-07-12')
  })
})

describe('rangeFor', () => {
  it('spans the 42 month cells', () => {
    expect(rangeFor('month', '2026-07-12')).toEqual({ from: '2026-06-29', to: '2026-08-09' })
  })

  it('spans Monday→Sunday for a week', () => {
    expect(rangeFor('week', '2026-07-12')).toEqual({ from: '2026-07-06', to: '2026-07-12' })
  })
})
