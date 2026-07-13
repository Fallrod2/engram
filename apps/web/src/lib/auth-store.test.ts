import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Store + guard (spec §6.2). Each case re-imports the store with a fresh mock of
 * `@/lib/supabase` so both the disabled and enabled modes are exercised.
 */
afterEach(() => {
  vi.resetModules()
  vi.doUnmock('@/lib/supabase')
})

describe('auth-store — disabled mode', () => {
  it('forces authenticated and resolves ready immediately', async () => {
    vi.doMock('@/lib/supabase', () => ({ supabase: null, AUTH_ENABLED_WEB: false }))
    const store = await import('./auth-store')
    expect(store.getState().status).toBe('authenticated')
    await store.init()
    await store.authStore.ready
    expect(store.getState().status).toBe('authenticated')
    expect(store.token()).toBeNull()
  })
})

describe('auth-store — enabled mode', () => {
  it('loading → authenticated on a mocked session; token() returns the access token', async () => {
    const session = { access_token: 'abc', user: { email: 'a@b.co' } }
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session } }),
          onAuthStateChange: vi
            .fn()
            .mockReturnValue({ data: { subscription: { unsubscribe() {} } } }),
          signOut: vi.fn(),
        },
      },
      AUTH_ENABLED_WEB: true,
    }))
    const store = await import('./auth-store')
    expect(store.getState().status).toBe('loading')
    await store.init()
    expect(store.getState().status).toBe('authenticated')
    expect(store.token()).toBe('abc')
  })

  it('forceSignOut → unauthenticated + signOut() + runs the signed-out effect (audit §8)', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
          onAuthStateChange: vi
            .fn()
            .mockReturnValue({ data: { subscription: { unsubscribe() {} } } }),
          signOut,
        },
      },
      AUTH_ENABLED_WEB: true,
    }))
    const store = await import('./auth-store')
    const onSignedOut = vi.fn()
    store.setOnSignedOut(onSignedOut)
    store.forceSignOut()
    expect(store.getState().status).toBe('unauthenticated')
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })
})

describe('auth-store — invite/recovery link flow', () => {
  function mockSupabase(overrides: Record<string, unknown> = {}) {
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
          onAuthStateChange: vi
            .fn()
            .mockReturnValue({ data: { subscription: { unsubscribe() {} } } }),
          signOut: vi.fn(),
          ...overrides,
        },
      },
      AUTH_ENABLED_WEB: true,
    }))
  }

  it('captureAuthLink with an error fragment → error link state', async () => {
    mockSupabase()
    const store = await import('./auth-store')
    store.captureAuthLink({
      hash: '#error=access_denied&error_code=otp_expired&error_description=expired',
      search: '',
    })
    expect(store.getLinkState()).toEqual({
      kind: 'error',
      error: { kind: 'error', error: 'access_denied', code: 'otp_expired', description: 'expired' },
    })
  })

  it('captured invite tokens → setSession established → setup state + authenticated', async () => {
    const session = { access_token: 'newtok', user: { email: 'invited@x.co' } }
    const setSession = vi.fn().mockResolvedValue({ data: { session }, error: null })
    mockSupabase({ setSession })
    const store = await import('./auth-store')
    store.captureAuthLink({
      hash: '#access_token=at&refresh_token=rt&type=invite',
      search: '',
    })
    // Not established until init() runs.
    expect(store.isPasswordSetupPending()).toBe(false)
    await store.init()
    expect(setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' })
    expect(store.getLinkState()).toEqual({ kind: 'setup', linkType: 'invite' })
    expect(store.isPasswordSetupPending()).toBe(true)
    expect(store.getState().status).toBe('authenticated')
  })

  it('setSession failure → error link state + unauthenticated', async () => {
    const setSession = vi
      .fn()
      .mockResolvedValue({ data: { session: null }, error: { message: 'bad token' } })
    mockSupabase({ setSession })
    const store = await import('./auth-store')
    store.captureAuthLink({ hash: '#access_token=at&refresh_token=rt&type=recovery', search: '' })
    await store.init()
    expect(store.getLinkState().kind).toBe('error')
    expect(store.getState().status).toBe('unauthenticated')
  })

  it('clearLinkState resets to none', async () => {
    mockSupabase()
    const store = await import('./auth-store')
    store.captureAuthLink({ hash: '#error=access_denied&error_code=otp_expired', search: '' })
    expect(store.getLinkState().kind).toBe('error')
    store.clearLinkState()
    expect(store.getLinkState()).toEqual({ kind: 'none' })
  })
})

