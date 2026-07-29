// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DueCounts, MeResponse, StreaksResponse, Subject } from '@engram/shared'

/**
 * Sidebar layout regressions (fix/sidebar-layout). These freeze WHERE the shell
 * chrome lives, not how it is painted: the collapse toggle stays at the top of
 * the rail in both states, and the footer stacks its nav-shaped links instead of
 * crowding them into one 240px row.
 */

// The router `<Link>` becomes a plain anchor so no RouterProvider is needed.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const toggleCollapse = vi.fn()
let collapsed = false
let canToggleCollapse = true
vi.mock('./shell-context', () => ({
  useShell: () => ({
    collapsed,
    canToggleCollapse,
    toggleCollapse,
    setCommandOpen: vi.fn(),
  }),
}))

// Leaf chrome is stubbed: both pull `motion` / their own query and neither takes
// part in the layout assertions below.
vi.mock('./theme-toggle', () => ({
  ThemeToggle: () => <button type="button" data-testid="theme-toggle" />,
}))
vi.mock('./api-status', () => ({
  ApiStatus: () => <div data-testid="api-status" />,
}))
vi.mock('./streak-pill', () => ({
  StreakPill: () => <div data-testid="streak-pill" />,
}))

import { TooltipProvider } from '@/components/ui/tooltip'
import { LangProvider } from '@/lib/i18n'
import { subjectsListOptions } from '@/features/subjects/queries'
import { meQuery } from '@/features/admin/queries'
import { dueCountsOptions } from '@/features/due-counts/queries'
import { streaksOptions } from '@/features/analytics/queries'
import { Sidebar } from './sidebar'

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

/** Backlog present on both rows: 128 = 100 + 28 overall, 42 = 12 + 30 for the subject. */
const DUE_COUNTS: DueCounts = {
  now: '2026-07-01T00:00:00.000Z',
  total: 128,
  overdueCount: 100,
  todayCount: 28,
  bySubject: [{ subjectId: SUBJECT.id, dueCount: 42, overdueCount: 12, todayCount: 30 }],
  byDeck: [],
}

/** The healthy case: everything due is due today, nothing has piled up. */
const NO_BACKLOG: DueCounts = {
  ...DUE_COUNTS,
  total: 7,
  overdueCount: 0,
  todayCount: 7,
  bySubject: [{ subjectId: SUBJECT.id, dueCount: 5, overdueCount: 0, todayCount: 5 }],
}

/** Nothing due at all. */
const EMPTY_COUNTS: DueCounts = {
  ...DUE_COUNTS,
  total: 0,
  overdueCount: 0,
  todayCount: 0,
  bySubject: [{ subjectId: SUBJECT.id, dueCount: 0, overdueCount: 0, todayCount: 0 }],
}

const ME: MeResponse = {
  userId: 'user-1',
  email: 'alex@example.com',
  isAdmin: true,
  isDemo: false,
  status: 'active',
  permissions: [],
}

const STREAKS: StreaksResponse = {
  now: '2026-07-01T00:00:00.000Z',
  current: 3,
  longest: 9,
  includesToday: true,
  lastStudyDay: '2026-07-01',
  totalStudyDays: 12,
}

function renderSidebar(counts: DueCounts = DUE_COUNTS, lang?: 'fr' | 'en') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
  })
  qc.setQueryData(subjectsListOptions().queryKey, [SUBJECT])
  qc.setQueryData(dueCountsOptions().queryKey, counts)
  qc.setQueryData(meQuery().queryKey, ME)
  qc.setQueryData(streaksOptions(new Date()).queryKey, STREAKS)
  const tree = (
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>
    </QueryClientProvider>
  )
  // No provider ⇒ the default FR dictionary, which is what most cases assert.
  if (!lang) return render(tree)
  localStorage.setItem('engram-lang', lang)
  return render(<LangProvider>{tree}</LangProvider>)
}

/** Every graduated due dot currently painted, in DOM order. */
function dueDots(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-due-tier]'))
}

/** The sidebar footer, identified by its border — the only bordered block. */
function footer(container: HTMLElement): HTMLElement {
  const el = container.querySelector('aside > .border-t')
  if (!(el instanceof HTMLElement)) throw new Error('sidebar footer not found')
  return el
}

