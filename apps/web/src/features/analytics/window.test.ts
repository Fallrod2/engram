import { describe, expect, it } from 'vitest'
import { parseDayKey } from '@/lib/calendar'
import {
  parseWindow,
  previousSeriesRange,
  rateRange,
  seriesRange,
  windowGranularity,
  windowLabel,
} from './window'

const NOW = new Date(2026, 6, 12) // 12 July 2026 (local)

function spanDays(from: string, to: string): number {
  return Math.round((parseDayKey(to).getTime() - parseDayKey(from).getTime()) / 86400000) + 1
}

describe('parseWindow', () => {
  it('defaults an unknown value to 30d', () => {
    expect(parseWindow('90d')).toBe('90d')
    expect(parseWindow('bogus')).toBe('30d')
    expect(parseWindow(undefined)).toBe('30d')
  })
})

describe('windowLabel / windowGranularity', () => {
  it('labels the presets in FR', () => {
    expect(windowLabel('30d')).toBe('30 j')
    expect(windowLabel('365d')).toBe('12 mois')
    expect(windowLabel('all')).toBe('tout')
  })
  it('switches to weekly buckets for the long windows', () => {
    expect(windowGranularity('30d')).toBe('day')
    expect(windowGranularity('90d')).toBe('day')
    expect(windowGranularity('365d')).toBe('week')
    expect(windowGranularity('all')).toBe('week')
  })
})

describe('seriesRange', () => {
  it('is a concrete trailing window ending today', () => {
    const r = seriesRange('30d', NOW)
    expect(r.to).toBe('2026-07-12')
    expect(r.from).toBe('2026-06-13')
    expect(spanDays(r.from, r.to)).toBe(30)
  })
  it('collapses `all` to the largest a series can serve (365 days)', () => {
    expect(spanDays(seriesRange('all', NOW).from, seriesRange('all', NOW).to)).toBe(365)
  })
})

describe('rateRange', () => {
  it('omits both bounds for `all` (true all-time)', () => {
    expect(rateRange('all', NOW)).toEqual({})
  })
  it('matches the series window for a preset', () => {
    expect(rateRange('30d', NOW)).toEqual(seriesRange('30d', NOW))
  })
})

describe('previousSeriesRange', () => {
  it('is null for `all` (no previous period)', () => {
    expect(previousSeriesRange('all', NOW)).toBeNull()
  })
  it('is the equal-length span ending the day before the current window', () => {
    const prev = previousSeriesRange('30d', NOW)!
    expect(prev.to).toBe('2026-06-12') // day before current from
    expect(spanDays(prev.from, prev.to)).toBe(30)
  })
})
