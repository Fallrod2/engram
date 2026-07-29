// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

/**
 * 29/07/2026 — the in-app override of `prefers-reduced-motion`.
 *
 * The system preference is the DEFAULT and stays the default; what is tested
 * here is that a user can contradict it on purpose, that doing so touches BOTH
 * mechanisms (the `motion` hook and the `<html>` attribute the CSS block keys
 * off), and that it is reversible — a one-way door would be a worse setting than
 * no setting.
 *
 * `motion/react` is mocked rather than driven through `matchMedia`, because what
 * matters here is the arbitration, not motion's own media-query plumbing.
 */
const system = { reduced: false }
vi.mock('motion/react', () => ({ useReducedMotion: () => system.reduced }))

const {
  DEFAULT_MOTION_PREFERENCE,
  MOTION_ATTRIBUTE,
  initMotionPreference,
  readMotionPreference,
  setMotionPreference,
  useMotionPreference,
  useReducedMotion,
  useSystemPrefersReducedMotion,
} = await import('./motion')

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

beforeEach(() => {
  installMockStorage()
  document.documentElement.removeAttribute(MOTION_ATTRIBUTE)
  system.reduced = false
})
afterEach(cleanup)

describe('motion preference — the stored value', () => {
  it('follows the system when nothing is stored', () => {
    expect(readMotionPreference()).toBe('system')
    expect(DEFAULT_MOTION_PREFERENCE).toBe('system')
  })

  it('ignores a value it does not know', () => {
    localStorage.setItem('engram-motion', 'sparkles')
    expect(readMotionPreference()).toBe('system')
  })

  it('survives storage throwing (private mode)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('nope')
      },
    })
    expect(readMotionPreference()).toBe('system')
    expect(() => setMotionPreference('full')).not.toThrow()
  })
})

describe('motion preference — the CSS half of the override', () => {
  it('stamps <html> only when animations are forced on', () => {
    setMotionPreference('full')
    expect(document.documentElement.getAttribute(MOTION_ATTRIBUTE)).toBe('full')

    // Reversible: back to the system default, the attribute goes and the
    // `@media (prefers-reduced-motion: reduce)` block applies again.
    setMotionPreference('system')
    expect(document.documentElement.hasAttribute(MOTION_ATTRIBUTE)).toBe(false)
  })

  it('re-applies the stored choice on boot, before anything renders', () => {
    localStorage.setItem('engram-motion', 'full')
    initMotionPreference()
    expect(document.documentElement.getAttribute(MOTION_ATTRIBUTE)).toBe('full')
  })

  it('leaves <html> untouched on boot when nothing is stored', () => {
    initMotionPreference()
    expect(document.documentElement.hasAttribute(MOTION_ATTRIBUTE)).toBe(false)
  })
})

describe('motion preference — the JS half of the override', () => {
  it('obeys the system by default', () => {
    system.reduced = true
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it('animates anyway once the user asks for it', () => {
    system.reduced = true
    const { result } = renderHook(() => useReducedMotion())
    act(() => setMotionPreference('full'))
    // No reload, no provider: the store re-renders every subscriber.
    expect(result.current).toBe(false)
  })

  it('goes back to obeying the system when the override is lifted', () => {
    system.reduced = true
    localStorage.setItem('engram-motion', 'full')
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    act(() => setMotionPreference('system'))
    expect(result.current).toBe(true)
  })

  it('changes nothing when the system never asked for less movement', () => {
    system.reduced = false
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    act(() => setMotionPreference('full'))
    expect(result.current).toBe(false)
  })

  it('still reports the RAW system signal, so the UI can stay honest', () => {
    // The settings screen must be able to say "your system asks for less
    // movement" even while the override is on — otherwise the override hides
    // the very preference it is contradicting.
    system.reduced = true
    localStorage.setItem('engram-motion', 'full')
    const { result } = renderHook(() => ({
      effective: useReducedMotion(),
      system: useSystemPrefersReducedMotion(),
      preference: useMotionPreference(),
    }))
    expect(result.current).toEqual({ effective: false, system: true, preference: 'full' })
  })
})
