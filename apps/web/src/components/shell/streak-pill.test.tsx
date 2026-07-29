// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { localDayKey } from '@/lib/calendar'
import { LangProvider, type Lang } from '@/lib/i18n'
import { StreakPill } from './streak-pill'

const SEEN_KEY = 'engram-streak-seen-day'

// jsdom's Storage is not fully implemented here — install a tiny in-memory mock.
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

afterEach(cleanup)
beforeEach(() => installMockStorage())

describe('<StreakPill> (spec §5.3bis)', () => {
  it('renders the real current streak in mono', () => {
    render(<StreakPill current={14} includesToday />)
    expect(screen.getByText('14')).toBeTruthy()
    expect(screen.getByLabelText('Série de 14 jours')).toBeTruthy()
  })

  it('marks the breath as seen for today when the goal is reached (anti-replay)', () => {
    render(<StreakPill current={3} includesToday />)
    expect(localStorage.getItem(SEEN_KEY)).toBe(localDayKey(new Date()))
  })

  it('does not arm the breath when today is not yet included', () => {
    render(<StreakPill current={5} includesToday={false} />)
    expect(localStorage.getItem(SEEN_KEY)).toBeNull()
  })
})

/**
 * Collapsed, the pill is a bare flame with no digits: its accessible name is the
 * ONLY place the streak is spoken. It was hardcoded French with a hand-rolled
 * `s`, wrong twice over — an English user heard French, and `count > 1` gets
 * FR's zero wrong. These cases pin BOTH the language and the CLDR plural rule
 * (FR: 0 and 1 singular; EN: only 1).
 */
describe('<StreakPill> accessible name is localized and correctly pluralised', () => {
  function renderPill(current: number, lang: Lang) {
    localStorage.setItem('engram-lang', lang)
    return render(
      <LangProvider>
        <StreakPill current={current} includesToday={false} collapsed />
      </LangProvider>,
    )
  }

  it('keeps 0 and 1 singular in French, and says it in French', () => {
    const zero = renderPill(0, 'fr')
    expect(screen.getByLabelText('Série de 0 jour')).toBeTruthy()
    zero.unmount()

    const one = renderPill(1, 'fr')
    expect(screen.getByLabelText('Série de 1 jour')).toBeTruthy()
    one.unmount()

    renderPill(4, 'fr')
    expect(screen.getByLabelText('Série de 4 jours')).toBeTruthy()
  })

  it('puts 0 in the plural in English, and 1 alone in the singular', () => {
    const zero = renderPill(0, 'en')
    expect(screen.getByLabelText('Streak of 0 days')).toBeTruthy()
    zero.unmount()

    const one = renderPill(1, 'en')
    expect(screen.getByLabelText('Streak of 1 day')).toBeTruthy()
    one.unmount()

    renderPill(4, 'en')
    expect(screen.getByLabelText('Streak of 4 days')).toBeTruthy()
  })

  it('localizes the mouse tooltip too — no French left in an English UI', () => {
    renderPill(7, 'en')
    const pill = screen.getByLabelText('Streak of 7 days')
    expect(pill.getAttribute('title')).toBe('Streak: 7d')
    expect(pill.getAttribute('title')).not.toMatch(/Série/)
  })
})
