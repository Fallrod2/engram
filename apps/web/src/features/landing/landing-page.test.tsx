// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Landing render tests (landing spec §5.1). The landing renders bare and its
 * primary CTA points at /login; the FR/EN toggle swaps every string. The
 * anon-vs-authenticated routing decision is proven separately by the `requireAuth`
 * guard unit tests (auth-store.test.ts) and the e2e suites, so here we exercise
 * the presentational component with the REAL i18n + theme providers and mock only
 * the router (no RouterProvider in a unit test), the API client and Supabase.
 */
const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))

const { fetchHealth, createDemoSession, setSession, primeDemoAccount, fetchDemoSeedStatus } =
  vi.hoisted(() => ({
    fetchHealth: vi.fn(),
    createDemoSession: vi.fn(),
    setSession: vi.fn(),
    primeDemoAccount: vi.fn(),
    fetchDemoSeedStatus: vi.fn(),
  }))
vi.mock('@/lib/api', () => ({
  fetchHealth,
  createDemoSession,
  primeDemoAccount,
  fetchDemoSeedStatus,
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { setSession } },
  AUTH_ENABLED_WEB: true,
}))

import { ThemeProvider } from '@/lib/theme'
import { LangProvider, type Lang, type TFunction, type TKey } from '@/lib/i18n'
import { dictFr } from '@/lib/i18n/dict.fr'
import { dictEn } from '@/lib/i18n/dict.en'
import { PROVIDER_ORDER, providerLabel } from '@/features/ai/providers'
import { ACCEPT_EXTENSIONS, MAX_UPLOAD_BYTES } from '@/components/import/dropzone'
import { VERDICTS } from '@/features/review/verdict'
import { TooltipProvider } from '@/components/ui/tooltip'
import LandingPage from './landing-page'

/**
 * A `t` bound to the FR dictionary, outside React. Lets the provider-chip
 * assertions below name providers through `providerLabel()` — the same function
 * the page calls — instead of re-typing the labels a third time.
 */
const tFr: TFunction = (key: TKey) =>
  key
    .split('.')
    .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], dictFr) as string

/** The same, bound to EN — used by the parity halves of the claim guards below. */
const tEn: TFunction = (key: TKey) =>
  key
    .split('.')
    .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], dictEn) as string

/** The `/api/health` payload, with the demo switch under the test's control. */
function health(demoLoginEnabled: boolean) {
  return {
    status: 'ok' as const,
    service: 'engram-server' as const,
    timestamp: new Date().toISOString(),
    fakeAi: false,
    authEnforced: true,
    demoEnabled: demoLoginEnabled,
    demoLoginEnabled,
  }
}

/**
 * `systemDark` is not decoration (29/07/2026): with no stored `engram-theme` the app
 * now FOLLOWS the system, so what this mock answers to
 * `(prefers-color-scheme: dark)` is what decides which screenshot the landing
 * shows. Default `true` — the project's dark-first look, and the state the
 * assertions below were written against.
 */
function installMatchMedia(systemDark = true) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: systemDark && query.includes('prefers-color-scheme: dark'),
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

/**
 * Pin the browser language so the "FR by default" assertions are deterministic:
 * with no stored `engram-lang`, `LangProvider` now falls back to
 * `navigator.language` (so an anglophone visitor gets EN), and jsdom's default is
 * `en-US`. Force `fr-FR` here to exercise the French default path.
 */
function installNavigatorLanguage(lang: string) {
  Object.defineProperty(window.navigator, 'language', { value: lang, configurable: true })
  Object.defineProperty(window.navigator, 'languages', { value: [lang], configurable: true })
}

beforeEach(() => {
  installMatchMedia()
  installMockStorage()
  installNavigatorLanguage('fr-FR')
  navigate.mockReset()
  createDemoSession.mockReset()
  setSession.mockReset()
  // The demo boot now WAITS for the server to finish seeding before it navigates
  // (`GET /api/me` is what the demo middleware seeds on). Default both calls to a
  // ready account so the tests that are not about the wait stay unchanged.
  primeDemoAccount.mockReset()
  primeDemoAccount.mockResolvedValue({ userId: 'demo', isAdmin: false })
  fetchDemoSeedStatus.mockReset()
  fetchDemoSeedStatus.mockResolvedValue({ state: 'ready', readyAt: new Date().toISOString() })
  // Default for the tests that do not care: no demo configured server-side.
  fetchHealth.mockReset()
  fetchHealth.mockResolvedValue(health(false))
})
afterEach(cleanup)

