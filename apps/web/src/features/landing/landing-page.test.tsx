// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * Landing render tests (landing spec §5.1). The landing renders bare and its
 * primary CTA points at /login; the FR/EN toggle swaps every string. The
 * anon-vs-authenticated routing decision is proven separately by the `requireAuth`
 * guard unit tests (auth-store.test.ts) and the e2e suites, so here we exercise
 * the presentational component with the REAL i18n + theme providers and mock only
 * the router `Link` (no RouterProvider in a unit test).
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))

import { ThemeProvider } from '@/lib/theme'
import { LangProvider } from '@/lib/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import LandingPage from './landing-page'

function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

/** jsdom's Storage is not fully implemented here — install a tiny in-memory mock. */
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
  installMatchMedia()
  installMockStorage()
})
afterEach(cleanup)

function renderLanding() {
  render(
    <ThemeProvider>
      <LangProvider>
        <TooltipProvider>
          <LandingPage />
        </TooltipProvider>
      </LangProvider>
    </ThemeProvider>,
  )
}

describe('<LandingPage>', () => {
  it('renders the hero as the single <h1> (FR by default)', () => {
    renderLanding()
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]?.textContent).toBe('Retiens plus, en révisant moins.')
  })

  it('every "Se connecter" CTA points at /login', () => {
    renderLanding()
    const ctas = screen.getAllByRole('link', { name: 'Se connecter' })
    expect(ctas.length).toBeGreaterThanOrEqual(2) // header + hero
    for (const cta of ctas) expect(cta.getAttribute('href')).toBe('/login')
  })

  it('the product screenshots carry alt text (a11y)', () => {
    renderLanding()
    // Dark theme by default → the dark WebP, with the localized alt.
    const shot = screen.getByAltText(/Tableau de bord d’engram/)
    expect(shot.getAttribute('src')).toBe('/landing/dashboard-dark.webp')
  })

  it('the footer FR/EN toggle switches every string', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('button', { name: 'en' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Remember more, review less.',
    )
    // The CTA copy follows the language too.
    const ctas = screen.getAllByRole('link', { name: 'Sign in' })
    expect(ctas.length).toBeGreaterThanOrEqual(2)
    for (const cta of ctas) expect(cta.getAttribute('href')).toBe('/login')
  })
})
