import { describe, expect, it } from 'vitest'
import { localDayKey, localMidnight } from './day'

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
