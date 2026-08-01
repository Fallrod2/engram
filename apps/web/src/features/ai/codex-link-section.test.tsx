// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AiProviderStatus, CodexLinkStartResponse } from '@engram/shared'

/**
 * T-066, the eighth adjacent site — and the one where a permanent "still
 * loading" is most nearly a contradiction: this panel's ENTIRE job is to report
 * where the ChatGPT link has got to. `pollQ` had no `isError` branch, so a poll
 * that kept failing (network down, server 500) left the spinner and "En attente
 * de l'autorisation…" on screen for ever, reporting a status it no longer had.
 *
 * The queries module is mocked so no network or router is involved; only the
 * poll's own transport is allowed to fail, which is exactly the case at issue.
 */

const SESSION: CodexLinkStartResponse = {
  handle: 'h-1',
  userCode: 'ABCD-1234',
  verificationUri: 'https://example.test/device',
  expiresIn: 900,
}

const { pollCodexLink, startMutate } = vi.hoisted(() => ({
  pollCodexLink: vi.fn(),
  // The "Lier mon compte" button hands the section its session synchronously.
  startMutate: vi.fn((_a: unknown, opts?: { onSuccess?: (d: CodexLinkStartResponse) => void }) =>
    opts?.onSuccess?.(SESSION),
  ),
}))

vi.mock('./queries', () => ({
  aiSettingsOptions: () => ({ queryKey: ['ai'], queryFn: vi.fn() }),
  pollCodexLink,
  useStartCodexLink: () => ({ mutate: startMutate, isPending: false }),
  useUnlinkCodex: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAiSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAiKey: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAiKey: () => ({ mutate: vi.fn(), isPending: false }),
  useTestConnection: () => ({ mutate: vi.fn(), isPending: false }),
  useProviderModels: () => ({ data: undefined, refetch: vi.fn(), isFetching: false }),
}))

import { CodexLinkSection } from './ai-settings-card'

const STATUS: AiProviderStatus = {
  provider: 'openai-codex',
  requiresKey: false,
  hasKey: false,
  keySource: null,
  model: 'gpt-5.5',
  active: true,
  ocrActive: false,
  usable: false,
  linked: false,
}

afterEach(cleanup)
afterEach(() => vi.clearAllMocks())

/** Mount the section and step it onto the "waiting for authorization" panel. */
async function openSession() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <CodexLinkSection status={STATUS} />
    </QueryClientProvider>,
  )
  ;(await screen.findByText('Lier mon compte ChatGPT')).click()
  return await screen.findByText('ABCD-1234')
}

describe('<CodexLinkSection> — the link poll (T-066)', () => {
  it('waits, with the spinner, while the poll is answering "pending"', async () => {
    pollCodexLink.mockResolvedValue({ status: 'pending' })
    await openSession()
    expect(await screen.findByText('En attente de l’autorisation…')).toBeTruthy()
    expect(screen.queryByText('Réessayer')).toBeNull()
  })

  it('stops claiming "en attente" once the poll itself is failing', async () => {
    pollCodexLink.mockRejectedValue(new Error('offline'))
    await openSession()
    expect(
      await screen.findByText('Impossible de vérifier l’état de la liaison pour le moment.'),
    ).toBeTruthy()
    expect(screen.queryByText('En attente de l’autorisation…')).toBeNull()
  })

  it('keeps the user code and the verification link up while it cannot see', async () => {
    // The authorization may well have succeeded; only OUR view of it is gone.
    pollCodexLink.mockRejectedValue(new Error('offline'))
    await openSession()
    await screen.findByText('Impossible de vérifier l’état de la liaison pour le moment.')
    expect(screen.getByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByText('Ouvrir la page de vérification')).toBeTruthy()
  })

  it('asks the poll again — it does not reload anything', async () => {
    pollCodexLink.mockRejectedValue(new Error('offline'))
    await openSession()
    const retry = await screen.findByText('Réessayer')
    const before = pollCodexLink.mock.calls.length
    retry.click()
    await waitFor(() => expect(pollCodexLink.mock.calls.length).toBeGreaterThan(before))
  })
})
