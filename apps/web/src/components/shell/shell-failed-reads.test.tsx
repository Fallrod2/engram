// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MeResponse, StreaksResponse, Subject } from '@engram/shared'

/**
 * T-042 — the shell chrome is mounted on EVERY screen, so a failed read here is
 * a failed read everywhere at once, and no route `errorComponent` covers it: the
 * sidebar and the palette live outside the route's error boundary.
 *
 * Three surfaces, three claims that a `?? []` / `?? 0` was making from nothing:
 *   · the Matières group rendered exactly like an account with no subject;
 *   · the footer pill said "série de 0 jour" — not silence, a verdict;
 *   · the ⌘K picker said "Aucune matière — crée-en une d'abord."
 *
 * Each test seeds the caches it wants KNOWN and lets the others fail, so what is
 * asserted is the difference between "empty" and "unknown", never merely that
 * something rendered.
 */

// The router `<Link>` becomes a plain anchor so no RouterProvider is needed.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

vi.mock('./shell-context', () => ({
  useShell: () => ({
    collapsed: false,
    canToggleCollapse: true,
    toggleCollapse: vi.fn(),
    setCommandOpen: vi.fn(),
    commandOpen: true,
    openCreate: vi.fn(),
    setShortcutsOpen: vi.fn(),
  }),
}))
vi.mock('./theme-toggle', () => ({
  ThemeToggle: () => <button type="button" data-testid="theme-toggle" />,
}))
vi.mock('./api-status', () => ({ ApiStatus: () => <div data-testid="api-status" /> }))

import { api } from '@/lib/api'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/lib/theme'
import { subjectsListOptions } from '@/features/subjects/queries'
import { allDecksOptions } from '@/features/decks/queries'
import { meQuery } from '@/features/admin/queries'
import { streaksOptions } from '@/features/analytics/queries'
import { Sidebar } from './sidebar'
import { CommandMenu } from './command-menu'

const SUBJECT: Subject = {
  id: 'sub-1',
  name: 'Théorie des langages',
  color: '#7999f5',
  icon: 'book',
  position: 0,
  archived: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const ME: MeResponse = {
  userId: 'user-1',
  email: 'alex@example.com',
  isAdmin: false,
  isDemo: false,
  status: 'active',
  permissions: [],
}

const STREAKS: StreaksResponse = {
  now: '2026-07-01T00:00:00.000Z',
  current: 14,
  longest: 20,
  includesToday: true,
  lastStudyDay: '2026-07-01',
  totalStudyDays: 60,
}

// jsdom's Storage is not fully implemented here (same shim as the sibling shell
// tests) — the streak pill's anti-replay writes to it on mount.
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

/** cmdk/Radix observe their list box; jsdom ships neither of these. */
function installDomStubs() {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    configurable: true,
  })
  Element.prototype.scrollIntoView = () => {}
}

beforeEach(installMockStorage)
beforeEach(installDomStubs)
afterEach(cleanup)
afterEach(() => vi.restoreAllMocks())

/**
 * Every query in these components carries its own `queryFn`, so the transport is
 * stubbed one level down: whatever is not seeded below FAILS.
 */
function failEverythingElse() {
  vi.spyOn(api, 'get').mockImplementation(() => Promise.reject(new Error('offline')))
}

type Seed = (qc: QueryClient) => void

const seedSubjects: Seed = (qc) => qc.setQueryData(subjectsListOptions().queryKey, [SUBJECT])
const seedNoSubjects: Seed = (qc) => qc.setQueryData(subjectsListOptions().queryKey, [])
const seedStreaks: Seed = (qc) => qc.setQueryData(streaksOptions(new Date()).queryKey, STREAKS)
const seedMe: Seed = (qc) => qc.setQueryData(meQuery().queryKey, ME)
const seedNoDecks: Seed = (qc) => qc.setQueryData(allDecksOptions().queryKey, [])

function renderWith(node: ReactNode, ...seeds: Seed[]) {
  failEverythingElse()
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
  })
  for (const seed of seeds) seed(qc)
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <TooltipProvider>{node}</TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('<Sidebar> — the Matières group (T-042)', () => {
  it('offers a retry instead of an empty group when the read failed', async () => {
    renderWith(<Sidebar />, seedMe, seedStreaks)
    const row = await screen.findByRole('button', { name: /Matières indisponibles/ })
    expect(row).toBeTruthy()
  })

  it('says nothing of the sort on a successful, genuinely empty read', async () => {
    renderWith(<Sidebar />, seedNoSubjects, seedMe, seedStreaks)
    // Let the failing streak/me reads settle so this is not merely "too early".
    await screen.findByText('engram')
    expect(screen.queryByRole('button', { name: /Matières indisponibles/ })).toBeNull()
  })

  it('lists the subjects it has, with no error row', async () => {
    renderWith(<Sidebar />, seedSubjects, seedMe, seedStreaks)
    expect(await screen.findByText('Théorie des langages')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Matières indisponibles/ })).toBeNull()
  })
})

describe('<Sidebar> — the streak pill (T-042)', () => {
  it('prints the real streak when the read landed', async () => {
    renderWith(<Sidebar />, seedSubjects, seedMe, seedStreaks)
    expect(await screen.findByLabelText('Série de 14 jours')).toBeTruthy()
  })

  it('never says "0 jour" for a read that failed', async () => {
    renderWith(<Sidebar />, seedSubjects, seedMe)
    expect(await screen.findByLabelText('Série indisponible')).toBeTruthy()
    expect(screen.queryByLabelText('Série de 0 jour')).toBeNull()
    expect(screen.queryByLabelText(/^Série de/)).toBeNull()
  })
})

describe('<CommandMenu> — the subject picker (T-042)', () => {
  /** Step the palette onto the "choose a subject" sub-page. */
  async function openSubjectPicker() {
    const trigger = await screen.findByText('Nouveau deck…')
    trigger.click()
  }

  it('claims "aucune matière" only on a successful, empty read', async () => {
    renderWith(<CommandMenu />, seedNoSubjects, seedNoDecks)
    await openSubjectPicker()
    expect(await screen.findByText("Aucune matière — crée-en une d'abord.")).toBeTruthy()
  })

  it('says the list is unavailable when the read failed', async () => {
    renderWith(<CommandMenu />, seedNoDecks)
    await openSubjectPicker()
    expect(await screen.findByText('Liste indisponible pour le moment.')).toBeTruthy()
    expect(screen.queryByText("Aucune matière — crée-en une d'abord.")).toBeNull()
  })
})

describe('<CommandMenu> — the deck picker (T-042)', () => {
  /** Two steps down: "Nouvelle carte…" → pick the subject → the deck list. */
  async function openDeckPicker() {
    ;(await screen.findByText('Nouvelle carte…')).click()
    ;(await screen.findByText(SUBJECT.name)).click()
  }

  it('claims "aucun deck" only on a successful, empty read', async () => {
    renderWith(<CommandMenu />, seedSubjects, seedNoDecks)
    await openDeckPicker()
    expect(await screen.findByText('Aucun deck dans cette matière.')).toBeTruthy()
  })

  it('says the list is unavailable when the read failed', async () => {
    renderWith(<CommandMenu />, seedSubjects)
    await openDeckPicker()
    expect(await screen.findByText('Liste indisponible pour le moment.')).toBeTruthy()
    expect(screen.queryByText('Aucun deck dans cette matière.')).toBeNull()
  })
})
