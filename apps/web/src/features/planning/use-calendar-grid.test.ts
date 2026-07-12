import { describe, expect, it } from 'vitest'
import { nextDayKeyForKey } from './use-calendar-grid'

const now = new Date(2026, 6, 12) // Sun 2026-07-12

describe('nextDayKeyForKey (spec §2.4)', () => {
  it('moves ∓1 day with arrows, crossing month bounds', () => {
    expect(nextDayKeyForKey('ArrowLeft', 'month', '2026-07-01', now)).toBe('2026-06-30')
    expect(nextDayKeyForKey('ArrowRight', 'month', '2026-07-31', now)).toBe('2026-08-01')
  })

  it('moves ∓1 week with up/down', () => {
    expect(nextDayKeyForKey('ArrowUp', 'month', '2026-07-15', now)).toBe('2026-07-08')
    expect(nextDayKeyForKey('ArrowDown', 'month', '2026-07-15', now)).toBe('2026-07-22')
  })

  it('PgUp/PgDn move a month in month view (day clamped)', () => {
    expect(nextDayKeyForKey('PageUp', 'month', '2026-03-31', now)).toBe('2026-02-28')
    expect(nextDayKeyForKey('PageDown', 'month', '2026-01-15', now)).toBe('2026-02-15')
  })

  it('PgUp/PgDn move a week in week view', () => {
    expect(nextDayKeyForKey('PageUp', 'week', '2026-07-15', now)).toBe('2026-07-08')
    expect(nextDayKeyForKey('PageDown', 'week', '2026-07-15', now)).toBe('2026-07-22')
  })

  it('Home/End snap to Monday/Sunday of the row', () => {
    expect(nextDayKeyForKey('Home', 'month', '2026-07-08', now)).toBe('2026-07-06')
    expect(nextDayKeyForKey('End', 'month', '2026-07-08', now)).toBe('2026-07-12')
  })

  it('t jumps to today', () => {
    expect(nextDayKeyForKey('t', 'month', '2026-01-01', now)).toBe('2026-07-12')
  })

  it('returns null for Space (reserved) and other keys', () => {
    expect(nextDayKeyForKey(' ', 'month', '2026-07-12', now)).toBeNull()
    expect(nextDayKeyForKey('Enter', 'month', '2026-07-12', now)).toBeNull()
    expect(nextDayKeyForKey('a', 'month', '2026-07-12', now)).toBeNull()
  })
})
