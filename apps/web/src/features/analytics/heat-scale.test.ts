import { describe, expect, it } from 'vitest'
import { heatLevel, HEAT_THRESHOLDS } from './heat-scale'

describe('heatLevel', () => {
  it('maps counts to fixed buckets (0 · 1–3 · 4–8 · 9–15 · ≥16)', () => {
    expect(heatLevel(0)).toBe(0)
    expect(heatLevel(1)).toBe(1)
    expect(heatLevel(3)).toBe(1)
    expect(heatLevel(4)).toBe(2)
    expect(heatLevel(8)).toBe(2)
    expect(heatLevel(9)).toBe(3)
    expect(heatLevel(15)).toBe(3)
    expect(heatLevel(16)).toBe(4)
    expect(heatLevel(999)).toBe(4)
  })

  it('has one fewer level than there are thresholds boundaries', () => {
    expect(HEAT_THRESHOLDS).toEqual([1, 4, 9, 16])
  })
})
