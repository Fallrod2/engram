// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Set-password form (invite/recovery onboarding + Settings change). Validates
 * length + confirmation, calls `updateUser`, then runs `onSuccess`. Supabase is
 * mocked so the machine is exercised in isolation.
 *
 * This form is BOTH remaining places a password is chosen — `/set-password` and
 * the Settings dialog — so the breached-password guard (A-4) tested here is the
 * guard on both. As on the signup form, `fetch` is stubbed for every test and
 * the default stub REJECTS: the baseline is "HIBP unreachable", which keeps the
 * fail-open promise load-bearing for the whole file and keeps the suite off the
 * real network.
 */
const { updateUser } = vi.hoisted(() => ({ updateUser: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { updateUser, signOut: vi.fn() } },
  AUTH_ENABLED_WEB: true,
}))

import { AuthProvider } from '@/lib/auth'
import { SetPasswordForm } from './set-password-form'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  updateUser.mockReset()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

/** The HIBP range body that reports `password` as breached, padding included. */
async function breachedBodyFor(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
  return [`${hash.slice(5)}:3645804`, '0018A45C4D1DEF81644B54AB7F969B88D65:0'].join('\r\n')
}

function renderForm(onSuccess = vi.fn()) {
  render(
    <AuthProvider>
      <SetPasswordForm onSuccess={onSuccess} />
    </AuthProvider>,
  )
  return onSuccess
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('<SetPasswordForm>', () => {
  it('updates the password and calls onSuccess on a valid submit', async () => {
    updateUser.mockResolvedValue({ error: null })
    const onSuccess = renderForm()
    type('Nouveau mot de passe', 'longenough1')
    type('Confirmer le mot de passe', 'longenough1')
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'longenough1' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('rejects a too-short password without calling updateUser', async () => {
    const onSuccess = renderForm()
    type('Nouveau mot de passe', 'short')
    type('Confirmer le mot de passe', 'short')
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Au moins 8 caractères.')).toBeTruthy()
    expect(updateUser).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('rejects a confirmation mismatch', async () => {
    const onSuccess = renderForm()
    type('Nouveau mot de passe', 'longenough1')
    type('Confirmer le mot de passe', 'different1')
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Les mots de passe ne correspondent pas.')).toBeTruthy()
    expect(updateUser).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('surfaces a server error and does not call onSuccess', async () => {
    updateUser.mockResolvedValue({ error: { message: 'weak password' } })
    const onSuccess = renderForm()
    type('Nouveau mot de passe', 'longenough1')
    type('Confirmer le mot de passe', 'longenough1')
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Impossible de définir le mot de passe. Réessaie.')).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('<SetPasswordForm> — breached-password guard (A-4)', () => {
  function submit(password = 'longenough1') {
    type('Nouveau mot de passe', password)
    type('Confirmer le mot de passe', password)
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  }

  it('refuses a password found in a public breach and never calls updateUser', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => await breachedBodyFor('longenough1'),
    })
    const onSuccess = renderForm()
    submit()
    expect(
      await screen.findByText(
        'Ce mot de passe apparaît dans des fuites de données publiques. Choisis-en un autre.',
      ),
    ).toBeTruthy()
    expect(updateUser).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('sends only the 5-character hash prefix, and checks before updating', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '0018A45C4D1DEF81644B54AB7F969B88D65:1',
    })
    updateUser.mockResolvedValue({ error: null })
    renderForm()
    submit()
    await waitFor(() => expect(updateUser).toHaveBeenCalled())
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url.startsWith('https://api.pwnedpasswords.com/range/')).toBe(true)
    expect(url.slice('https://api.pwnedpasswords.com/range/'.length)).toHaveLength(5)
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('longenough1')
    expect(Number(fetchMock.mock.invocationCallOrder[0])).toBeLessThan(
      Number(updateUser.mock.invocationCallOrder[0]),
    )
  })

  it('FAILS OPEN: a HIBP outage does not block a password change', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    updateUser.mockResolvedValue({ error: null })
    const onSuccess = renderForm()
    submit()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(updateUser).toHaveBeenCalledWith({ password: 'longenough1' })
  })
})
