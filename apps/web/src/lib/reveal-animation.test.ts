// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  DEFAULT_REVEAL_ANIMATION,
  readRevealAnimation,
  REVEAL_ANIMATIONS,
  setRevealAnimation,
  useRevealAnimation,
} from './reveal-animation'

/**
 * T-046 — the reveal preference store.
 *
 * Same contract as `engram-theme` and `engram-lang`: one `localStorage` key, a
 * default when nothing usable is stored, and the change visible without a
 * reload. What this file pins is the part a store gets wrong silently — an
 * unknown value crashing or being handed through to the renderer, and a write
 * that persists but does not re-render (or re-renders but does not persist).
 */

const KEY = 'engram-reveal'

/**
 * jsdom here exposes no usable `localStorage` (Node's own experimental global
 * shadows it and reads back `undefined`), so the suite installs one — same
 * helper as `components/not-found.test.tsx` and `shell/theme-toggle.test.tsx`,
 * the other two places that test a stored preference.
 */
function installMockStorage() {
  const store = new Map<string, string>()
  const mock: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true })
}

beforeEach(installMockStorage)
afterEach(() => localStorage.clear())

describe('the stored value', () => {
  it('defaults to the unfold when nothing is stored', () => {
    expect(readRevealAnimation()).toBe('unfold')
    expect(DEFAULT_REVEAL_ANIMATION).toBe('unfold')
  })

  it('reads back every value it can write', () => {
    for (const value of REVEAL_ANIMATIONS) {
      setRevealAnimation(value)
      expect(localStorage.getItem(KEY)).toBe(value)
      expect(readRevealAnimation()).toBe(value)
    }
  })

  it('falls back to the default on a value it does not know', () => {
    // A stale key from a future/older build, or a user poking at devtools. It
    // must not reach the card, which switches on the union exhaustively.
    localStorage.setItem(KEY, 'flip3d-spectacular')
    expect(readRevealAnimation()).toBe(DEFAULT_REVEAL_ANIMATION)
  })

  it('stores under the same namespace as the other preferences', () => {
    // `engram-theme`, `engram-lang`, `engram-reveal` — one convention, so the
    // whole preference set is greppable and clearable in one go.
    expect(KEY.startsWith('engram-')).toBe(true)
  })
})

describe('useRevealAnimation', () => {
  it('reflects what is already stored on the first render', () => {
    localStorage.setItem(KEY, 'flip')
    const { result } = renderHook(() => useRevealAnimation())
    expect(result.current).toBe('flip')
  })

  it('re-renders every subscriber on a write — no reload, no provider', () => {
    // Two independent hooks, no shared tree: the settings control and the review
    // session never share one (the session renders through a body portal). A
    // context-free store is only correct if BOTH see the write.
    const a = renderHook(() => useRevealAnimation())
    const b = renderHook(() => useRevealAnimation())
    expect(a.result.current).toBe('unfold')

    act(() => setRevealAnimation('none'))
    expect(a.result.current).toBe('none')
    expect(b.result.current).toBe('none')

    act(() => setRevealAnimation('flip'))
    expect(a.result.current).toBe('flip')
    expect(b.result.current).toBe('flip')
  })

  it('stops notifying a subscriber once it unmounts', () => {
    const { result, unmount } = renderHook(() => useRevealAnimation())
    unmount()
    // No throw, no "update on an unmounted component": the subscription is
    // removed by the teardown `subscribe` returns.
    act(() => setRevealAnimation('flip'))
    expect(result.current).toBe('unfold')
  })
})
