// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * THE RACE THIS FILE EXISTS FOR.
 *
 * `finish()` fires the completion PATCH without awaiting it and navigates away
 * immediately. That navigation runs the root `beforeLoad`, which offers the
 * journey unless the latch in `gate.ts` is already set.
 *
 * Landing DIRECTLY on `/onboarding` leaves that latch unset — the gate exempts
 * the path and returns BEFORE latching — and leaves the query cache empty, so
 * the `staleTime: Infinity` on the status query protects nothing. The
 * `beforeLoad` therefore fires a fresh `GET /api/onboarding` that races the
 * PATCH still in flight; a read is shorter than an upsert-then-reread, nothing
 * orders the two in serverless, and the read winning reports `pending: true` and
 * bounces the user straight back into the screen they just left. On the very
 * first screen a new user ever sees.
 *
 * The fix is ordering, and ordering is what is asserted here: the latch is set
 * BEFORE the navigation, on every door out of the journey. `invocationCallOrder`
 * is the assertion — "both were called" would pass on the broken code too.
 */

const { navigate, completeMutate, markOffered } = vi.hoisted(() => ({
  navigate: vi.fn(),
  completeMutate: vi.fn(),
  markOffered: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('./queries', () => ({ useCompleteOnboarding: () => ({ mutate: completeMutate }) }))
vi.mock('./gate', () => ({ markOnboardingOffered: markOffered }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// Steps 2 and 3 own their own network; this file is about the shell's exits.
vi.mock('@/features/study-settings/study-pace-fields', () => ({
  StudyPaceFields: () => <div data-testid="pace-fields" />,
}))
vi.mock('./ai-step', () => ({ AiStep: () => <div data-testid="ai-step" /> }))

import { LangProvider } from '@/lib/i18n'
import { ThemeProvider } from '@/lib/theme'
import { OnboardingFlow } from './onboarding-flow'

afterEach(cleanup)

const store = new Map<string, string>()
beforeEach(() => {
  navigate.mockClear()
  completeMutate.mockClear()
  markOffered.mockClear()
  store.clear()
  const mock: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true })
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
})

function renderFlow(lang: 'fr' | 'en' = 'fr') {
  localStorage.setItem('engram-lang', lang)
  return render(
    <ThemeProvider>
      <LangProvider>
        <OnboardingFlow />
      </LangProvider>
    </ThemeProvider>,
  )
}

const quit = () => screen.getByRole('button', { name: 'Quitter la mise en route' })
const forward = () => screen.getByRole('button', { name: /Continuer|Terminer sans IA/ })

/** Every call to `markOnboardingOffered` happened before every `navigate`. */
function latchedBeforeNavigating() {
  const latch = Math.max(...markOffered.mock.invocationCallOrder)
  const nav = Math.min(...navigate.mock.invocationCallOrder)
  return latch < nav
}

describe('leaving the journey never bounces back into it', () => {
  it('latches BEFORE navigating when the user quits from the header', () => {
    renderFlow()
    fireEvent.click(quit())
    expect(markOffered).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
    expect(latchedBeforeNavigating()).toBe(true)
  })

  it('latches BEFORE navigating when the user quits from the LAST step', () => {
    renderFlow()
    fireEvent.click(forward()) // → pace
    fireEvent.click(forward()) // → ai
    expect(screen.getByTestId('ai-step')).toBeTruthy()
    fireEvent.click(forward()) // « Terminer sans IA » — finishes the journey
    expect(markOffered).toHaveBeenCalledTimes(1)
    expect(latchedBeforeNavigating()).toBe(true)
  })

  it('still records the completion — the latch is an addition, not a replacement', () => {
    renderFlow()
    fireEvent.click(quit())
    expect(completeMutate.mock.calls[0]?.[0]).toEqual({ completed: true })
  })

  it('leaves anyway when the marker write fails — a failed PATCH is not a cage', () => {
    // The mutation's `onError` is invoked as the network would; the navigation
    // has already been requested, and the latch keeps this page load quiet.
    completeMutate.mockImplementationOnce(
      (_vars: unknown, opts?: { onError?: (e: unknown) => void }) =>
        opts?.onError?.(new Error('offline')),
    )
    renderFlow()
    fireEvent.click(quit())
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
    expect(latchedBeforeNavigating()).toBe(true)
  })
})

describe('advancing through the steps', () => {
  it('writes nothing and navigates nowhere until the journey actually ends', () => {
    renderFlow()
    fireEvent.click(forward()) // appearance → pace
    expect(screen.getByTestId('pace-fields')).toBeTruthy()
    expect(completeMutate).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(markOffered).not.toHaveBeenCalled()
  })

  it('offers exactly ONE forward control per step, never two doing the same thing', () => {
    renderFlow()
    // The regression: « Passer cette étape » and « Continuer » side by side,
    // wired to the same handler, on a step where they cannot differ.
    expect(screen.getAllByRole('button', { name: /Continuer|Passer|Terminer/ })).toHaveLength(1)
    fireEvent.click(forward())
    expect(screen.getAllByRole('button', { name: /Continuer|Passer|Terminer/ })).toHaveLength(1)
  })

  it('has no way back from the first step, and one from every other', () => {
    renderFlow()
    expect(screen.queryByRole('button', { name: 'Retour' })).toBeNull()
    fireEvent.click(forward())
    expect(screen.getByRole('button', { name: 'Retour' })).toBeTruthy()
  })

  it('announces its progress, in a live region and on a real progressbar', () => {
    renderFlow()
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(bar.getAttribute('aria-valuemax')).toBe('3')
    fireEvent.click(forward())
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2')
  })

  it('speaks English too', () => {
    renderFlow('en')
    expect(screen.getByRole('button', { name: 'Quit getting started' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeTruthy()
  })
})
