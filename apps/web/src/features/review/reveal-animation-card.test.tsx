// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readRevealAnimation } from '@/lib/reveal-animation'
import { dictEn } from '@/lib/i18n/dict.en'
import { dictFr } from '@/lib/i18n/dict.fr'

/**
 * T-046 — the settings control.
 *
 * Three things it must not get wrong, in order of how badly they read as a bug:
 *   1. the reduced-motion notice — without it the setting looks broken to
 *      exactly the users whose system is overriding it;
 *   2. the write reaching the store (the session reads it from there, not from
 *      a prop);
 *   3. one tab stop, arrows inside — a three-value choice must not cost three
 *      tabs on the way to the next control.
 *
 * `useReducedMotion` is mocked per block rather than through `matchMedia`:
 * jsdom's `matchMedia` is a stub with no listener plumbing, and what is under
 * test here is the branch, not motion's own media-query reading.
 */

const reduced = vi.hoisted(() => ({ value: false }))
vi.mock('motion/react', () => ({ useReducedMotion: () => reduced.value }))

const { RevealAnimationCard } = await import('./reveal-animation-card')

const FR = dictFr.settings.reveal

/**
 * jsdom here exposes no usable `localStorage` (Node's own experimental global
 * shadows it and reads back `undefined`) — same helper, same reason, as
 * `components/not-found.test.tsx` and `lib/reveal-animation.test.ts`.
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

beforeEach(() => {
  reduced.value = false
  installMockStorage()
})
afterEach(cleanup)

describe('<RevealAnimationCard>', () => {
  it('offers the three values, each with a sentence saying what it does', () => {
    render(<RevealAnimationCard />)
    const group = screen.getByRole('radiogroup', { name: FR.title })
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(3)
    const rows: [string, string][] = [
      [FR.unfold, FR.unfoldDesc],
      [FR.flip, FR.flipDesc],
      [FR.none, FR.noneDesc],
    ]
    for (const [label, desc] of rows) {
      // The label alone ("Retournement") teaches nobody anything — the reason
      // this is a radiogroup and not a <Select>.
      expect(screen.getByText(label)).toBeTruthy()
      expect(screen.getByText(desc)).toBeTruthy()
    }
  })

  it('shows the stored choice as the checked radio', () => {
    localStorage.setItem('engram-reveal', 'flip')
    render(<RevealAnimationCard />)
    expect(screen.getByRole('radio', { checked: true }).textContent).toContain(FR.flip)
  })

  it('writes the pick to the store and updates in place', () => {
    render(<RevealAnimationCard />)
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(FR.flip) }))
    // Persisted (the session reads the store, not this component) AND reflected
    // without a reload — the requirement the theme/lang preferences also meet.
    expect(readRevealAnimation()).toBe('flip')
    expect(screen.getByRole('radio', { checked: true }).textContent).toContain(FR.flip)
  })

  it('is one tab stop, with arrows moving and selecting inside it', () => {
    render(<RevealAnimationCard />)
    const radios = screen.getAllByRole('radio')
    expect(radios.filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1)

    fireEvent.keyDown(radios[0]!, { key: 'ArrowDown' })
    expect(readRevealAnimation()).toBe('flip')
    fireEvent.keyDown(screen.getAllByRole('radio')[1]!, { key: 'End' })
    expect(readRevealAnimation()).toBe('none')
    // Wraps, like every other radiogroup in the app (`window-filter.tsx`).
    fireEvent.keyDown(screen.getAllByRole('radio')[2]!, { key: 'ArrowDown' })
    expect(readRevealAnimation()).toBe('unfold')
  })

  it('says nothing about reduced motion when the system has not asked for it', () => {
    render(<RevealAnimationCard />)
    expect(screen.queryByText(FR.reducedNotice)).toBeNull()
  })

  it('says the system is overriding the choice when it is', () => {
    reduced.value = true
    localStorage.setItem('engram-reveal', 'flip')
    render(<RevealAnimationCard />)
    expect(screen.getByText(FR.reducedNotice)).toBeTruthy()
    // NOT disabled: the choice stays the user's and applies again the day the
    // system preference goes. Greying it out would say "you may not choose",
    // which is not what is happening.
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLButtonElement).disabled).toBe(false)
    }
    expect(screen.getByRole('radio', { checked: true }).textContent).toContain(FR.flip)
  })
})

describe('i18n', () => {
  it('translates every string of the block in both languages', () => {
    // No exception to the FR/EN rule, and no key that exists on one side only —
    // a missing key renders its own dot-path in the UI.
    const fr = Object.entries(dictFr.settings.reveal)
    const en = Object.entries(dictEn.settings.reveal)
    expect(en.map(([k]) => k).sort()).toEqual(fr.map(([k]) => k).sort())
    for (const [key, value] of [...fr, ...en]) {
      expect(typeof value, key).toBe('string')
      expect((value as string).trim().length, key).toBeGreaterThan(0)
    }
    // …and actually translated, not copied across.
    expect(dictEn.settings.reveal.title).not.toBe(dictFr.settings.reveal.title)
    expect(dictEn.settings.reveal.flipDesc).not.toBe(dictFr.settings.reveal.flipDesc)
  })
})
