// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LangProvider } from '@/lib/i18n'
import { SubjectsUnavailableNotice } from './subjects-unavailable-notice'

/**
 * T-066 — the planning screen's share of the adjacent motif, and the one case
 * in the lot that is NOT a skeleton: `subjectsById(subjectsQuery.data)` on a
 * failed read is an empty Map, and every consumer of that Map already handles a
 * missing entry gracefully. So nothing shimmered and nothing blanked — the
 * screen simply renamed every subject to "Matière", dropped the exam dots, and
 * said nothing at all. Silent degradation, which is the same defect wearing
 * politer clothes.
 */

afterEach(cleanup)

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

describe('<SubjectsUnavailableNotice>', () => {
  it('names what is missing rather than what broke', () => {
    render(<SubjectsUnavailableNotice onRetry={() => {}} />)
    // Not "an error occurred": the user's question is why the names went away.
    expect(
      screen.getByText('Matières indisponibles : les noms et les couleurs peuvent manquer.'),
    ).toBeTruthy()
  })

  it('is announced, so a screen reader is told too', () => {
    render(<SubjectsUnavailableNotice onRetry={() => {}} />)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('asks the query again — it does not reload the page', () => {
    const onRetry = vi.fn()
    render(<SubjectsUnavailableNotice onRetry={onRetry} />)
    screen.getByText('Réessayer').click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('carries no French when the UI is English', () => {
    installMockStorage()
    localStorage.setItem('engram-lang', 'en')
    render(
      <LangProvider>
        <SubjectsUnavailableNotice onRetry={() => {}} />
      </LangProvider>,
    )
    expect(screen.getByText('Subjects unavailable: names and colours may be missing.')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
  })
})
