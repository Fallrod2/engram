// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { localDayKey } from '@/lib/calendar'
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
