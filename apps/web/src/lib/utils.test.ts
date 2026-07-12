import { describe, expect, it } from 'vitest'
import { mergeDefined } from './utils'

describe('mergeDefined', () => {
  it('overwrites only defined patch fields (optimistic updates)', () => {
    const base = { name: 'A', description: 'old', position: 1 }
    expect(mergeDefined(base, { name: 'B' })).toEqual({
      name: 'B',
      description: 'old',
      position: 1,
    })
  })

  it('ignores undefined values so they never clobber the base', () => {
    const base = { name: 'A', description: 'keep' as string | null }
    expect(mergeDefined(base, { description: undefined })).toEqual({
      name: 'A',
      description: 'keep',
    })
  })
})