describe('linkRedirect guard', () => {
  it('no active flow → undefined (normal use)', async () => {
    const { linkRedirect } = await import('./auth-store')
    expect(linkRedirect({ pathname: '/', linkState: { kind: 'none' } })).toBeUndefined()
  })

  it('pending setup off /set-password → redirect there', async () => {
    const { linkRedirect } = await import('./auth-store')
    expect(
      linkRedirect({ pathname: '/', linkState: { kind: 'setup', linkType: 'invite' } }),
    ).toEqual({ to: '/set-password' })
  })

  it('error state off /set-password → redirect there', async () => {
    const { linkRedirect } = await import('./auth-store')
    expect(
      linkRedirect({
        pathname: '/subjects',
        linkState: {
          kind: 'error',
          error: { kind: 'error', error: 'x', code: null, description: null },
        },
      }),
    ).toEqual({ to: '/set-password' })
  })

  it('already on /set-password → no redirect (anti-loop)', async () => {
    const { linkRedirect } = await import('./auth-store')
    expect(
      linkRedirect({
        pathname: '/set-password',
        linkState: { kind: 'setup', linkType: 'recovery' },
      }),
    ).toBeUndefined()
  })

  it('error state + /login → no redirect (escape hatch from the expired screen)', async () => {
    const { linkRedirect } = await import('./auth-store')
    expect(
      linkRedirect({
        pathname: '/login',
        linkState: {
          kind: 'error',
          error: { kind: 'error', error: 'x', code: null, description: null },
        },
      }),
    ).toBeUndefined()
  })

  it('setup state + /login → still forced to /set-password (mandatory gate stays strict)', async () => {
    const { linkRedirect } = await import('./auth-store')
    expect(
      linkRedirect({ pathname: '/login', linkState: { kind: 'setup', linkType: 'invite' } }),
    ).toEqual({ to: '/set-password' })
  })
})

describe('requireAuth guard', () => {
  const authed = { getState: () => ({ status: 'authenticated' as const, session: null }) }
  const anon = { getState: () => ({ status: 'unauthenticated' as const, session: null }) }

  it('unauthenticated non-login → redirect to /login with the return path', async () => {
    const { requireAuth } = await import('./auth-store')
    expect(requireAuth({ auth: anon, pathname: '/subjects', href: '/subjects' })).toEqual({
      to: '/login',
      search: { redirect: '/subjects' },
    })
  })

  it('authenticated → no redirect', async () => {
    const { requireAuth } = await import('./auth-store')
    expect(requireAuth({ auth: authed, pathname: '/subjects', href: '/subjects' })).toBeUndefined()
  })

  it('/login is exempt even when unauthenticated (anti-loop, audit §8)', async () => {
    const { requireAuth } = await import('./auth-store')
    expect(requireAuth({ auth: anon, pathname: '/login', href: '/login' })).toBeUndefined()
  })

  it('/set-password is exempt even when unauthenticated (link flow, anti-loop)', async () => {
    const { requireAuth } = await import('./auth-store')
    expect(
      requireAuth({ auth: anon, pathname: '/set-password', href: '/set-password' }),
    ).toBeUndefined()
  })

  it('/ is exempt when unauthenticated → public landing, no redirect (landing §1)', async () => {
    const { requireAuth } = await import('./auth-store')
    expect(requireAuth({ auth: anon, pathname: '/', href: '/' })).toBeUndefined()
  })

  it('/welcome is exempt when unauthenticated → public landing, no redirect (landing §1)', async () => {
    const { requireAuth } = await import('./auth-store')
    expect(requireAuth({ auth: anon, pathname: '/welcome', href: '/welcome' })).toBeUndefined()
  })

  it('hard-refresh authenticated after ready → no redirect (audit §3)', async () => {
    const { requireAuth } = await import('./auth-store')
    expect(requireAuth({ auth: authed, pathname: '/', href: '/' })).toBeUndefined()
  })

  it('open-redirect: an absolute return path is clamped to / (CWE-601)', async () => {
    const { requireAuth } = await import('./auth-store')
    expect(requireAuth({ auth: anon, pathname: '/x', href: 'https://evil.example/phish' })).toEqual(
      { to: '/login', search: { redirect: '/' } },
    )
  })
})

describe('sanitizeRedirect (CWE-601 open-redirect defense)', () => {
  it('keeps a same-origin relative path (with query/hash)', async () => {
    const { sanitizeRedirect } = await import('./auth-store')
    expect(sanitizeRedirect('/subjects')).toBe('/subjects')
    expect(sanitizeRedirect('/review?deck=1#top')).toBe('/review?deck=1#top')
  })

  it('rejects anything that could navigate cross-origin → /', async () => {
    const { sanitizeRedirect } = await import('./auth-store')
    expect(sanitizeRedirect('https://example.com/evil-phish')).toBe('/')
    expect(sanitizeRedirect('//example.com')).toBe('/') // protocol-relative
    expect(sanitizeRedirect('/\\example.com')).toBe('/') // backslash trick
    expect(sanitizeRedirect('http://x')).toBe('/')
    expect(sanitizeRedirect('javascript:alert(1)')).toBe('/')
    expect(sanitizeRedirect('subjects')).toBe('/') // no leading slash
    expect(sanitizeRedirect(undefined)).toBe('/')
    expect(sanitizeRedirect(null)).toBe('/')
    expect(sanitizeRedirect('')).toBe('/')
  })
})
