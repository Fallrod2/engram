import { describe, expect, it } from 'vitest'
import { localDayDiff, localDayKey, localMidnight, localWeekStart } from './day'

/**
 * Locks WS-B spec §1.9: day bucketing is LOCAL, never UTC. These assertions use
 * local-component `Date` constructors so they hold in any system timezone.
 */
describe('localDayKey', () => {
  it('formats a local calendar day as YYYY-MM-DD', () => {
    expect(localDayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localDayKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it('23:00 and next-day 00:30 fall in two distinct buckets', () => {
    const late = new Date(2026, 6, 12, 23, 0)
    const earlyNext = new Date(2026, 6, 13, 0, 30)
    expect(localDayKey(late)).toBe('2026-07-12')
    expect(localDayKey(earlyNext)).toBe('2026-07-13')
    expect(localDayKey(late)).not.toBe(localDayKey(earlyNext))
  })

  it('two instants on the same local day share one bucket', () => {
    const morning = new Date(2026, 6, 12, 8, 15)
    const night = new Date(2026, 6, 12, 22, 45)
    expect(localDayKey(morning)).toBe(localDayKey(night))
  })
})

describe('localMidnight', () => {
  it('returns local midnight of the given day', () => {
    const d = localMidnight(2026, 6, 20)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(20)
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
    expect(localDayKey(d)).toBe('2026-07-20')
  })
})

describe('localDayDiff', () => {
  it('is 0 for the same day (any time of day)', () => {
    expect(localDayDiff(new Date(2026, 6, 12, 9, 0), new Date(2026, 6, 12, 23, 30))).toBe(0)
  })

  it('counts whole forward and backward calendar days', () => {
    expect(localDayDiff(new Date(2026, 6, 12), new Date(2026, 6, 13))).toBe(1)
    expect(localDayDiff(new Date(2026, 6, 12), new Date(2026, 6, 9))).toBe(-3)
  })

  it('spans month boundaries', () => {
    expect(localDayDiff(new Date(2026, 6, 30), new Date(2026, 7, 2))).toBe(3)
  })

  it('yields a whole number across a DST transition (spring forward)', () => {
    // US spring-forward 2026 is 2026-03-08. A 23h local day must still be 1 day.
    const before = new Date(2026, 2, 7, 12, 0)
    const after = new Date(2026, 2, 8, 12, 0)
    const diff = localDayDiff(before, after)
    expect(Number.isInteger(diff)).toBe(true)
    expect(diff).toBe(1)
  })
})

describe('localWeekStart', () => {
  it('maps a Wednesday to the Monday of the same ISO week', () => {
    // 2026-07-15 is a Wednesday; its Monday is 2026-07-13.
    expect(localDayKey(localWeekStart(new Date(2026, 6, 15, 14, 30)))).toBe('2026-07-13')
  })

  it('maps a Sunday to the PREVIOUS Monday (not the next one)', () => {
    // 2026-07-19 is a Sunday; its ISO-week Monday is 2026-07-13.
    expect(localDayKey(localWeekStart(new Date(2026, 6, 19, 23, 0)))).toBe('2026-07-13')
  })

  it('maps a Monday to itself', () => {
    expect(localDayKey(localWeekStart(new Date(2026, 6, 13, 8, 0)))).toBe('2026-07-13')
  })

  it('always returns a local midnight (YYYY-MM-DD round-trips)', () => {
    const wk = localWeekStart(new Date(2026, 6, 15, 14, 30))
    expect(wk.getHours()).toBe(0)
    expect(wk.getMinutes()).toBe(0)
    expect(localDayKey(wk)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('spans a month boundary correctly', () => {
    // 2026-08-02 is a Sunday; its Monday is 2026-07-27.
    expect(localDayKey(localWeekStart(new Date(2026, 7, 2, 12, 0)))).toBe('2026-07-27')
  })

  it('uses local components across a DST transition', () => {
    // US spring-forward week starts Mon 2026-03-02; a day mid-week resolves to it.
    expect(localDayKey(localWeekStart(new Date(2026, 2, 8, 12, 0)))).toBe('2026-03-02')
  })
})
