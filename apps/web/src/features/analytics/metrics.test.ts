import { describe, expect, it } from 'vitest'
import type { HeatmapDay } from '@engram/shared'
import {
  computeDelta,
  formatDelta,
  formatDuration,
  formatDurationAxis,
  formatPercent,
  passedCount,
  sparkFromHeatmap,
  successRate,
  MIN_RATE_SAMPLE,
} from './metrics'

const totals = (again: number, hard: number, good: number, easy: number) => ({
  again,
  hard,
  good,
  easy,
  total: again + hard + good + easy,
})

describe('successRate', () => {
  it('is null below the sample floor (never a misleading %)', () => {
    expect(successRate(totals(1, 1, 1, 0))).toBeNull() // total 3 < 10
    expect(MIN_RATE_SAMPLE).toBe(10)
  })
  it('counts rating >= 2 as passed (Again is the only miss)', () => {
    expect(passedCount(totals(2, 3, 4, 1))).toBe(8)
    expect(successRate(totals(2, 3, 4, 1))).toBeCloseTo(8 / 10)
  })
})

describe('formatPercent', () => {
  it('rounds and adds the FR space', () => {
    expect(formatPercent(0.862)).toBe('86 %')
    expect(formatPercent(1)).toBe('100 %')
  })
})

describe('formatDuration', () => {
  it('shows seconds under a minute, minutes then hours above', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(45000)).toBe('45 s')
    expect(formatDuration(42 * 60000)).toBe('42 min')
    expect(formatDuration((3 * 60 + 42) * 60000)).toBe('3 h 42')
    expect(formatDuration(2 * 3600000)).toBe('2 h')
  })
})

describe('formatDurationAxis', () => {
  it('is a distinct clock tick (m:ss, then h:mm)', () => {
    expect(formatDurationAxis(0)).toBe('0')
    expect(formatDurationAxis(90000)).toBe('1:30')
    expect(formatDurationAxis(30 * 60000)).toBe('30:00')
    expect(formatDurationAxis(3600000)).toBe('1:00')
  })
})

describe('computeDelta / formatDelta', () => {
  it('has no ratio when there is no previous period', () => {
    const d = computeDelta(100, null)
    expect(d.pct).toBeNull()
    expect(formatDelta(d)).toBe('')
  })
  it('has no ratio (but a direction) when the previous period was zero', () => {
    const d = computeDelta(5, 0)
    expect(d.pct).toBeNull()
    expect(d.direction).toBe('up')
  })
  it('is signed with a true minus sign', () => {
    expect(formatDelta(computeDelta(118, 100))).toBe('+18 %')
    expect(formatDelta(computeDelta(96, 100))).toBe('−4 %')
    expect(computeDelta(100, 100).direction).toBe('flat')
  })
})

describe('sparkFromHeatmap', () => {
  const days: HeatmapDay[] = Array.from({ length: 40 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    count: i,
  }))

  it('returns the last `length` days ending at today', () => {
    const spark = sparkFromHeatmap(days, '2026-01-40', 30)
    expect(spark).toHaveLength(30)
    expect(spark.at(-1)).toBe(39) // count of the 40th day
    expect(spark[0]).toBe(10)
  })

  it('left-pads with zeros when history is short', () => {
    const short = days.slice(0, 5)
    const spark = sparkFromHeatmap(short, '2026-01-05', 30)
    expect(spark).toHaveLength(30)
    expect(spark.slice(0, 25).every((n) => n === 0)).toBe(true)
    expect(spark.at(-1)).toBe(4)
  })
})
