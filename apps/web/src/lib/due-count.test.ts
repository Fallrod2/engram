import { describe, expect, it } from 'vitest'
import { dueBarWidth, dueCountTier } from './due-count'

describe('dueCountTier', () => {
  it('encodes intensity by threshold (design §6.1)', () => {
    expect(dueCountTier(0)).toBe('zero')
    expect(dueCountTier(-3)).toBe('zero')
    expect(dueCountTier(1)).toBe('low')
    expect(dueCountTier(20)).toBe('low')
    expect(dueCountTier(21)).toBe('mid')
    expect(dueCountTier(50)).toBe('mid')
    expect(dueCountTier(51)).toBe('high')
    expect(dueCountTier(9999)).toBe('high')
  })
})

describe('dueBarWidth', () => {
  it('scales with backlog and caps at 100%', () => {
    expect(dueBarWidth(0)).toBe(0)
    expect(dueBarWidth(100)).toBe(50)
    expect(dueBarWidth(200)).toBe(100)
    expect(dueBarWidth(500)).toBe(100)
  })
})
