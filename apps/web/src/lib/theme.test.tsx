// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { ThemeProvider, useTheme } from './theme'

/**
 * 29/07/2026 — the theme follows the system, and an explicit choice is never
 * overwritten.
 *
 * The trap this file exists for: the provider used to persist its resolved
 * preference on MOUNT, so the first paint wrote `engram-theme=dark` for
 * everybody. With that write in place, "follow the system by default" would have
 * been a lie for every user who had ever opened the app — they all carry a
 * stored value they never chose. The write is gone; these cases pin that it
 * stays gone, and that a real choice still outranks the system.
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

/** A `prefers-color-scheme` mock whose answer can change, listeners and all. */
function installMatchMedia(initialDark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  let dark = initialDark
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return dark && query.includes('prefers-color-scheme: dark')
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => void listeners.add(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) =>
        void listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
  return {
    /** The OS flips — sunset, or the user toggling their own settings. */
    set(next: boolean) {
      dark = next
      for (const fn of [...listeners]) fn({ matches: next } as MediaQueryListEvent)
    },
  }
}

function renderTheme() {
  return renderHook(() => useTheme(), { wrapper: ThemeProvider })
}

beforeEach(() => {
  installMockStorage()
  document.documentElement.removeAttribute('data-theme')
})
afterEach(cleanup)

describe('theme — no stored value means no choice', () => {
  it('follows the system when nothing is stored', () => {
    installMatchMedia(false)
    const { result } = renderTheme()
    expect(result.current.theme).toBe('system')
    expect(result.current.resolved).toBe('light')
    // No `data-theme` on <html>: the CSS `prefers-color-scheme` fallback is what
    // paints, which is also what makes the live switch free.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('writes NOTHING to storage just by mounting', () => {
    // The whole premise of "an explicit choice is never overwritten" is that a
    // stored value means somebody chose. Mounting is not choosing.
    installMatchMedia(true)
    renderTheme()
    expect(localStorage.getItem('engram-theme')).toBeNull()
  })

  it('ignores a value it does not understand', () => {
    installMatchMedia(true)
    localStorage.setItem('engram-theme', 'sepia')
    const { result } = renderTheme()
    expect(result.current.theme).toBe('system')
  })
})

describe('theme — an explicit choice outranks the system', () => {
  it('keeps a stored dark against a light system', () => {
    installMatchMedia(false)
    localStorage.setItem('engram-theme', 'dark')
    const { result } = renderTheme()
    expect(result.current.theme).toBe('dark')
    expect(result.current.resolved).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('persists a choice made from Settings', () => {
    installMatchMedia(true)
    const { result } = renderTheme()
    act(() => result.current.setTheme('light'))
    expect(localStorage.getItem('engram-theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('persists the shell toggle too — it is a choice, made elsewhere', () => {
    installMatchMedia(true)
    const { result } = renderTheme()
    act(() => result.current.toggle())
    expect(result.current.theme).toBe('light')
    expect(localStorage.getItem('engram-theme')).toBe('light')
  })

  it('lets the user go back to following the system', () => {
    // A setting you cannot leave is a one-way door. « Système » has to be
    // reachable again after picking a colour, and it has to actually release
    // the attribute.
    installMatchMedia(false)
    localStorage.setItem('engram-theme', 'dark')
    const { result } = renderTheme()
    act(() => result.current.setTheme('system'))
    expect(localStorage.getItem('engram-theme')).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(result.current.resolved).toBe('light')
  })
})

describe('theme — following the system means following it live', () => {
  it('flips with the OS, without a reload', () => {
    const media = installMatchMedia(false)
    const { result } = renderTheme()
    expect(result.current.resolved).toBe('light')
    act(() => media.set(true))
    expect(result.current.resolved).toBe('dark')
  })

  it('does not flip when a colour was chosen explicitly', () => {
    const media = installMatchMedia(false)
    localStorage.setItem('engram-theme', 'light')
    const { result } = renderTheme()
    act(() => media.set(true))
    expect(result.current.resolved).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
