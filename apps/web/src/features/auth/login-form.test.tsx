// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Login form (spec §6.2): submits credentials, surfaces a generic error, and
 * disables its inputs while submitting. Router + Supabase are mocked so the form
 * is exercised in isolation.
 */
const { signInWithPassword } = vi.hoisted(() => ({ signInWithPassword: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ redirect: undefined }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword, signOut: vi.fn() } },
  AUTH_ENABLED_WEB: true,
}))

import { AuthProvider } from '@/lib/auth'
import { LoginForm } from './login-form'

afterEach(() => {
  cleanup()
  signInWithPassword.mockReset()
})

function renderForm() {
  render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  )
}

function fill() {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'alex@example.com' } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'hunter2' } })
}

describe('<LoginForm>', () => {
  it('calls signInWithPassword with the credentials on submit', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    renderForm()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'alex@example.com',
        password: 'hunter2',
      }),
    )
  })

  it('shows the generic error message on failure', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    renderForm()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByText('E-mail ou mot de passe incorrect.')).toBeTruthy()
  })

  it('disables inputs while submitting', async () => {
    let resolve!: (value: { error: null }) => void
    signInWithPassword.mockReturnValue(
      new Promise<{ error: null }>((r) => {
        resolve = r
      }),
    )
    renderForm()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    await waitFor(() =>
      expect((screen.getByLabelText('E-mail') as HTMLInputElement).disabled).toBe(true),
    )
    resolve({ error: null })
  })

  it('offers a "forgot password" link to /forgot-password (no account dead-end)', () => {
    renderForm()
    const link = screen.getByRole('link', { name: 'Mot de passe oublié ?' })
    expect(link.getAttribute('href')).toBe('/forgot-password')
  })

  it('surfaces a LOCALIZED invalid-email message (not the default Zod string)', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'not-an-email' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByText('Adresse e-mail invalide.')).toBeTruthy()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('reveals the password when the eye toggle is tapped', () => {
    renderForm()
    const password = screen.getByLabelText('Mot de passe') as HTMLInputElement
    expect(password.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Afficher le mot de passe' }))
    expect(password.type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: 'Masquer le mot de passe' }))
    expect(password.type).toBe('password')
  })
})
