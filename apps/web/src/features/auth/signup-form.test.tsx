// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Sign-up form (spec BYOK §2): validates email + password (min 8) + confirmation,
 * calls `supabase.auth.signUp`, invokes `onSent` on success, and maps GoTrue 422
 * (weak password) to an actionable message. Router + Supabase are mocked so the
 * form is exercised in isolation.
 *
 * `fetch` is stubbed for EVERY test in this file, because the form now runs the
 * HIBP breached-password check (A-4) before signing up. The default stub REJECTS
 * — so the baseline every other test runs against is "HIBP unreachable", which
 * makes the fail-open promise a precondition of the whole suite rather than one
 * test's private setup. Nothing here ever touches the real network.
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

import { LangProvider } from '@/lib/i18n'
import { AuthProvider } from '@/lib/auth'
import { SignupForm } from './signup-form'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  signUp.mockReset()
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

/** Make the stubbed HIBP answer 200 with `text`. */
function hibpAnswers(text: string): void {
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => text })
}

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

describe('<SignupForm> — breached-password guard (A-4)', () => {
  it('refuses a password found in a public breach and never calls signUp', async () => {
    hibpAnswers(await breachedBodyFor('hunter2secret'))
    const { onSent } = renderForm()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    expect(
      await screen.findByText(
        'Ce mot de passe apparaît dans des fuites de données publiques. Choisis-en un autre.',
      ),
    ).toBeTruthy()
    // The refusal is the point: the account must NOT be created.
    expect(signUp).not.toHaveBeenCalled()
    expect(onSent).not.toHaveBeenCalled()
  })

  it('checks HIBP BEFORE signing up, and sends only 5 hex characters', async () => {
    hibpAnswers('0018A45C4D1DEF81644B54AB7F969B88D65:0')
    signUp.mockResolvedValue({ data: {}, error: null })
    renderForm()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    await waitFor(() => expect(signUp).toHaveBeenCalled())

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url.startsWith('https://api.pwnedpasswords.com/range/')).toBe(true)
    expect(url.slice('https://api.pwnedpasswords.com/range/'.length)).toHaveLength(5)
    // The password itself is nowhere near the request.
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('hunter2secret')
    // Order: the check ran first, the signup second.
    expect(Number(fetchMock.mock.invocationCallOrder[0])).toBeLessThan(
      Number(signUp.mock.invocationCallOrder[0]),
    )
  })

  it('lets a clean password through', async () => {
    hibpAnswers('0018A45C4D1DEF81644B54AB7F969B88D65:1')
    signUp.mockResolvedValue({ data: {}, error: null })
    const { onSent } = renderForm()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
  })

  it('FAILS OPEN: a HIBP outage does not block the sign-up', async () => {
    // The default stub already rejects; spelled out here because this is the
    // decision under test, not incidental setup. A privacy extension blocking
    // api.pwnedpasswords.com looks exactly like this.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    signUp.mockResolvedValue({ data: {}, error: null })
    const { onSent } = renderForm()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
    expect(signUp).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/fuites de données publiques/)).toBeNull()
  })

  it('FAILS OPEN on a 503 too', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    signUp.mockResolvedValue({ data: {}, error: null })
    const { onSent } = renderForm()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
  })

  it('states the refusal in English when the UI is English', async () => {
    // No stored preference here (this env has no localStorage), so `LangProvider`
    // follows the system list — which is exactly the default path a real English
    // visitor takes.
    Object.defineProperty(window.navigator, 'languages', {
      value: ['en-GB'],
      configurable: true,
    })
    hibpAnswers(await breachedBodyFor('hunter2secret'))
    render(
      <LangProvider>
        <AuthProvider>
          <SignupForm onSent={vi.fn()} />
        </AuthProvider>
      </LangProvider>,
    )
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2secret' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'hunter2secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(
      await screen.findByText(
        'This password appears in public data breaches. Please choose another one.',
      ),
    ).toBeTruthy()
    expect(signUp).not.toHaveBeenCalled()
  })
})
