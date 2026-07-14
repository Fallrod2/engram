import { describe, expect, it } from 'vitest'
import {
  claimAccountId,
  deriveExpiresAt,
  pollDeviceAuth,
  refreshTokens,
  startDeviceAuth,
} from './codex-oauth'
import type { FetchFn } from './types'

interface Call {
  url: string
  init?: RequestInit
}
function stubFetch(routes: (url: string, init?: RequestInit) => Response): {
  fetchFn: FetchFn
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.push({ url: u, ...(init ? { init } : {}) })
    return routes(u, init)
  }) as unknown as FetchFn
  return { fetchFn, calls }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Build an unsigned JWT with the given payload (decode-only in the code). */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`
}

describe('startDeviceAuth', () => {
  it('POSTs the client_id and returns device_auth_id + user_code (string interval)', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({ device_auth_id: 'dev-1', user_code: 'ABCD-1234', interval: '5' }),
    )
    const res = await startDeviceAuth(fetchFn)
    expect(res).toEqual({ deviceAuthId: 'dev-1', userCode: 'ABCD-1234', intervalSeconds: 5 })
    expect(calls[0]!.url).toContain('/deviceauth/usercode')
    expect(JSON.parse(calls[0]!.init!.body as string).client_id).toMatch(/^app_/)
  })

  it('throws DeviceAuthDisabledError when initiation is refused', async () => {
    const { fetchFn } = stubFetch(() => new Response('', { status: 403 }))
    await expect(startDeviceAuth(fetchFn)).rejects.toThrow(/disabled/i)
  })
})

describe('pollDeviceAuth', () => {
  const dev = { deviceAuthId: 'dev-1', userCode: 'ABCD-1234' }

  it('403 → pending', async () => {
    const { fetchFn } = stubFetch(() => new Response('', { status: 403 }))
    expect(await pollDeviceAuth(dev, fetchFn)).toEqual({ status: 'pending' })
  })
  it('404 → pending', async () => {
    const { fetchFn } = stubFetch(() => new Response('', { status: 404 }))
    expect(await pollDeviceAuth(dev, fetchFn)).toEqual({ status: 'pending' })
  })

  it('success → exchanges the code and returns linked tokens (+ account id)', async () => {
    const idToken = fakeJwt({ chatgpt_account_id: 'acct-xyz' })
    const accessToken = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.includes('/deviceauth/token')) {
        return json({ authorization_code: 'auth-code', code_verifier: 'verifier' })
      }
      // /oauth/token exchange
      return json({ id_token: idToken, access_token: accessToken, refresh_token: 'refresh-1' })
    })
    const res = await pollDeviceAuth(dev, fetchFn)
    expect(res.status).toBe('linked')
    if (res.status !== 'linked') throw new Error('unreachable')
    expect(res.tokens.accessToken).toBe(accessToken)
    expect(res.tokens.refreshToken).toBe('refresh-1')
    expect(res.tokens.accountId).toBe('acct-xyz')
    expect(res.tokens.expiresAt).toBeInstanceOf(Date)
    // The exchange is form-urlencoded with grant_type=authorization_code.
    const exchange = calls.find((c) => c.url.includes('/oauth/token'))!
    expect((exchange.init!.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    )
    expect(exchange.init!.body as string).toContain('grant_type=authorization_code')
  })

  it('a non-pending non-2xx poll → denied', async () => {
    const { fetchFn } = stubFetch(() => new Response('', { status: 400 }))
    expect(await pollDeviceAuth(dev, fetchFn)).toEqual({ status: 'denied' })
  })
})

describe('refreshTokens', () => {
  it('rotates the refresh token when the response supplies one', async () => {
    const access = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    const { fetchFn, calls } = stubFetch(() =>
      json({ access_token: access, refresh_token: 'refresh-2' }),
    )
    const res = await refreshTokens('refresh-1', fetchFn)
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') throw new Error('unreachable')
    expect(res.tokens.refreshToken).toBe('refresh-2')
    // JSON body, grant_type=refresh_token.
    expect((calls[0]!.init!.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    )
    expect(JSON.parse(calls[0]!.init!.body as string).grant_type).toBe('refresh_token')
  })

  it('KEEPS the old refresh token when the response omits one', async () => {
    const access = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    const { fetchFn } = stubFetch(() => json({ access_token: access }))
    const res = await refreshTokens('refresh-1', fetchFn)
    if (res.status !== 'ok') throw new Error('unreachable')
    expect(res.tokens.refreshToken).toBe('refresh-1')
  })

  it('400/401 → invalid_grant (revoked → unlink)', async () => {
    const { fetchFn } = stubFetch(() => new Response('', { status: 400 }))
    expect(await refreshTokens('refresh-1', fetchFn)).toEqual({ status: 'invalid_grant' })
  })

  it('network error → transient error (keep the credential)', async () => {
    const fetchFn = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as FetchFn
    expect(await refreshTokens('refresh-1', fetchFn)).toEqual({ status: 'error' })
  })

  it('5xx → transient error', async () => {
    const { fetchFn } = stubFetch(() => new Response('', { status: 502 }))
    expect(await refreshTokens('refresh-1', fetchFn)).toEqual({ status: 'error', httpStatus: 502 })
  })
})

describe('claim + expiry derivation', () => {
  it('reads chatgpt_account_id from the id token', () => {
    expect(claimAccountId(fakeJwt({ chatgpt_account_id: 'acct-9' }))).toBe('acct-9')
    expect(claimAccountId('not-a-jwt')).toBeUndefined()
  })

  it('derives expiry from the JWT exp claim', () => {
    const exp = Math.floor(Date.now() / 1000) + 1200
    expect(deriveExpiresAt(fakeJwt({ exp }))!.getTime()).toBe(exp * 1000)
  })

  it('falls back to expires_in, then a conservative default', () => {
    const byExpiresIn = deriveExpiresAt('opaque', 600)!
    expect(byExpiresIn.getTime()).toBeGreaterThan(Date.now())
    const byDefault = deriveExpiresAt('opaque')!
    expect(byDefault.getTime()).toBeGreaterThan(Date.now())
  })
})
