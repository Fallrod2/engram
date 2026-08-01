// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DueCounts, MeResponse, StreaksResponse, Subject } from '@engram/shared'

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
import { dueCountsOptions } from '@/features/due-counts/queries'
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

const DUE_COUNTS: DueCounts = {
  now: '2026-07-01T00:00:00.000Z',
  total: 17,
  overdueCount: 12,
  todayCount: 5,
  bySubject: [{ subjectId: SUBJECT.id, dueCount: 17, overdueCount: 12, todayCount: 5 }],
  byDeck: [],
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
const seedDueCounts: Seed = (qc) => qc.setQueryData(dueCountsOptions().queryKey, DUE_COUNTS)

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

/**
 * T-066 — the adjacent motif: the failed read that renders as a PERMANENT
 * SKELETON. The rail's due counts had no `isError` branch at all, so a dropped
 * `GET /review/counts` left the 12×10px shimmer up on every row of every screen
 * until the next reload. A skeleton promises a number is on its way; nothing
 * was. Pending and failed are two states, and they now look — and sound —
 * different.
 */
describe('<Sidebar> — the due counts (T-066)', () => {
  it('prints the two-part count when the read landed', async () => {
    renderWith(<Sidebar />, seedSubjects, seedMe, seedStreaks, seedDueCounts)
    expect(
      await screen.findByLabelText('Session de révision, 12 cartes en retard, 5 pour aujourd’hui'),
    ).toBeTruthy()
  })

  it('stops shimmering and says the figures are unavailable when the read failed', async () => {
    const { container } = renderWith(<Sidebar />, seedSubjects, seedMe, seedStreaks)
    // The row announces the loss instead of falling silent…
    expect(await screen.findByLabelText(/Session de révision, chiffres indisponibles/)).toBeTruthy()
    expect(
      await screen.findByLabelText(/Théorie des langages, chiffres indisponibles/),
    ).toBeTruthy()
    // …and the count itself is the em-dash `<DueCount>` uses everywhere else,
    // not the skeleton it used to be stuck on for ever.
    expect(container.querySelector('.animate-pulse')).toBeNull()
    expect(container.textContent).toContain('—')
  })

  it('never turns a failed count into a zero', async () => {
    renderWith(<Sidebar />, seedSubjects, seedMe, seedStreaks)
    await screen.findByLabelText('Session de révision, chiffres indisponibles')
    expect(screen.queryByLabelText(/aucune carte à réviser/)).toBeNull()
    expect(screen.queryByLabelText(/0 carte/)).toBeNull()
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
