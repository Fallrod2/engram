// @vitest-environment jsdom
import {
  AuthApiError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
} from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  REFRESH_MARGIN_MS,
  revivalFailureAction,
  shouldRefreshSession,
  watchSessionRevival,
} from './session-refresh'

/**
 * The ~30-minute logout (TODO A-1). jsdom throughout: the decisions are pure and
 * do not need it, but the wiring half of this file dispatches real `focus` /
 * `online` / `visibilitychange` events, and splitting the two across files would
 * hide that they answer the same question.
 */

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0)
/** `expires_at` is SECONDS since the epoch, like every Supabase session. */
const secondsFromNow = (ms: number): number => (NOW + ms) / 1000

describe('shouldRefreshSession — should the app ask for a new token now?', () => {
  it('a fresh token asks for nothing', () => {
    expect(
      shouldRefreshSession({
        expiresAt: secondsFromNow(50 * 60_000),
        nowMs: NOW,
        refreshInFlight: false,
      }),
    ).toBe(false)
  })

  it('a token inside the expiry margin is refreshed', () => {
    expect(
      shouldRefreshSession({
        expiresAt: secondsFromNow(30_000),
        nowMs: NOW,
        refreshInFlight: false,
      }),
    ).toBe(true)
  })

  it('an EXPIRED token is refreshed — the wake-from-sleep case', () => {
    // The whole bug: an hour of machine sleep, the ticker never fired, and the
    // next request would 401 into a sign-out.
    expect(
      shouldRefreshSession({
        expiresAt: secondsFromNow(-45 * 60_000),
        nowMs: NOW,
        refreshInFlight: false,
      }),
    ).toBe(true)
  })

  it('the margin boundary is inclusive, and one ms outside it is not', () => {
    // Pins `<=` against `<`: exactly 90 s of life left is already "refresh it".
    expect(
      shouldRefreshSession({
        expiresAt: secondsFromNow(REFRESH_MARGIN_MS),
        nowMs: NOW,
        refreshInFlight: false,
      }),
    ).toBe(true)
    expect(
      shouldRefreshSession({
        expiresAt: secondsFromNow(REFRESH_MARGIN_MS + 1),
        nowMs: NOW,
        refreshInFlight: false,
      }),
    ).toBe(false)
  })

  it('a refresh already in flight wins over every other reason to refresh', () => {
    for (const expiresAt of [secondsFromNow(-60_000), secondsFromNow(1_000)]) {
      expect(shouldRefreshSession({ expiresAt, nowMs: NOW, refreshInFlight: true })).toBe(false)
    }
  })

  it('no session → nothing to revive', () => {
    for (const expiresAt of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shouldRefreshSession({ expiresAt, nowMs: NOW, refreshInFlight: false })).toBe(false)
    }
  })
})

describe('revivalFailureAction — what a failed refresh means', () => {
  const dead = new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found')

  it('a definitive failure on an already-expired token ends the session', () => {
    expect(
      revivalFailureAction({ error: dead, expiresAt: secondsFromNow(-60_000), nowMs: NOW }),
    ).toBe('sign-out')
  })

  it('offline is never a reason to sign someone out', () => {
    expect(
      revivalFailureAction({
        error: new AuthRetryableFetchError('Failed to fetch', 0),
        expiresAt: secondsFromNow(-60_000),
        nowMs: NOW,
      }),
    ).toBe('wait')
  })

  it('a refresh discarded by the commit guard is another tab winning, not a logout', () => {
    expect(
      revivalFailureAction({
        error: new AuthRefreshDiscardedError(),
        expiresAt: secondsFromNow(-60_000),
        nowMs: NOW,
      }),
    ).toBe('wait')
  })

  it('a definitive failure on a token that is STILL VALID keeps the session', () => {
    // Proactive-preserve: we asked early (inside the margin) and were refused.
    // The token has 30 s of life left — spending them is strictly better than
    // logging the user out mid-review.
    expect(
      revivalFailureAction({ error: dead, expiresAt: secondsFromNow(30_000), nowMs: NOW }),
    ).toBe('wait')
  })

  it('expiry exactly now counts as expired', () => {
    expect(revivalFailureAction({ error: dead, expiresAt: secondsFromNow(0), nowMs: NOW })).toBe(
      'sign-out',
    )
  })

  it('a definitive failure with no session left to inspect ends it', () => {
    expect(revivalFailureAction({ error: dead, expiresAt: null, nowMs: NOW })).toBe('sign-out')
  })
})

