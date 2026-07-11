import { describe, expect, it } from 'vitest'
import { healthResponseSchema } from '@engram/shared'
import { app } from './app'

describe('GET /api/health', () => {
  it('responds 200 with a contract-valid payload', async () => {
    const res = await app.request('/api/health')

    expect(res.status).toBe(200)

    const json: unknown = await res.json()
    const parsed = healthResponseSchema.safeParse(json)
    expect(parsed.success).toBe(true)
  })

  it('404s on an unknown route', async () => {
    const res = await app.request('/api/does-not-exist')
    expect(res.status).toBe(404)
  })
})