function renderLanding() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
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

/** Wait for the health probe to settle so the CTA slot stops being a skeleton. */
async function settleDemoProbe() {
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
}

describe('<LandingPage>', () => {
  it('renders the hero as the single <h1> (FR by default)', () => {
    renderLanding()
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]?.textContent).toBe('Retiens plus, en révisant moins.')
  })

  it('the header "Se connecter" points at /login', () => {
    renderLanding()
    // After BYOK sign-up landed, the header keeps the sign-in link…
    const signIn = screen.getAllByRole('link', { name: 'Se connecter' })
    expect(signIn.length).toBeGreaterThanOrEqual(1)
    for (const cta of signIn) expect(cta.getAttribute('href')).toBe('/login')
  })

  it('every "Créer un compte" CTA points at /signup (header, hero, final section)', () => {
    renderLanding()
    const ctas = screen.getAllByRole('link', { name: /Créer un compte/ })
    // Repeated so a convinced reader at the foot of the page can sign up without
    // scrolling back up (landing spec — final CTA + header CTA).
    expect(ctas.length).toBeGreaterThanOrEqual(2)
    for (const cta of ctas) expect(cta.getAttribute('href')).toBe('/signup')
  })

  it('the product screenshots carry alt text (a11y)', () => {
    renderLanding()
    // Dark system + FR default → the dark FR WebP, with the localized alt.
    const shot = screen.getByAltText(/Tableau de bord d’engram/)
    expect(shot.getAttribute('src')).toBe('/landing/dashboard-dark-fr.webp')
  })

  it('follows a light system when no theme has been chosen (29/07/2026)', () => {
    // No stored `engram-theme` = no choice = the OS decides, and the landing
    // shows the screenshot of the app the visitor is actually looking at.
    installMatchMedia(false)
    renderLanding()
    expect(screen.getByAltText(/Tableau de bord d’engram/).getAttribute('src')).toBe(
      '/landing/dashboard-light-fr.webp',
    )
  })

  it('defaults to English when the browser language is English and nothing is stored', () => {
    // Regression guard for the navigator.language seed (finding: an anglophone
    // visitor never discovered the EN copy). No stored engram-lang + en browser
    // → the hero renders in English on first paint.
    installNavigatorLanguage('en-GB')
    renderLanding()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Remember more, review less.',
    )
  })

  it('the header FR/EN toggle switches every string', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('button', { name: 'en' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Remember more, review less.',
    )
    // The CTA copy follows the language too: header → /login, hero → /signup.
    const signIn = screen.getAllByRole('link', { name: 'Sign in' })
    expect(signIn.length).toBeGreaterThanOrEqual(1)
    for (const cta of signIn) expect(cta.getAttribute('href')).toBe('/login')
    const create = screen.getAllByRole('link', { name: /Create an account/ })
    expect(create.length).toBeGreaterThanOrEqual(2)
    for (const cta of create) expect(cta.getAttribute('href')).toBe('/signup')
  })
})

/**
 * Provider chips. The bug this guards (29/07/2026): the list was five hand-typed
 * strings, `openai-codex` was added to the app and never to the landing, and no
 * test noticed. The assertion below is deliberately written against
 * `PROVIDER_ORDER` + `providerLabel()` rather than a literal list — a seventh
 * provider must appear here for free, or not at all.
 */
