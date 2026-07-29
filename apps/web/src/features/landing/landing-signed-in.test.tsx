// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The landing seen BY A SIGNED-IN VISITOR. It is reachable with a session now
 * (Réglages → À propos, ⌘K, or a direct `/welcome`), so the page must stop
 * selling an account to someone who already has one, and must offer the way back
 * into the app — otherwise the only exit is the browser's Back button or a
 * sign-out round trip.
 *
 * Companion to `landing-page.test.tsx`, which covers the anonymous page; the
 * session status is the single difference, so it is mocked here rather than
 * driving the real store through a login.
 */
vi.mock('@/lib/auth', () => ({ useAuthStatus: () => 'authenticated' }))

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))

const { fetchHealth, createDemoSession } = vi.hoisted(() => ({
  fetchHealth: vi.fn(),
  createDemoSession: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ fetchHealth, createDemoSession }))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { setSession: vi.fn() } },
  AUTH_ENABLED_WEB: true,
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

function installNavigatorLanguage(lang: string) {
  Object.defineProperty(window.navigator, 'language', { value: lang, configurable: true })
  Object.defineProperty(window.navigator, 'languages', { value: [lang], configurable: true })
}

beforeEach(() => {
  installMatchMedia()
  installMockStorage()
  installNavigatorLanguage('fr-FR')
  navigate.mockReset()
  fetchHealth.mockReset()
  // Demo configured server-side: the CTA WOULD show for an anonymous visitor,
  // which makes its absence below a real assertion.
  fetchHealth.mockResolvedValue({
    status: 'ok',
    service: 'engram-server',
    timestamp: new Date().toISOString(),
    fakeAi: false,
    authEnforced: true,
    demoEnabled: true,
    demoLoginEnabled: true,
  })
})
afterEach(cleanup)

function renderLanding() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <ThemeProvider>
      <LangProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <LandingPage />
          </TooltipProvider>
        </QueryClientProvider>
      </LangProvider>
    </ThemeProvider>,
  )
}

describe('<LandingPage> — visitor with a session', () => {
  it('replaces every account CTA with a way back into the app', () => {
    renderLanding()
    expect(screen.queryByRole('link', { name: 'Se connecter' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Créer un compte/ })).toBeNull()

    // Header + hero + final section: three exits, all pointing at the app root.
    const back = screen.getAllByRole('link', { name: /Ouvrir l’app/ })
    expect(back).toHaveLength(3)
    for (const cta of back) expect(cta.getAttribute('href')).toBe('/')
  })

  it('does not offer the demo session to someone already signed in', () => {
    renderLanding()
    expect(screen.queryByRole('button', { name: 'Essayer la démo' })).toBeNull()
    // Nor the skeleton that holds the demo slot for an anonymous visitor.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the marketing page itself intact (it is still the presentation page)', () => {
    renderLanding()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Retiens plus, en révisant moins.',
    )
  })

  it('translates the way back like the rest of the page', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('button', { name: 'en' }))
    const back = screen.getAllByRole('link', { name: /Open the app/ })
    expect(back).toHaveLength(3)
    for (const cta of back) expect(cta.getAttribute('href')).toBe('/')
  })
})
