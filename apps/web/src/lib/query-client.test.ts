import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { shouldRetryQuery } from '@/lib/query-client'

/**
 * T-028 (a). The endless loading skeleton on `/subjects/<unknown id>` was NOT a
 * missing error component — all four detail routes already had one. It was this
 * policy: the 404 was replayed like a transient failure, and between two
 * attempts `@tanstack/query-core` pauses the retryer while the document is
 * hidden or the device is offline, with no deadline. The route loader awaiting
 * that query never settled, so the router stayed `pending` forever.
 */
describe('shouldRetryQuery', () => {
  const api = (status: number) => new ApiError(status, `HTTP ${status}`)

  it('never retries a definitive 4xx — the answer will not change', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(shouldRetryQuery(0, api(status)), `status ${status}`).toBe(false)
    }
  })

  it('still retries the two 4xx that invite another attempt (408, 429)', () => {
    expect(shouldRetryQuery(0, api(408))).toBe(true)
    expect(shouldRetryQuery(0, api(429))).toBe(true)
  })

  it('retries a 5xx twice, then gives up', () => {
    expect(shouldRetryQuery(0, api(503))).toBe(true)
    expect(shouldRetryQuery(1, api(503))).toBe(true)
    expect(shouldRetryQuery(2, api(503))).toBe(false)
  })

  it('retries non-ApiError failures (network drop, schema mismatch)', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetryQuery(2, new TypeError('Failed to fetch'))).toBe(false)
  })
})