// jsdom's Storage is not fully implemented here — install a tiny in-memory mock
// (same shim as `streak-pill.test.tsx`). `<LangProvider>` persists the language.
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
  collapsed = false
  canToggleCollapse = true
  toggleCollapse.mockClear()
  installMockStorage()
})
afterEach(cleanup)

describe('<Sidebar> collapse toggle placement', () => {
  it('keeps the expanded toggle in the brand row, out of the footer', () => {
    const { container } = renderSidebar()
    const toggle = screen.getByLabelText('Réduire la barre latérale')
    const aside = container.querySelector('aside')
    // First child of the aside = the brand row.
    expect(aside?.firstElementChild?.contains(toggle)).toBe(true)
    expect(footer(container).contains(toggle)).toBe(false)
  })

  it('renders the collapsed toggle in the top region, never in the footer', () => {
    collapsed = true
    const { container } = renderSidebar()
    const toggle = screen.getByLabelText('Déployer la barre latérale')
    const aside = container.querySelector('aside')
    expect(aside).not.toBeNull()

    // It sits above the search button, which itself sits above the nav.
    const top = Array.from(aside?.children ?? [])
    const toggleRow = top.findIndex((el) => el.contains(toggle))
    const searchRow = top.findIndex((el) => el.contains(screen.getByLabelText('Rechercher')))
    expect(toggleRow).toBeGreaterThanOrEqual(0)
    expect(toggleRow).toBeLessThan(searchRow)

    expect(footer(container).contains(toggle)).toBe(false)
  })

  it('exposes exactly one collapse control, whatever the state', () => {
    const { unmount } = renderSidebar()
    expect(screen.queryAllByLabelText('Déployer la barre latérale')).toHaveLength(0)
    expect(screen.queryAllByLabelText('Réduire la barre latérale')).toHaveLength(1)
    unmount()

    collapsed = true
    renderSidebar()
    expect(screen.queryAllByLabelText('Déployer la barre latérale')).toHaveLength(1)
    expect(screen.queryAllByLabelText('Réduire la barre latérale')).toHaveLength(0)
  })

  it('omits the toggle entirely when collapse is not available', () => {
    collapsed = true
    canToggleCollapse = false
    renderSidebar()
    expect(screen.queryByLabelText('Déployer la barre latérale')).toBeNull()
  })
})

describe('<Sidebar> collapsed due graduation (T-013)', () => {
  it('replaces the truncated `9+` badge with a graduated dot', () => {
    collapsed = true
    const { container } = renderSidebar()
    // No digits at all in the rail: the number was unreadable and truncated.
    expect(screen.queryByText('9+')).toBeNull()
    expect(screen.queryByText('128')).toBeNull()
    expect(screen.queryByText('42')).toBeNull()

    const dots = dueDots(container)
    expect(dots).toHaveLength(2) // /review total + the one subject
  })

  it('grades the dot by magnitude on the shared 20/50 thresholds', () => {
    collapsed = true
    const { container } = renderSidebar()
    const [review, subject] = dueDots(container)
    // 128 → high (>50), 42 → mid (21–50): bigger dot for the bigger backlog.
    expect(review?.dataset.dueTier).toBe('high')
    expect(review?.className).toContain('size-2')
    expect(subject?.dataset.dueTier).toBe('mid')
    expect(subject?.className).toContain('size-1.5')
  })

  it('uses the low grade for a small count and drops the dot entirely at zero', () => {
    collapsed = true
    const { container, unmount } = renderSidebar(NO_BACKLOG)
    const dots = dueDots(container)
    expect(dots.map((d) => d.dataset.dueTier)).toEqual(['low', 'low'])
    expect(dots[0]?.className).toContain('size-1')
    unmount()

    const empty = renderSidebar(EMPTY_COUNTS)
    expect(dueDots(empty.container)).toHaveLength(0)
  })

  it('marks the presence of a backlog, and leaves a clean rail unmarked', () => {
    collapsed = true
    const { container, unmount } = renderSidebar()
    for (const dot of dueDots(container)) {
      expect(dot.dataset.dueBacklog).toBe('true')
      expect(dot.className).toMatch(/\bbg-text\b/) // full strength, not `bg-text-faint`
      expect(dot.className).not.toMatch(/\bring-/) // tone only — see `DueDot`
    }
    unmount()

    const calm = renderSidebar(NO_BACKLOG)
    for (const dot of dueDots(calm.container)) {
      expect(dot.dataset.dueBacklog).toBeUndefined()
      expect(dot.className).toContain('bg-text-faint')
    }
  })

  it('never paints the dot with the accent reserved for the active row', () => {
    collapsed = true
    const { container } = renderSidebar()
    for (const dot of dueDots(container)) expect(dot.className).not.toMatch(/accent/)
  })

  it('parks the dot in the trailing gutter, never on the glyph', () => {
    // Anchored to the icon's corner, the `mid`/`high` dot fused with the 8px
    // subject dot and clipped the nav glyph. Living in its own gutter, it cannot
    // overlap either — this pins the structure, not just the offsets.
    collapsed = true
    const { container } = renderSidebar()
    for (const dot of dueDots(container)) {
      const box = dot.parentElement
      expect(box?.className).toContain('absolute')
      expect(box?.className).toContain('inset-y-0') // full height ⇒ vertically centred
      expect(box?.className).toContain('right-0.5') // trailing edge, clear of the glyph
      // A sibling of the glyph span, not nested inside it.
      expect(box?.parentElement?.tagName).toBe('A')
      expect(box?.querySelector('svg')).toBeNull()
    }
  })
})

