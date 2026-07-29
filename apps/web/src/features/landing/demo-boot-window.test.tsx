// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LangProvider } from '@/lib/i18n'
import { DemoBootWindow } from './demo-boot-window'
import type { DemoBootState } from './use-demo-boot'

/**
 * The window's contract with the visitor: it never says anything the server did
 * not say, it is never a dead end, and its way out matches what actually
 * happened (a session installed or not).
 */

function installMatchMedia() {
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
}

function installMockStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return store.size
      },
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => void store.delete(k),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
    } satisfies Storage,
  })
}

const handlers = () => ({
  onRetry: vi.fn(),
  onDismiss: vi.fn(),
  onEnterAnyway: vi.fn(),
})

function renderWindow(state: DemoBootState, h = handlers(), lang: 'fr' | 'en' = 'fr') {
  localStorage.setItem('engram-lang', lang)
  render(
    <LangProvider>
      <DemoBootWindow open state={state} {...h} />
    </LangProvider>,
  )
  return h
}

/**
 * Closing must actually remove it. Radix's exit animation cannot be trusted here:
 * with `prefers-reduced-motion` on, the global 0.01 ms clamp in `styles.css` makes
 * `Presence` miss its `animationend` and the closed dialog stays on screen
 * (observed in Chrome). A boot window that cannot be dismissed is the exact
 * failure this whole feature is meant to avoid.
 */
it('renders nothing at all when closed', () => {
  render(
    <LangProvider>
      <DemoBootWindow
        open={false}
        state={{ phase: 'working', step: 'prepare', server: null }}
        {...handlers()}
      />
    </LangProvider>,
  )
  expect(screen.queryByRole('dialog')).toBeNull()
})

beforeEach(() => {
  installMatchMedia()
  installMockStorage()
})
afterEach(cleanup)

const working = (
  step: 'session' | 'prepare' | 'install',
  server: 'pending' | 'seeding' | 'ready' | null = null,
): DemoBootState => ({ phase: 'working', step, server })

describe('<DemoBootWindow> — while it works', () => {
  it('lists the three real steps and marks where it is', () => {
    renderWindow(working('prepare'))
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'Ouverture de la session — terminé',
      'Préparation des données — en cours',
      'Connexion de ce navigateur — en attente',
    ])
  })

  it('quotes the server state instead of inventing a sub-step', () => {
    renderWindow(working('prepare', 'seeding'))
    expect(screen.getByText('Le serveur installe les cartes de démonstration.')).toBeTruthy()
    // `pending` is a different, equally true statement — not the same sentence.
    cleanup()
    renderWindow(working('prepare', 'pending'))
    expect(screen.getByText('Le serveur n’a pas encore commencé.')).toBeTruthy()
  })

  it('uses an INDETERMINATE bar — the duration is genuinely unknown', () => {
    renderWindow(working('prepare'))
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    expect(bar.getAttribute('aria-label')).toBe('Ouverture de la démo en cours')
  })

  it('cannot be dismissed mid-flight — no ✕, and Escape is swallowed', () => {
    const h = renderWindow(working('prepare'))
    expect(screen.queryByRole('button', { name: 'Fermer' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(h.onDismiss).not.toHaveBeenCalled()
  })

  it('announces progress to a screen reader', () => {
    renderWindow(working('prepare', 'seeding'))
    const live = screen.getByRole('status')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toBe('Préparation des données — en cours')
  })
})

describe('<DemoBootWindow> — when it goes wrong it is never a dead end', () => {
  const failed = (
    failure: 'session' | 'prepare' | 'install' | 'timeout',
    resumable: boolean,
  ): DemoBootState => ({
    phase: 'failed',
    failure,
    step: failure === 'timeout' ? 'prepare' : failure,
    resumable,
  })

  it('names the actual cause rather than one generic message', () => {
    renderWindow(failed('session', false))
    expect(screen.getByRole('heading', { name: 'La démo n’a pas pu s’ouvrir' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Rien n’a été installé')
  })

  it('says how long it waited when the deadline is what fired', () => {
    renderWindow(failed('timeout', true))
    expect(screen.getByRole('alert').textContent).toBe(
      'Au bout de 20 secondes, le serveur n’a toujours pas confirmé que les données de ' +
        'démonstration étaient prêtes. Ce navigateur n’a pas encore été connecté.',
    )
  })

  it('offers retry and close, and becomes escapable', () => {
    const h = renderWindow(failed('session', false))
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(h.onRetry).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(h.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('offers "enter anyway" ONLY when there really is a token to enter with', () => {
    renderWindow(failed('session', false))
    expect(screen.queryByRole('button', { name: 'Entrer quand même' })).toBeNull()
    cleanup()
    const h = renderWindow(failed('timeout', true))
    fireEvent.click(screen.getByRole('button', { name: 'Entrer quand même' }))
    expect(h.onEnterAnyway).toHaveBeenCalledTimes(1)
  })
})

describe('<DemoBootWindow> — i18n', () => {
  it('is fully translated in English', () => {
    renderWindow(working('prepare', 'seeding'), handlers(), 'en')
    expect(screen.getByRole('heading', { name: 'Opening the demo' })).toBeTruthy()
    expect(screen.getByText('The server is installing the demo cards.')).toBeTruthy()
    expect(screen.getAllByRole('listitem')[1]?.textContent).toBe(
      'Preparing the data — in progressThe server is installing the demo cards.',
    )
  })
})
