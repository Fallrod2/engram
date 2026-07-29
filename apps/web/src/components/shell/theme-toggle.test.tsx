// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/lib/theme'
import { LangProvider, type Lang } from '@/lib/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeToggle } from './theme-toggle'

/**
 * The theme toggle used to carry hardcoded French: `aria-label` ("Passer en
 * thème clair") and tooltip ("Thème clair"). It sits in the shell footer AND in
 * the landing header/footer, so an English visitor met French on the very first
 * screen — and, in a screen reader, with no way to work around it.
 *
 * Both strings name the theme the click takes you TO, not the current one; these
 * cases freeze that intent in both languages.
 */

function installMockStorage() {
  const store = new Map<string, string>()
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
}

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

beforeEach(() => {
  installMockStorage()
  installMatchMedia()
})
afterEach(cleanup)

function renderToggle(theme: 'dark' | 'light', lang: Lang) {
  localStorage.setItem('engram-theme', theme)
  localStorage.setItem('engram-lang', lang)
  return render(
    <ThemeProvider>
      <LangProvider>
        <TooltipProvider delayDuration={0}>
          <ThemeToggle />
        </TooltipProvider>
      </LangProvider>
    </ThemeProvider>,
  )
}

describe('<ThemeToggle> is localized (no hardcoded French)', () => {
  it('names the ACTION in the accessible name, in both languages', () => {
    // Dark active → the click switches to light, and that is what is announced.
    const dark = renderToggle('dark', 'fr')
    expect(screen.getByRole('button', { name: 'Passer en thème clair' })).toBeTruthy()
    dark.unmount()

    renderToggle('dark', 'en')
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy()
  })

  it('flips the announced destination with the active theme, in both languages', () => {
    const fr = renderToggle('light', 'fr')
    expect(screen.getByRole('button', { name: 'Passer en thème sombre' })).toBeTruthy()
    fr.unmount()

    renderToggle('light', 'en')
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy()
  })

  it('never leaves a French string in an English UI', () => {
    renderToggle('dark', 'en')
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-label')).not.toMatch(/thème|Passer/i)
  })

  it('shows the destination theme in the tooltip, in both languages', async () => {
    const fr = renderToggle('dark', 'fr')
    fireEvent.focus(screen.getByRole('button'))
    await waitFor(() => expect(screen.getAllByText('Thème clair').length).toBeGreaterThan(0))
    fr.unmount()

    renderToggle('dark', 'en')
    fireEvent.focus(screen.getByRole('button'))
    await waitFor(() => expect(screen.getAllByText('Light theme').length).toBeGreaterThan(0))
  })
})
