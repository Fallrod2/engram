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
})
