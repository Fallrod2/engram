// @vitest-environment jsdom
import { AuthApiError } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The store is actually WIRED to the revival watcher (TODO A-1).
 *
 * `session-refresh.test.ts` proves the watcher decides and dispatches correctly;
 * nothing in it would notice if `init()` simply never called it — which is the
 * only mistake that would leave the ~30-minute logout exactly as it was. This
 * file asserts the join: after `init()`, a real `focus` event on an expired
 * session reaches `supabase.auth.refreshSession`.
 *
 * jsdom for `window`/`document`. Each case re-imports the store with a fresh
 * mock of `@/lib/supabase`; listeners left behind by a previous module instance
 * are harmless because each one only ever calls the mocks it captured.
 */

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('@/lib/supabase')
})

/** A session whose access token died 45 minutes ago (machine slept). */
function expiredSession() {
  return {
    access_token: 'stale',
    refresh_token: 'rt',
    expires_at: Math.floor((Date.now() - 45 * 60_000) / 1000),
    user: { email: 'alex@example.com' },
  }
}

function mockSupabase(session: unknown, refreshSession: ReturnType<typeof vi.fn>) {
  const signOut = vi.fn().mockResolvedValue({ error: null })
  vi.doMock('@/lib/supabase', () => ({
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session } }),
        onAuthStateChange: vi
          .fn()
          .mockReturnValue({ data: { subscription: { unsubscribe() {} } } }),
        refreshSession,
        signOut,
      },
    },
    AUTH_ENABLED_WEB: true,
  }))
  return { signOut }
}

describe('auth-store — session revival is wired to init()', () => {
  it('focus with an expired session calls refreshSession()', async () => {
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
    mockSupabase(expiredSession(), refreshSession)
    const store = await import('./auth-store')
    await store.init()
    expect(refreshSession).not.toHaveBeenCalled() // init() alone writes nothing
    window.dispatchEvent(new Event('focus'))
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('a fresh session is not refreshed on focus', async () => {
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
    mockSupabase(
      { ...expiredSession(), expires_at: Math.floor((Date.now() + 50 * 60_000) / 1000) },
      refreshSession,
    )
    const store = await import('./auth-store')
    await store.init()
    window.dispatchEvent(new Event('focus'))
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('signed out: no session, nothing to revive', async () => {
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
    mockSupabase(null, refreshSession)
    const store = await import('./auth-store')
    await store.init()
    window.dispatchEvent(new Event('focus'))
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('a dead refresh token routes to the ordinary signed-out effect (→ /login)', async () => {
    const refreshSession = vi.fn().mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    })
    const { signOut } = mockSupabase(expiredSession(), refreshSession)
    const store = await import('./auth-store')
    await store.init()
    const onSignedOut = vi.fn()
    store.setOnSignedOut(onSignedOut)
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1))
    expect(store.getState().status).toBe('unauthenticated')
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