describe('watchSessionRevival — the events a timer cannot see', () => {
  const detachers: Array<() => void> = []

  afterEach(() => {
    while (detachers.length > 0) detachers.pop()!()
  })

  function setVisibility(value: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  }

  type Refresh = () => Promise<{ error: unknown }>

  /** A watcher over a session that expired 45 minutes ago (the wake-up case). */
  function watchExpired(refresh: Refresh = vi.fn<Refresh>().mockResolvedValue({ error: null })) {
    const signOut = vi.fn()
    detachers.push(
      watchSessionRevival({
        sessionExpiresAt: () => (Date.now() - 45 * 60_000) / 1000,
        refresh,
        signOut,
      }),
    )
    return { refresh, signOut }
  }

  it('window focus on an expired session refreshes it', () => {
    setVisibility('visible')
    const { refresh } = watchExpired()
    window.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('visibilitychange back to visible refreshes it', () => {
    setVisibility('visible')
    const { refresh } = watchExpired()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('going HIDDEN refreshes nothing', () => {
    setVisibility('hidden')
    const { refresh } = watchExpired()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('coming back online refreshes it', () => {
    setVisibility('visible')
    const { refresh } = watchExpired()
    window.dispatchEvent(new Event('online'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('a fresh session is left alone by every event', () => {
    setVisibility('visible')
    const refresh = vi.fn().mockResolvedValue({ error: null })
    detachers.push(
      watchSessionRevival({
        sessionExpiresAt: () => (Date.now() + 50 * 60_000) / 1000,
        refresh,
        signOut: vi.fn(),
      }),
    )
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('attaching alone refreshes nothing — the mount observes, it does not write', () => {
    setVisibility('visible')
    const { refresh, signOut } = watchExpired()
    expect(refresh).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('a burst of revival events fires ONE refresh', async () => {
    // macOS wake dispatches focus and visibilitychange in the same task, and a
    // reconnect adds `online`. Three triggers, one token exchange.
    setVisibility('visible')
    let settle!: (value: { error: unknown }) => void
    const refresh = vi.fn(
      () =>
        new Promise<{ error: unknown }>((resolve) => {
          settle = resolve
        }),
    )
    watchExpired(refresh)
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    expect(refresh).toHaveBeenCalledTimes(1)
    // Once it settles the gate reopens — a later wake-up is still handled.
    settle({ error: null })
    await vi.waitFor(() => {
      window.dispatchEvent(new Event('focus'))
      expect(refresh).toHaveBeenCalledTimes(2)
    })
  })

  it('a dead refresh token on an expired session signs the user out', async () => {
    setVisibility('visible')
    const { signOut } = watchExpired(
      vi.fn().mockResolvedValue({
        error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
      }),
    )
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
  })

  it('a network failure does NOT sign the user out', async () => {
    setVisibility('visible')
    const refresh = vi
      .fn()
      .mockResolvedValue({ error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { signOut } = watchExpired(refresh)
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(signOut).not.toHaveBeenCalled()
  })

  it('a THROWN refresh does not sign the user out, and reopens the gate', async () => {
    setVisibility('visible')
    const refresh = vi.fn().mockRejectedValue(new Error('storage lock timeout'))
    const { signOut } = watchExpired(refresh)
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(signOut).not.toHaveBeenCalled()
    // The in-flight flag must be cleared even on the throwing path, or the
    // watcher would be wedged shut for the rest of the page's life.
    await vi.waitFor(() => {
      window.dispatchEvent(new Event('focus'))
      expect(refresh).toHaveBeenCalledTimes(2)
    })
  })

  it('a successful refresh signs nobody out', async () => {
    setVisibility('visible')
    const { refresh, signOut } = watchExpired()
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(signOut).not.toHaveBeenCalled()
  })

  it('the detacher removes all three listeners', () => {
    setVisibility('visible')
    const refresh = vi.fn().mockResolvedValue({ error: null })
    const detach = watchSessionRevival({
      sessionExpiresAt: () => (Date.now() - 60_000) / 1000,
      refresh,
      signOut: vi.fn(),
    })
    detach()
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()
  })
})
