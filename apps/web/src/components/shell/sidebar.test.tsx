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

const DUE_COUNTS: DueCounts = {
  now: '2026-07-01T00:00:00.000Z',
  total: 128,
  bySubject: [{ subjectId: SUBJECT.id, dueCount: 42 }],
  byDeck: [],
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

function renderSidebar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
  })
  qc.setQueryData(subjectsListOptions().queryKey, [SUBJECT])
  qc.setQueryData(dueCountsOptions().queryKey, DUE_COUNTS)
  qc.setQueryData(meQuery().queryKey, ME)
  qc.setQueryData(streaksOptions(new Date()).queryKey, STREAKS)
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

/** The sidebar footer, identified by its border — the only bordered block. */
function footer(container: HTMLElement): HTMLElement {
  const el = container.querySelector('aside > .border-t')
  if (!(el instanceof HTMLElement)) throw new Error('sidebar footer not found')
  return el
}

beforeEach(() => {
  collapsed = false
  canToggleCollapse = true
  toggleCollapse.mockClear()
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

describe('<Sidebar> collapsed due badges', () => {
  it('caps at 9+ and hugs its icon so it cannot spill onto the row above', () => {
    collapsed = true
    renderSidebar()
    // Both the /review total (128) and the subject count (42) collapse to `9+`.
    expect(screen.getAllByText('9+')).toHaveLength(2)
    expect(screen.queryByText('99+')).toBeNull()
    expect(screen.queryByText('128')).toBeNull()

    for (const badge of screen.getAllByText('9+')) {
      expect(badge.className).toContain('-top-1')
      expect(badge.className).not.toContain('-top-2')
    }
  })

  it('shows the exact counts once expanded', () => {
    renderSidebar()
    expect(screen.getByText('128')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.queryByText('9+')).toBeNull()
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
