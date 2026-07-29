// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * 29/07/2026 — the settings row has to stay HONEST about three different situations
 * that the switch position alone cannot tell apart:
 *
 *   · the system asked for less movement and the app obeyed (switch off);
 *   · the system asked for less movement and the user overrode it (switch on);
 *   · the system asked for nothing, so the switch changes nothing today.
 *
 * The middle one is the reason the override is allowed at all: contradicting an
 * accessibility preference is acceptable when it is deliberate and stated, and
 * unacceptable when it is silent. This file is what keeps it stated.
 */
const system = { reduced: false }
vi.mock('motion/react', () => ({ useReducedMotion: () => system.reduced }))

const { MotionRow } = await import('./motion-row')
const { readMotionPreference } = await import('@/lib/motion')

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
  system.reduced = false
  document.documentElement.removeAttribute('data-motion')
})
afterEach(cleanup)

describe('<MotionRow> — what it says', () => {
  it('says the app HAS cut its animations when the system asks for it', () => {
    system.reduced = true
    render(<MotionRow />)
    expect(screen.getByText(/l’app les a coupées/)).toBeTruthy()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('says the choice is the user’s once it has been made', () => {
    system.reduced = true
    localStorage.setItem('engram-motion', 'full')
    render(<MotionRow />)
    // The system preference is still named: the override does not hide the
    // thing it contradicts.
    expect(screen.getByText(/tu as choisi de les garder/)).toBeTruthy()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('says the switch changes nothing when the system asks for nothing', () => {
    system.reduced = false
    render(<MotionRow />)
    expect(screen.getByText(/ne demande aucune réduction/)).toBeTruthy()
  })
})

describe('<MotionRow> — what it does', () => {
  it('stores the override and stamps <html> in one gesture', () => {
    system.reduced = true
    render(<MotionRow />)
    fireEvent.click(screen.getByRole('switch'))
    expect(readMotionPreference()).toBe('full')
    // The CSS half: without this attribute the `@media (prefers-reduced-motion)`
    // block would keep clamping every animation to 0.01ms and half the app
    // would stay still with the switch on.
    expect(document.documentElement.getAttribute('data-motion')).toBe('full')
    expect(screen.getByText(/tu as choisi de les garder/)).toBeTruthy()
  })

  it('is reversible — the switch goes back to following the system', () => {
    system.reduced = true
    localStorage.setItem('engram-motion', 'full')
    render(<MotionRow />)
    fireEvent.click(screen.getByRole('switch'))
    expect(readMotionPreference()).toBe('system')
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false)
  })

  it('names what it does, for the keyboard and the screen reader', () => {
    render(<MotionRow />)
    // The label is wired to the control (`htmlFor`/`id`), so the accessible name
    // is the sentence and not "switch".
    expect(screen.getByRole('switch', { name: 'Toujours animer' })).toBeTruthy()
  })
})
