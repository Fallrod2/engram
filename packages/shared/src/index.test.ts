import { describe, expect, it } from 'vitest'
import { healthResponseSchema } from './index'

describe('healthResponseSchema', () => {
  it('accepts a well-formed payload', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'engram-server',
      timestamp: new Date().toISOString(),
      fakeAi: false,
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown status value', () => {
    const result = healthResponseSchema.safeParse({
      status: 'down',
      service: 'engram-server',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-ISO timestamp', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'engram-server',
      timestamp: 'not-a-date',
    })
    expect(result.success).toBe(false)
  })
})