describe('<Sidebar> expanded due split (T-013)', () => {
  it('prints backlog and today as an explicit sum whose halves are told apart', () => {
    const { container } = renderSidebar()
    // /review: 128 = 100 + 28 — the backlog leads, in primary text at semibold.
    const backlog = screen.getByText('100')
    expect(backlog.className).toContain('font-semibold')
    expect(backlog.className).toContain('text-text')
    expect(screen.getByText('28')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy() // subject backlog
    expect(screen.getByText('30')).toBeTruthy() // subject today
    // The bare totals are no longer printed as one lump.
    expect(screen.queryByText('128')).toBeNull()
    expect(screen.queryByText('42')).toBeNull()
    expect(container.textContent).toContain('100+28')
  })

  it('stays exactly as calm as before when there is no backlog', () => {
    const { container } = renderSidebar(NO_BACKLOG)
    // A single lump number per row, in the plain tier tone — the exact markup
    // the badge had before the split existed. No sum sign, no bolder segment.
    for (const value of ['7', '5']) {
      const count = screen.getByText(value)
      expect(count.textContent).toBe(value)
      expect(count.className).toContain('font-mono')
      expect(count.className).not.toContain('font-semibold')
    }
    expect(container.textContent).not.toContain('+')
  })

  it('keeps the retreating `·` at zero', () => {
    renderSidebar(EMPTY_COUNTS)
    expect(screen.getAllByText('·').length).toBeGreaterThan(0)
  })
})

describe('<Sidebar> due counts are announced (T-017)', () => {
  it('names the row with the subject and BOTH figures, expanded', () => {
    renderSidebar()
    expect(
      screen.getByRole('link', {
        name: 'Théorie des langages, 12 cartes en retard, 30 pour aujourd’hui',
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', {
        name: 'Session de révision, 100 cartes en retard, 28 pour aujourd’hui',
      }),
    ).toBeTruthy()
  })

  it('names the row identically once collapsed — never `9+`, never silence', () => {
    collapsed = true
    renderSidebar()
    expect(
      screen.getByRole('link', {
        name: 'Théorie des langages, 12 cartes en retard, 30 pour aujourd’hui',
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', {
        name: 'Session de révision, 100 cartes en retard, 28 pour aujourd’hui',
      }),
    ).toBeTruthy()
  })

  it('drops the zero half instead of announcing it, and spells out the empty case', () => {
    const { unmount } = renderSidebar(NO_BACKLOG)
    // Alone, the today half says "cartes" — the backlog half is not there to
    // carry the noun for it.
    expect(
      screen.getByRole('link', { name: 'Théorie des langages, 5 cartes pour aujourd’hui' }),
    ).toBeTruthy()
    unmount()

    renderSidebar(EMPTY_COUNTS)
    expect(
      screen.getByRole('link', { name: 'Théorie des langages, aucune carte à réviser' }),
    ).toBeTruthy()
  })

  it('singularises correctly (FR treats 0 and 1 as singular)', () => {
    const { unmount } = renderSidebar({
      ...DUE_COUNTS,
      total: 2,
      overdueCount: 1,
      todayCount: 1,
      bySubject: [{ subjectId: SUBJECT.id, dueCount: 2, overdueCount: 1, todayCount: 1 }],
    })
    expect(
      screen.getByRole('link', {
        name: 'Théorie des langages, 1 carte en retard, 1 pour aujourd’hui',
      }),
    ).toBeTruthy()
    unmount()

    renderSidebar({
      ...DUE_COUNTS,
      total: 3,
      overdueCount: 3,
      todayCount: 0,
      bySubject: [{ subjectId: SUBJECT.id, dueCount: 3, overdueCount: 3, todayCount: 0 }],
    })
    // A pure backlog announces only the backlog — no "0 pour aujourd'hui".
    expect(
      screen.getByRole('link', { name: 'Théorie des langages, 3 cartes en retard' }),
    ).toBeTruthy()
  })

  it('translates the whole sentence in English', () => {
    renderSidebar(DUE_COUNTS, 'en')
    expect(
      screen.getByRole('link', { name: 'Théorie des langages, 12 cards overdue, 30 due today' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Review session, 100 cards overdue, 28 due today' }),
    ).toBeTruthy()
  })

  it('leaves count-less nav rows named by their label alone', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Planning' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Analytics' })).toBeTruthy()
  })
})

