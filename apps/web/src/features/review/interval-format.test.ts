import { describe, expect, it } from 'vitest'
import { formatDurationClock, formatInterval, formatSeconds } from './interval-format'

const NOW = '2026-07-12T10:00:00.000Z'

/** ISO string `s` seconds after NOW. */
function plus(seconds: number): string {
  return new Date(new Date(NOW).getTime() + seconds * 1000).toISOString()
}

describe('formatInterval — learning steps, scheduledDays 0 (§16.1 item 10)', () => {
  it('< 60 s → "< 1 min"', () => {
    expect(formatInterval(plus(40), NOW, 0)).toBe('< 1 min')
  })
  it('6 min → "6 min"', () => {
    expect(formatInterval(plus(6 * 60), NOW, 0)).toBe('6 min')
  })
  it('90 min → "2 h"', () => {
    expect(formatInterval(plus(90 * 60), NOW, 0)).toBe('2 h')
  })
  it('clamps a non-positive delta to "< 1 min"', () => {
    expect(formatInterval(NOW, NOW, 0)).toBe('< 1 min')
  })
})

describe('formatInterval — day/month/year scale (§16.1 item 11)', () => {
  it('3 days → "3 j"', () => {
    expect(formatInterval(plus(3 * 86_400), NOW, 3)).toBe('3 j')
  })
  it('45 days → "2 mo"', () => {
    expect(formatInterval(plus(45 * 86_400), NOW, 45)).toBe('2 mo')
  })
  it('400 days → "1 a"', () => {
    expect(formatInterval(plus(400 * 86_400), NOW, 400)).toBe('1 a')
  })
  it('boundaries: 29 → j, 30 → mo, 365 → a', () => {
    expect(formatInterval(plus(29 * 86_400), NOW, 29)).toBe('29 j')
    expect(formatInterval(plus(30 * 86_400), NOW, 30)).toBe('1 mo')
    expect(formatInterval(plus(365 * 86_400), NOW, 365)).toBe('1 a')
  })
})

describe('summary duration formatting (§10.1)', () => {
  it('formats mm:ss', () => {
    expect(formatDurationClock(0)).toBe('0:00')
    expect(formatDurationClock(65_000)).toBe('1:05')
    expect(formatDurationClock(600_000)).toBe('10:00')
  })
  it('formats average seconds', () => {
    expect(formatSeconds(4200)).toBe('4 s')
    expect(formatSeconds(0)).toBe('0 s')
  })
})
