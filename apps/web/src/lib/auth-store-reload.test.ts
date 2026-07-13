// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression guard for the invite/recovery RELOAD bypass (blocking review finding).
 *
 * A page refresh mid-onboarding (before the password is submitted) must NOT let the
 * persisted recovery session rehydrate as a normal login. This needs a real
 * `localStorage`, so the file runs under jsdom (the sibling `auth-store.test.ts`
 * runs under node where the setup marker is a no-op). jsdom's own `localStorage` is
 * an inert `{}`, so we install a Map-backed Storage stub per test. Each case
 * re-imports the store with a fresh mock of `@/lib/supabase`.
 */
const LINK_SETUP_STORAGE_KEY = 'engram-auth-link'

function installStorage(): void {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
}

beforeEach(() => {
  installStorage()
})

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('@/lib/supabase')
})

function mockSupabaseWithSession(session: unknown, extra: Record<string, unknown> = {}) {
  vi.doMock('@/lib/supabase', () => ({
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session } }),
        onAuthStateChange: vi
          .fn()
          .mockReturnValue({ data: { subscription: { unsubscribe() {} } } }),
        signOut: vi.fn(),
        ...extra,
      },
    },
    AUTH_ENABLED_WEB: true,
  }))
}

describe('auth-store — invite/recovery reload persistence', () => {
  it('marker + live session on reload → re-enters the setup gate (no bypass)', async () => {
    // A prior load established the invite session and persisted the marker; the URL
    // tokens are long gone, so `captureAuthLink` finds nothing this load.
    window.localStorage.setItem(LINK_SETUP_STORAGE_KEY, 'invite')
    mockSupabaseWithSession({ access_token: 'persisted', user: { email: 'invited@x.co' } })
    const store = await import('./auth-store')
    await store.init()
    expect(store.getLinkState()).toEqual({ kind: 'setup', linkType: 'invite' })
    expect(store.isPasswordSetupPending()).toBe(true)
    // Authenticated for `updateUser`, but the root guard still forces /set-password.
    expect(store.getState().status).toBe('authenticated')
  })

  it('live session with NO marker → normal login (no spurious setup gate)', async () => {
    mockSupabaseWithSession({ access_token: 'normal', user: { email: 'a@b.co' } })
    const store = await import('./auth-store')
    await store.init()
    expect(store.getLinkState()).toEqual({ kind: 'none' })
    expect(store.getState().status).toBe('authenticated')
  })

  it('stale marker with no session → marker dropped, unauthenticated', async () => {
    window.localStorage.setItem(LINK_SETUP_STORAGE_KEY, 'recovery')
    mockSupabaseWithSession(null)
    const store = await import('./auth-store')
    await store.init()
    expect(store.getLinkState()).toEqual({ kind: 'none' })
    expect(store.getState().status).toBe('unauthenticated')
    expect(window.localStorage.getItem(LINK_SETUP_STORAGE_KEY)).toBeNull()
  })

  it('captured link persists the marker; clearLinkState (password set) removes it', async () => {
    const session = { access_token: 'newtok', user: { email: 'invited@x.co' } }
    const setSession = vi.fn().mockResolvedValue({ data: { session }, error: null })
    mockSupabaseWithSession(null, { setSession })
    const store = await import('./auth-store')
    store.captureAuthLink({ hash: '#access_token=at&refresh_token=rt&type=invite', search: '' })
    await store.init()
    expect(window.localStorage.getItem(LINK_SETUP_STORAGE_KEY)).toBe('invite')
    store.clearLinkState()
    expect(window.localStorage.getItem(LINK_SETUP_STORAGE_KEY)).toBeNull()
    expect(store.getLinkState()).toEqual({ kind: 'none' })
  })
})
