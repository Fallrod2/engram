// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DueCounts, StudyTodayResponse, Subject } from '@engram/shared'

// Plain anchors: the panel's links are not what is under test here.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

import { api } from '@/lib/api'
import { dueCountsOptions } from '@/features/due-counts/queries'
import { studyTodayOptions } from './queries'
import { TodayPanel } from './today-panel'

afterEach(cleanup)
afterEach(() => vi.restoreAllMocks())

const EMPTY_COUNTS: DueCounts = {
  now: '2026-07-28T08:00:00.000Z',
  total: 0,
  overdueCount: 0,
  todayCount: 0,
  bySubject: [],
  byDeck: [],
}

const LOADED_COUNTS: DueCounts = {
  ...EMPTY_COUNTS,
  total: 12,
  overdueCount: 5,
  todayCount: 7,
}

const SUBJECTS = new Map<string, Subject>()

/**
 * Both of the panel's queries carry their OWN `queryFn` (they are
 * `queryOptions` factories), so a `defaultOptions.queries.queryFn` never runs.
 * The transport is stubbed one level down instead, per PATH — which is what
 * lets a test fail exactly one of the two reads and leave the other alone. That
 * asymmetry is the whole shape of T-042.
 */
type Transport = (path: string) => Promise<unknown>

const DUE_PATH = '/review/counts'

function stubApi(transport: Transport) {
  vi.spyOn(api, 'get').mockImplementation((path: string) => transport(path) as Promise<never>)
}

const NEVER: Transport = () => new Promise<never>(() => {})
const REJECT: Transport = () => Promise.reject(new Error('offline'))

/** Due counts answer; `studyToday` — and only it — fails. */
function onlyTodayFails(counts: DueCounts): Transport {
  return (path) =>
    path === DUE_PATH ? Promise.resolve(counts) : Promise.reject(new Error('offline'))
}

function renderPanel(transport: Transport, seed?: DueCounts, seedToday?: StudyTodayResponse) {
  stubApi(transport)
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  if (seed) qc.setQueryData(dueCountsOptions().queryKey, seed)
  if (seedToday) qc.setQueryData(studyTodayOptions().queryKey, seedToday)
  return render(
    <QueryClientProvider client={qc}>
      <TodayPanel subjectsById={SUBJECTS} />
    </QueryClientProvider>,
  )
}

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

/**
 * T-042 — the same geste, one query to the right. `studyToday` is the ONLY
 * source of two things: the "dont N en retard" split and the imminent-exam
 * banner. `today?.overdueCount ?? 0` made both disappear on a failed read,
 * which reads as "no backlog, no exam coming" — a claim, from nothing.
 */
describe('<TodayPanel> — the study-today read (T-042)', () => {
  const TODAY: StudyTodayResponse = {
    now: '2026-07-28T08:00:00.000Z',
    total: 12,
    overdueCount: 5,
    subjects: [],
  }

  it('prints the backlog split on a successful read', () => {
    renderPanel(NEVER, LOADED_COUNTS, TODAY)
    expect(screen.getByText('dont 5 en retard')).toBeTruthy()
    expect(screen.queryByText('Retard et examens à venir indisponibles.')).toBeNull()
  })

  it('says the detail is missing — not absent — when that read fails', async () => {
    // The count itself IS known (seeded), so the panel legitimately renders its
    // total. Only the second read failed, and only its two contributions are in
    // question. Before the fix this rendered exactly like "no backlog".
    renderPanel(onlyTodayFails(LOADED_COUNTS), LOADED_COUNTS)
    expect(await screen.findByText('Retard et examens à venir indisponibles.')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy()
  })

  it('says it on the "all caught up" branch too — an exam can still be imminent', async () => {
    // Zero due and an exam in three days is a real, common state. The reward
    // copy is about the QUEUE and stays legitimate; the missing banner is not.
    renderPanel(onlyTodayFails(EMPTY_COUNTS), EMPTY_COUNTS)
    expect(await screen.findByText('Retard et examens à venir indisponibles.')).toBeTruthy()
    expect(screen.getByText('Rien à réviser aujourd’hui.')).toBeTruthy()
  })

  it('stays silent about the split while that read is still in flight', () => {
    // Pending is not a claim: the absence of "dont N en retard" says nothing,
    // and the line lands with the rest. Only failure gets a sentence.
    renderPanel(NEVER, LOADED_COUNTS)
    expect(screen.queryByText('Retard et examens à venir indisponibles.')).toBeNull()
    expect(screen.queryByText(/en retard/)).toBeNull()
  })
})
