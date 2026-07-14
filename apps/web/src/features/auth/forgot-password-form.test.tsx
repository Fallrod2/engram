// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Forgot-password form (audit MAJOR): validates the email, calls
 * `supabase.auth.resetPasswordForEmail`, and ALWAYS advances to the "sent" state
 * (anti-enumeration). Router + Supabase are mocked so the form runs in isolation.
 */
const { resetPasswordForEmail } = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { resetPasswordForEmail, signOut: vi.fn() } },
  AUTH_ENABLED_WEB: true,
}))

import { AuthProvider } from '@/lib/auth'
import { ForgotPasswordForm } from './forgot-password-form'

afterEach(() => {
  cleanup()
  resetPasswordForEmail.mockReset()
})

function renderForm(onSent = vi.fn()) {
  render(
    <AuthProvider>
      <ForgotPasswordForm onSent={onSent} />
    </AuthProvider>,
  )
  return onSent
}

describe('<ForgotPasswordForm>', () => {
  it('sends the reset email and advances to the sent state on success', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null })
    const onSent = renderForm()
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'alex@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }))
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
    expect(resetPasswordForEmail).toHaveBeenCalledWith('alex@example.com', expect.any(Object))
  })

  it('still advances to the sent state on error (anti-enumeration)', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: { message: 'rate limit', status: 429 } })
    const onSent = renderForm()
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'alex@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }))
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
  })

  it('blocks submission on an invalid email with a localized message', async () => {
    const onSent = renderForm()
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }))
    expect(await screen.findByText('Adresse e-mail invalide.')).toBeTruthy()
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
    expect(onSent).not.toHaveBeenCalled()
  })
})
