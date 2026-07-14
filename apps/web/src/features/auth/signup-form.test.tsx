// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Sign-up form (spec BYOK §2): validates email + password (min 8) + confirmation,
 * calls `supabase.auth.signUp`, invokes `onSent` on success, and maps GoTrue 422
 * (weak password) to an actionable message. Router + Supabase are mocked so the
 * form is exercised in isolation.
 */
const { signUp } = vi.hoisted(() => ({ signUp: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signUp, signOut: vi.fn() } },
  AUTH_ENABLED_WEB: true,
}))

import { AuthProvider } from '@/lib/auth'
import { SignupForm } from './signup-form'

afterEach(() => {
  cleanup()
  signUp.mockReset()
})

function renderForm(onSent = vi.fn()) {
  render(
    <AuthProvider>
      <SignupForm onSent={onSent} />
    </AuthProvider>,
  )
  return { onSent }
}

function fill(password = 'hunter2secret', confirm = 'hunter2secret') {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'new@example.com' } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), {
    target: { value: confirm },
  })
}

describe('<SignupForm>', () => {
  it('calls signUp and invokes onSent on success', async () => {
    signUp.mockResolvedValue({ data: {}, error: null })
    const { onSent } = renderForm()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@example.com', password: 'hunter2secret' }),
    )
  })

  it('maps a 422 weak-password error to an actionable message', async () => {
    signUp.mockResolvedValue({ data: {}, error: { message: 'weak', status: 422 } })
    const { onSent } = renderForm()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    expect(await screen.findByText(/Mot de passe trop faible/)).toBeTruthy()
    expect(onSent).not.toHaveBeenCalled()
  })

  it('blocks submission when the passwords do not match', async () => {
    const { onSent } = renderForm()
    fill('hunter2secret', 'different-one')
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    expect(await screen.findByText('Les mots de passe ne correspondent pas.')).toBeTruthy()
    expect(signUp).not.toHaveBeenCalled()
    expect(onSent).not.toHaveBeenCalled()
  })
})
