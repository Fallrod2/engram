// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LangProvider } from '@/lib/i18n'
import { DayLoad } from './day-load'
import { LoadMeter } from './load-meter'

afterEach(cleanup)

/** No engram token is ever red/rating/accent-tinted for load (spec §7.1). */
function assertNeverRedOrAccent(el: HTMLElement) {
  const html = el.outerHTML
  expect(html).not.toContain('bg-danger')
  expect(html).not.toContain('text-danger')
  expect(html).not.toContain('bg-accent')
  expect(html).not.toMatch(/bg-subject-/) // load is monochrome, never a series tint
}

describe('<DayLoad> tiers (spec §7.1)', () => {
  it('renders a retreating `·` in text-faint at zero, no meter', () => {
    const { container } = render(<DayLoad value={0} max={20} />)
    const el = screen.getByLabelText('0 review prévue')
    expect(el.textContent).toBe('·')
    expect(el.className).toContain('text-text-faint')
    expect(container.querySelector('.bg-surface-3')).toBeNull()
    assertNeverRedOrAccent(el)
  })

  it('renders the number in text-muted for the low tier (1–20) with a meter', () => {
    const { container } = render(<DayLoad value={12} max={40} />)
    const wrapper = screen.getByLabelText('12 reviews prévues')
    expect(wrapper.firstElementChild?.textContent).toBe('12')
    expect((wrapper.firstElementChild as HTMLElement).className).toContain('text-text-muted')
    expect(container.querySelector('.bg-surface-3')).not.toBeNull()
    assertNeverRedOrAccent(container.firstElementChild as HTMLElement)
  })

  it('renders the number in primary text for higher tiers', () => {
    render(<DayLoad value={35} max={40} />)
    const number = screen.getByLabelText('35 reviews prévues').firstElementChild as HTMLElement
    expect(number.className).toContain('text-text')
    expect(number.className).not.toContain('text-text-muted')
  })
})

/**
 * At the zero tier the cell is a bare `·`, so the accessible name is the only
 * thing a screen reader gets. It used to be hardcoded French with a hand-rolled
 * plural — the same defect as `<StreakPill>` / `<ThemeToggle>`, and the one the
 * source guard (`a11y-strings.test.ts`) now prevents from coming back.
 */
describe('<DayLoad> accessible name is localized and pluralised', () => {
  // jsdom's Storage is not fully implemented here — same in-memory shim the
  // other shell tests install. `<LangProvider>` reads the language from it.
  beforeEach(() => {
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
  })

  function renderLoad(value: number, lang: 'fr' | 'en') {
    localStorage.setItem('engram-lang', lang)
    return render(
      <LangProvider>
        <DayLoad value={value} max={40} />
      </LangProvider>,
    )
  }

  it('keeps the French zero singular', () => {
    renderLoad(0, 'fr')
    expect(screen.getByLabelText('0 review prévue')).toBeTruthy()
  })

  it('says it in English when the UI is English — including a plural zero', () => {
    const zero = renderLoad(0, 'en')
    expect(screen.getByLabelText('0 reviews scheduled')).toBeTruthy()
    zero.unmount()

    const one = renderLoad(1, 'en')
    expect(screen.getByLabelText('1 review scheduled')).toBeTruthy()
    one.unmount()

    renderLoad(12, 'en')
    expect(screen.getByLabelText('12 reviews scheduled')).toBeTruthy()
  })
})

describe('<LoadMeter> length (spec §7.1)', () => {
  it('fills proportionally, clamped at 100%, monochrome', () => {
    const { container, rerender } = render(<LoadMeter value={10} max={40} />)
    const fill = () => container.querySelector('.bg-text-faint') as HTMLElement
    expect(fill().style.width).toBe('25%')
    rerender(<LoadMeter value={80} max={40} />)
    expect(fill().style.width).toBe('100%')
    assertNeverRedOrAccent(container.firstElementChild as HTMLElement)
  })

  it('is empty (0%) when max is zero', () => {
    const { container } = render(<LoadMeter value={5} max={0} />)
    expect((container.querySelector('.bg-text-faint') as HTMLElement).style.width).toBe('0%')
  })
})
