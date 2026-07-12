import { describe, expect, it } from 'bun:test'
import { apiErrorSchema, healthResponseSchema } from '@engram/shared'
import { app } from './app'

/**
 * Transverse HTTP behaviour. Runs under bun:test (not vitest) because `app`
 * transitively imports the bun:sqlite client. The DB is provided by the
 * `db-preload` harness, though these cases need no seeded data.
 */
describe('app transverse', () => {
  it('GET /api/health → contract-valid 200', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(healthResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('unknown route → 404 not_found envelope', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    const body = apiErrorSchema.parse(await res.json())
    expect(body.error.code).toBe('not_found')
  })

  it('malformed JSON body → 400 validation_error (not 500)', async () => {
    const res = await app.request('/api/subjects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not valid json',
    })
    expect(res.status).toBe(400)
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe('validation_error')
  })
})
