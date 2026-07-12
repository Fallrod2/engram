import { describe, expect, it } from 'vitest'
import { SUBJECT_PIGMENTS, pigmentSlotForHex, subjectColorValue } from './pigments'

describe('pigment resolution', () => {
  it('maps a canonical hex to its themeable token, case-insensitively', () => {
    expect(pigmentSlotForHex('#7999f5')).toBe(1)
    expect(pigmentSlotForHex('#7999F5')).toBe(1)
    expect(pigmentSlotForHex('#ba71cb')).toBe(8)
    expect(subjectColorValue('#00b6be')).toBe('var(--color-subject-2)')
  })

  it('falls back to the raw hex for a non-canonical color', () => {
    expect(pigmentSlotForHex('#123456')).toBeNull()
    expect(subjectColorValue('#123456')).toBe('#123456')
  })

  it('exposes exactly the 8 pigments with unique slots and hexes', () => {
    expect(SUBJECT_PIGMENTS).toHaveLength(8)
    expect(new Set(SUBJECT_PIGMENTS.map((p) => p.slot)).size).toBe(8)
    expect(new Set(SUBJECT_PIGMENTS.map((p) => p.hex)).size).toBe(8)
  })
})