describe('<LandingPage> — provider chips', () => {
  /** The chips, in DOM order, as the visitor reads them. */
  function chipTexts(): string[] {
    return Array.from(document.querySelectorAll('li')) // ← narrowed by the filter below
      .map((li) => li.textContent ?? '')
      .filter((text) => PROVIDER_ORDER.some((id) => text.startsWith(providerLabel(tFr, id))))
  }

  it('renders one chip per supported provider, from the shared provider table', () => {
    renderLanding()
    const chips = chipTexts()
    expect(chips).toHaveLength(PROVIDER_ORDER.length)
    for (const id of PROVIDER_ORDER) {
      expect(
        chips.some((text) => text.startsWith(providerLabel(tFr, id))),
        id,
      ).toBe(true)
    }
  })

  it('names ChatGPT (subscription) — the provider the old hard-coded list dropped', () => {
    renderLanding()
    expect(chipTexts()).toContain('ChatGPT (abonnement) · expérimental')
  })

  it('qualifies Ollama as local and nothing else as anything', () => {
    renderLanding()
    // Exactly two chips carry a nuance; the other four stand on their name.
    expect(chipTexts().filter((text) => text.includes(' · '))).toEqual([
      'Ollama · local',
      'ChatGPT (abonnement) · expérimental',
    ])
  })

  it('warns, in prose, that the subscription route may be off on this instance', () => {
    // The chips are a capability list, not an availability list: ChatGPT is the
    // one entry the visitor cannot enable by bringing a key, so the page says so
    // instead of quietly promising it.
    renderLanding()
    expect(screen.getByText(/peut être désactivée sur une instance donnée/)).toBeTruthy()
  })

  it('translates the chips and the caveat to English', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('button', { name: 'en' }))
    const chips = Array.from(document.querySelectorAll('li')).map((li) => li.textContent ?? '')
    expect(chips).toContain('ChatGPT (subscription) · experimental')
    expect(chips).toContain('Ollama · local')
    expect(screen.getByText(/can be switched off on a given instance/)).toBeTruthy()
  })

  it('says nothing that re-lists the providers in prose (no second inventory)', () => {
    // The old body sentence enumerated five providers by name; that copy is what
    // silently disagreed with the app. Guard it from coming back.
    renderLanding()
    expect(screen.queryByText(/Anthropic, Mistral, OpenRouter/)).toBeNull()
  })
})

/**
 * ═══ LANDING CLAIM ↔ SOURCE — the drift guards (01/08/2026) ═══
 *
 * Same shape as the provider-chip suite above, generalised to the rest of the
 * page: every assertion here reads the SOURCE the app actually uses and the page
 * as a visitor sees it, and refuses to let the two disagree. None of them
 * re-types the expected value — a guard that hard-codes the list it is guarding
 * is a second copy of that list, which is the bug, not the fix.
 *
 * What is deliberately NOT guarded, and why, is written at the claim itself in
 * `landing-page.tsx`: the rhythm strip's intervals (an illustration, not a
 * schedule) and the screenshots (opaque WebP; only a human can tell a stale
 * capture from a current one).
 */
describe('<LandingPage> — parametric claims match their source', () => {
  /** The accepted-format chips, read off the page. */
  function formatChips(): string[] {
    return Array.from(document.querySelectorAll('li'))
      .map((li) => li.textContent ?? '')
      .filter((text) => text.startsWith('.'))
  }

  it('lists exactly the extensions the file picker accepts, in the same order', () => {
    // The prose used to say "Markdown, PDF ou photo" and quietly left out `.txt`
    // and `.markdown`, both of which the dropzone has always taken.
    renderLanding()
    expect(formatChips()).toEqual([...ACCEPT_EXTENSIONS])
  })

  it('prints the upload cap the client actually enforces, not a rounder number', () => {
    renderLanding()
    const megabytes = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
    expect(screen.getByText(`${megabytes} Mo max par fichier`)).toBeTruthy()
  })

  it('names the two review verdicts the session offers, in both languages', () => {
    // Interpolated from `VERDICTS`, so this proves the wiring rather than the
    // wording: rename a verdict in the session dictionary and the landing follows
    // it in the same render. Restore a four-button grid and `VERDICTS` changes
    // shape, which fails at the type level long before this test runs.
    renderLanding()
    for (const v of VERDICTS) {
      expect(screen.getByText(new RegExp(tFr(v.label)), { selector: 'p' }), v.verdict).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: 'en' }))
    for (const v of VERDICTS) {
      expect(screen.getByText(new RegExp(tEn(v.label)), { selector: 'p' }), v.verdict).toBeTruthy()
    }
  })

  it('leaves no {placeholder} unresolved in the interpolated copy', () => {
    // The failure mode of an interpolated claim is not a wrong word, it is a
    // literal `{wrong}` shipped to production because the caller forgot a var.
    renderLanding()
    expect(document.body.textContent).not.toMatch(/\{[a-z]+\}/i)
  })

  it('offers one language button per dictionary the app ships', () => {
    // `Lang` is the source; the toggle is derived from an exhaustive Record, so a
    // third dictionary cannot ship with a switch that cannot reach it.
    renderLanding()
    const langs: Lang[] = ['fr', 'en']
    for (const code of langs) expect(screen.getByRole('button', { name: code })).toBeTruthy()
    const group = screen.getByRole('group', { name: 'Langue' })
    expect(group.querySelectorAll('button')).toHaveLength(langs.length)
  })

  it('promises no card format the review session cannot open (no cloze)', () => {
    // Cloze items exist as a 'mixed' generation output but have no review of
    // their own (R-1). The landing may name front/back and QCM, and nothing else,
    // until that ships.
    renderLanding()
    expect(document.body.textContent).not.toMatch(/cloze|texte à trous/i)
    fireEvent.click(screen.getByRole('button', { name: 'en' }))
    expect(document.body.textContent).not.toMatch(/cloze|fill-in-the-blank/i)
  })
})

