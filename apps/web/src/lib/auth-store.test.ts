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

  it('hard-refresh authenticated after ready → no redirect (audit §3)', async () => {
    const { requireAuth } = await import('./auth-store')
    expect(requireAuth({ auth: authed, pathname: '/', href: '/' })).toBeUndefined()
  })
})
