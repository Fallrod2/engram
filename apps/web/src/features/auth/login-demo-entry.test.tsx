// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The way out of `/login` (T-034). Settings → Sign out used to land on a screen
 * offering an account you may not have, and nothing else — a dead end for exactly
 * the visitor the demo exists for.
 *
 * The rule under test is that the entrance is decided by the SERVER at runtime
 * (`/api/health.demoLoginEnabled`), the same predicate as the landing CTA, and
 * that the separator introducing it never outlives the button it introduces.
 */
const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const { fetchHealth, createDemoSession, primeDemoAccount, fetchDemoSeedStatus, setSession } =
  vi.hoisted(() => ({
    fetchHealth: vi.fn(),
    createDemoSession: vi.fn(),
    primeDemoAccount: vi.fn(),
    fetchDemoSeedStatus: vi.fn(),
    setSession: vi.fn(),
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

import { LoginDemoEntry } from './login-demo-entry'

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

function renderEntry() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <LoginDemoEntry />
    </QueryClientProvider>,
  )
}

/** The demo button, in the provider-free FR default. */
const demoButton = () => screen.queryByRole('button', { name: 'Essayer la démo' })
/** The "ou" rule — it must never outlive the button it introduces. */
const separator = () => screen.queryByText('ou')

beforeEach(() => {
  navigate.mockReset()
  createDemoSession.mockReset()
  setSession.mockReset()
  primeDemoAccount.mockReset()
  primeDemoAccount.mockResolvedValue({ userId: 'demo', isAdmin: false })
  fetchDemoSeedStatus.mockReset()
  fetchDemoSeedStatus.mockResolvedValue({ state: 'ready', readyAt: new Date().toISOString() })
  fetchHealth.mockReset()
})
afterEach(cleanup)

describe('<LoginDemoEntry>', () => {
  it('offers the demo when the server says one is configured', async () => {
    fetchHealth.mockResolvedValue(health(true))
    renderEntry()
    expect(await screen.findByRole('button', { name: 'Essayer la démo' })).toBeTruthy()
    expect(separator()).toBeTruthy()
  })

  it('renders NOTHING — separator included — when the server has no demo', async () => {
    fetchHealth.mockResolvedValue(health(false))
    renderEntry()
    await waitFor(() => expect(fetchHealth).toHaveBeenCalled())
    await waitFor(() => expect(separator()).toBeNull())
    expect(demoButton()).toBeNull()
  })

  it('renders nothing when the health probe itself fails', async () => {
    fetchHealth.mockRejectedValue(new Error('offline'))
    renderEntry()
    await waitFor(() => expect(separator()).toBeNull())
    expect(demoButton()).toBeNull()
  })

  it('holds the slot with a skeleton while the probe is in flight', () => {
    fetchHealth.mockReturnValue(new Promise(() => {})) // never settles
    renderEntry()
    expect(demoButton()).toBeNull()
    // The separator is already there: it is what turns the reserved space into
    // "an alternative is loading" rather than a gap that pops open.
    expect(separator()).toBeTruthy()
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Vérification de la démo')
  })

  it('opens the session on click, sending NO credential', async () => {
    fetchHealth.mockResolvedValue(health(true))
    createDemoSession.mockResolvedValue({ accessToken: 'acc', refreshToken: 'ref' })
    setSession.mockResolvedValue({ error: null })
    renderEntry()
    ;(await screen.findByRole('button', { name: 'Essayer la démo' })).click()
    await waitFor(() => expect(setSession).toHaveBeenCalled())
    expect(createDemoSession).toHaveBeenCalledWith()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }))
  })
})