/**
 * Demo CTA. The whole point is that its presence is decided by the SERVER at
 * runtime (`/api/health.demoLoginEnabled`), so enabling the demo needs no
 * front-end deploy — and that clicking it never sends a credential.
 */
describe('<LandingPage> — demo CTA', () => {
  const demoButton = () => screen.queryByRole('button', { name: 'Essayer la démo' })

  it('is absent while the availability probe is in flight (a skeleton holds the slot)', () => {
    fetchHealth.mockReturnValue(new Promise(() => {})) // never settles
    renderLanding()
    expect(demoButton()).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Vérification de la démo')
  })

  it('stays hidden when the server reports no demo login', async () => {
    renderLanding() // default health: demoLoginEnabled false
    await settleDemoProbe()
    expect(demoButton()).toBeNull()
  })

  it('stays hidden when the health probe itself fails', async () => {
    fetchHealth.mockRejectedValue(new Error('offline'))
    renderLanding()
    await settleDemoProbe()
    expect(demoButton()).toBeNull()
  })

  it('appears when the server reports a demo login, with no rebuild involved', async () => {
    fetchHealth.mockResolvedValue(health(true))
    renderLanding()
    expect(await screen.findByRole('button', { name: 'Essayer la démo' })).toBeTruthy()
  })

  it('opens the session and enters the app, sending NO credential', async () => {
    fetchHealth.mockResolvedValue(health(true))
    createDemoSession.mockResolvedValue({ accessToken: 'acc', refreshToken: 'ref' })
    setSession.mockResolvedValue({ error: null })
    renderLanding()
    fireEvent.click(await screen.findByRole('button', { name: 'Essayer la démo' }))
    await waitFor(() => expect(setSession).toHaveBeenCalled())
    // No argument at all: the browser never holds nor transmits the demo password.
    expect(createDemoSession).toHaveBeenCalledWith()
    expect(setSession).toHaveBeenCalledWith({ access_token: 'acc', refresh_token: 'ref' })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }))
  })

  it('shows a pending label and disables the button while opening the session', async () => {
    fetchHealth.mockResolvedValue(health(true))
    let release!: (v: { accessToken: string; refreshToken: string }) => void
    createDemoSession.mockReturnValue(new Promise((r) => (release = r)))
    setSession.mockResolvedValue({ error: null })
    renderLanding()
    fireEvent.click(await screen.findByRole('button', { name: 'Essayer la démo' }))
    const pending = await screen.findByRole('button', { name: 'Ouverture de la démo…' })
    expect((pending as HTMLButtonElement).disabled).toBe(true)
    release({ accessToken: 'acc', refreshToken: 'ref' })
    await waitFor(() => expect(setSession).toHaveBeenCalled())
  })

  it('surfaces a readable error and re-enables the button when the demo fails', async () => {
    fetchHealth.mockResolvedValue(health(true))
    createDemoSession.mockRejectedValue(new Error('503'))
    renderLanding()
    fireEvent.click(await screen.findByRole('button', { name: 'Essayer la démo' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'La démo est indisponible pour le moment. Réessaie dans un instant.',
    )
    expect((demoButton() as HTMLButtonElement).disabled).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('treats a Supabase setSession failure as a failure (no silent half-login)', async () => {
    fetchHealth.mockResolvedValue(health(true))
    createDemoSession.mockResolvedValue({ accessToken: 'acc', refreshToken: 'ref' })
    setSession.mockResolvedValue({ error: { message: 'bad token' } })
    renderLanding()
    fireEvent.click(await screen.findByRole('button', { name: 'Essayer la démo' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('is localized like the rest of the page', async () => {
    fetchHealth.mockResolvedValue(health(true))
    renderLanding()
    await screen.findByRole('button', { name: 'Essayer la démo' })
    fireEvent.click(screen.getByRole('button', { name: 'en' }))
    expect(screen.getByRole('button', { name: 'Try the demo' })).toBeTruthy()
  })
})