describe('<Sidebar> footer layout', () => {
  it('stacks Administration and Settings when expanded', () => {
    const { container } = renderSidebar()
    const admin = screen.getByText('Administration').closest('a')
    const settings = screen.getByText('Réglages').closest('a')
    expect(admin).not.toBeNull()
    expect(settings).not.toBeNull()

    // Same container (they are siblings), and that container stacks.
    const group = admin?.parentElement
    expect(settings?.parentElement).toBe(group)
    expect(group?.className).toContain('flex-col')
    expect(group?.className).not.toContain('items-center')
    expect(footer(container).contains(group as Node)).toBe(true)
  })

  it('puts the streak and the theme toggle on their own footer row', () => {
    const { container } = renderSidebar()
    const linkGroup = screen.getByText('Administration').closest('a')?.parentElement
    const themeRow = screen.getByTestId('theme-toggle').parentElement
    expect(themeRow).not.toBe(linkGroup)
    expect(themeRow?.contains(screen.getByTestId('streak-pill'))).toBe(true)
    // Both are direct children of the footer, so its own gap separates them.
    expect(themeRow?.parentElement).toBe(footer(container))
    expect(linkGroup?.parentElement).toBe(footer(container))
  })

  it('leading-aligns that row with the links above it, never pushed right', () => {
    // The complaint: "Réglages" started at the left inset while the streak and
    // the theme toggle were flushed right on their own line, so the footer read
    // as a checkerboard instead of one column.
    renderSidebar()
    const themeRow = screen.getByTestId('theme-toggle').parentElement
    expect(themeRow?.className).not.toContain('justify-end')
    expect(themeRow?.className).not.toContain('ml-auto')
    expect(themeRow?.className).not.toContain('items-end')
  })

  it('keeps the collapsed footer a single centred icon column', () => {
    collapsed = true
    const { container } = renderSidebar()
    const admin = screen.getByLabelText('Administration')
    const settings = screen.getByLabelText('Réglages')
    const group = admin.parentElement
    expect(settings.parentElement).toBe(group)
    expect(group?.className).toContain('flex-col')
    expect(group?.className).toContain('items-center')
    // The streak stays in that same column; the theme toggle is hidden.
    expect(group?.contains(screen.getByTestId('streak-pill'))).toBe(true)
    expect(screen.queryByTestId('theme-toggle')).toBeNull()
    expect(footer(container).contains(admin)).toBe(true)
  })
})
