// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Set-password form (invite/recovery onboarding + Settings change). Validates
 * length + confirmation, calls `updateUser`, then runs `onSuccess`. Supabase is
 * mocked so the machine is exercised in isolation.
 */
const { updateUser } = vi.hoisted(() => ({ updateUser: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { updateUser, signOut: vi.fn() } },
  AUTH_ENABLED_WEB: true,
}))

import { AuthProvider } from '@/lib/auth'
import { SetPasswordForm } from './set-password-form'

afterEach(() => {
  cleanup()
  updateUser.mockReset()
})

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
