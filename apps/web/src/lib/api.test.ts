import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { api, configureAuth } from './api'

/**
 * API client auth wiring (spec §6.2). Proves the audit §9 fix: `init.headers` is
 * built for EVERY method (GET/upload), so the bearer token is never dropped; and
 * a 401 fires `onUnauthorized` + throws `ApiError(401,'unauthorized')`.
 */
const okSchema = z.object({ ok: z.boolean() })

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function firstInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  const call = fetchMock.mock.calls[0]
  if (!call) throw new Error('fetch was not called')
  return call[1] as RequestInit
}

describe('api client auth wiring', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    configureAuth({ getAccessToken: () => 'tok-123', onUnauthorized: () => {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    configureAuth({ getAccessToken: () => null, onUnauthorized: () => {} })
  })

  it('adds Authorization on a GET (audit §9)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await api.get('/thing', okSchema)
    const headers = firstInit(fetchMock).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-123')
  })

  it('FormData upload: no forced Content-Type, but Authorization present', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    const fd = new FormData()
    fd.append('x', 'y')
    await api.upload('/upload', fd, okSchema)
    const headers = firstInit(fetchMock).headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers.Authorization).toBe('Bearer tok-123')
  })

  it('no token → no Authorization header', async () => {
    configureAuth({ getAccessToken: () => null, onUnauthorized: () => {} })
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await api.get('/thing', okSchema)
    const headers = firstInit(fetchMock).headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('401 → onUnauthorized called and ApiError(401, unauthorized) thrown (audit §8)', async () => {
    const onUnauthorized = vi.fn()
    configureAuth({ getAccessToken: () => 'tok-123', onUnauthorized })
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'unauthorized', message: 'nope' } }, 401),
    )
    await expect(api.get('/thing', okSchema)).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
