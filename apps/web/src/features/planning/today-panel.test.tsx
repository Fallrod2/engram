// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DueCounts, Subject } from '@engram/shared'

// Plain anchors: the panel's links are not what is under test here.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

import { dueCountsOptions } from '@/features/due-counts/queries'
import { TodayPanel } from './today-panel'

afterEach(cleanup)

const EMPTY_COUNTS: DueCounts = {
  now: '2026-07-28T08:00:00.000Z',
  total: 0,
  overdueCount: 0,
  todayCount: 0,
  bySubject: [],
  byDeck: [],
}

const SUBJECTS = new Map<string, Subject>()

/**
 * `queryFn` drives the three states: a promise that never settles (in flight),
 * one that rejects (failed), or the seeded cache (known).
 */
function renderPanel(queryFn: () => Promise<unknown>, seed?: DueCounts) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, queryFn },
    },
  })
  if (seed) qc.setQueryData(dueCountsOptions().queryKey, seed)
  return render(
    <QueryClientProvider client={qc}>
      <TodayPanel subjectsById={SUBJECTS} />
    </QueryClientProvider>,
  )
}

const NEVER = () => new Promise<never>(() => {})
const REJECT = () => Promise.reject(new Error('offline'))

/**
 * T-027 (b). "Rien à réviser aujourd'hui. Tout est à jour." is an ASSERTION
 * about the queue. `counts?.total ?? 0` let a query that was still in flight —
 * or that had failed outright — produce it: during the demo seeding, the whole
 * dashboard told the visitor their account was empty while the server was
 * filling it. Three states, and only the last one may speak.
 */
describe('<TodayPanel>', () => {
  it('does NOT claim the queue is clear while the count is still loading', () => {
    renderPanel(NEVER)
    expect(screen.queryByText('Rien à réviser aujourd’hui.')).toBeNull()
    expect(screen.queryByText('Tout est à jour.')).toBeNull()
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.getAttribute('aria-label')).toBe('Chargement de la file du jour')
  })

  it('says the queue is unknown — with a retry — when the count fails', async () => {
    renderPanel(REJECT)
    expect(await screen.findByText('File du jour indisponible.')).toBeTruthy()
    expect(screen.queryByText('Tout est à jour.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy()
  })

  it('only awards "all caught up" on a successful, genuinely empty read', () => {
    renderPanel(NEVER, EMPTY_COUNTS)
    expect(screen.getByText('Rien à réviser aujourd’hui.')).toBeTruthy()
    expect(screen.getByText('Tout est à jour.')).toBeTruthy()
  })
})
