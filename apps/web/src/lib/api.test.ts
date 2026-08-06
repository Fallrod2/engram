import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { api, configureAuth, primeDemoAccount } from './api'

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

  it('401 with no refresh available → onUnauthorized + ApiError(401) (audit §8)', async () => {
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
    // No refresh hook wired ⇒ no replay: exactly one request went out.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * The first 401 no longer signs anyone out (T-069). A token that expired while
 * the machine slept is a stale REQUEST, not a dead session: refresh once, replay
 * once, and only then give up.
 */
describe('api client — one retry after a refresh, and only one', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let onUnauthorized: ReturnType<typeof vi.fn>

  const unauthorized = () => jsonResponse({ error: { code: 'unauthorized', message: 'nope' } }, 401)

  /** Wire the client with a refresh that answers `token` (or `null` = it failed). */
  function wire(token: string | null) {
    const refreshAccessToken = vi.fn<() => Promise<string | null>>().mockResolvedValue(token)
    configureAuth({ getAccessToken: () => 'tok-stale', onUnauthorized, refreshAccessToken })
    return refreshAccessToken
  }

  function authOf(callIndex: number): string | undefined {
    const call = fetchMock.mock.calls[callIndex]
    if (!call) throw new Error(`fetch call #${callIndex} never happened`)
    return ((call[1] as RequestInit).headers as Record<string, string>).Authorization
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    onUnauthorized = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    configureAuth({ getAccessToken: () => null, onUnauthorized: () => {} })
  })

  it('401 → refresh OK → 200: the caller gets its data and nobody is signed out', async () => {
    const refreshAccessToken = wire('tok-fresh')
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    await expect(api.get('/thing', okSchema)).resolves.toEqual({ ok: true })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The replay carries the NEW token, not the stale one that just 401ed.
    expect(authOf(0)).toBe('Bearer tok-stale')
    expect(authOf(1)).toBe('Bearer tok-fresh')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('401 → refresh KO: the session really is over, sign out without replaying', async () => {
    const refreshAccessToken = wire(null)
    fetchMock.mockResolvedValue(unauthorized())
    await expect(api.get('/thing', okSchema)).rejects.toMatchObject({ status: 401 })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('401 → refresh OK → 401 again: ONE replay, then sign out (no loop)', async () => {
    const refreshAccessToken = wire('tok-fresh')
    fetchMock.mockResolvedValue(unauthorized())
    await expect(api.get('/thing', okSchema)).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(2) // original + exactly one replay
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('403 is never retried — it is an answer about permissions, not about the token', async () => {
    const refreshAccessToken = wire('tok-fresh')
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'forbidden', message: 'no' } }, 403))
    await expect(api.get('/thing', okSchema)).rejects.toMatchObject({ status: 403 })
    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('a POST is replayed too — a 401 comes from the gate, so nothing was written', async () => {
    // The whole argument for retrying a non-idempotent call: `createAuthMiddleware`
    // and `requireUserId` both throw BEFORE the handler, so a 401 proves no
    // review_log row, no FSRS advance, no AI call. See the comment in api.ts.
    wire('tok-fresh')
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    await expect(api.post('/cards/c1/review', { rating: 3 }, okSchema)).resolves.toEqual({
      ok: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const replay = fetchMock.mock.calls[1]![1] as RequestInit
    expect(replay.method).toBe('POST')
    expect(replay.body).toBe(JSON.stringify({ rating: 3 }))
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('a request carrying an explicit token (demo boot) is never refreshed away', async () => {
    // `primeDemoAccount` holds a token minted seconds ago; the ambient session may
    // not even exist yet, so refreshing it answers a question nobody asked.
    const refreshAccessToken = wire('tok-fresh')
    fetchMock.mockResolvedValue(unauthorized())
    await expect(primeDemoAccount('tok-demo')).rejects.toMatchObject({ status: 401 })
    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
