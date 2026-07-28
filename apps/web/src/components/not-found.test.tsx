// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const back = vi.fn()
// Plain anchor + a stub history, so no RouterProvider is needed here.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ history: { back } }),
}))

import { LangProvider } from '@/lib/i18n'
import { NotFoundScreen } from './not-found'

/** jsdom here exposes no usable `localStorage`; `LangProvider` reads and writes it. */
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
beforeEach(() => {
  back.mockClear()
  installMockStorage()
  document.title = 'engram'
})

function renderScreen(lang?: 'fr' | 'en') {
  if (!lang) return render(<NotFoundScreen />)
  localStorage.setItem('engram-lang', lang)
  return render(
    <LangProvider>
      <NotFoundScreen />
    </LangProvider>,
  )
}

/**
 * T-028 (b). The router's built-in fallback was the bare string "Not Found":
 * untranslated, unstyled, no exit, and the page kept the marketing title.
 */
describe('<NotFoundScreen>', () => {
  it('speaks French by default and offers a way back into the app', () => {
    renderScreen()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cette page n’existe pas.')
    const home = screen.getByRole('link', { name: 'Retour au tableau de bord' })
    expect(home.getAttribute('href')).toBe('/')
    expect(screen.queryByText('Not Found')).toBeNull()
  })

  it('is fully translated in English — no French leaks through', () => {
    renderScreen('en')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This page does not exist.')
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeTruthy()
  })

  it('names the failure in the document title instead of inheriting "engram"', () => {
    renderScreen()
    expect(document.title).toBe('Page introuvable · engram')
  })

  it('sends the visitor back through the router history', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Page précédente' }))
    expect(back).toHaveBeenCalledTimes(1)
  })
})
