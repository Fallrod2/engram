// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/lib/theme'
import { LangProvider, type Lang } from '@/lib/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeToggle } from './theme-toggle'

/**
 * Only the SYSTEM signal is mocked; `motion` itself stays real, because what the
 * T-053 cases below read is the style the real renderer puts on the node. Same
 * reasoning as `lib/motion.test.ts`: driving this through `matchMedia` would
 * test motion's media-query plumbing, which caches a listener per module load
 * and is not what is in question here.
 */
const system = { reduced: false }
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => system.reduced,
}))

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
  system.reduced = false
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

/**
 * ═══ The icon swap obeys the motion preference (T-053).
 *
 * It never did. This `motion.span` animated from the day it was written and the
 * file did not mention `useReducedMotion` once, so the spin played for anyone
 * who had asked their OS for less movement — and kept playing whatever the
 * product override said. `motion` does not do this for you: it auto-respects the
 * media query only under a `<MotionConfig reducedMotion="user">`, and this app
 * mounts none.
 *
 * WHAT THIS FILE PROVES. jsdom has no animation engine, so nothing here observes
 * a tween. What it does observe is the state motion puts in the DOM on MOUNT,
 * which is exactly where the two cases differ and is not a tween at all:
 *
 *   animating  → `opacity: 0; transform: rotate(-30deg)`  (the `initial` pose,
 *                the thing it is about to move away from)
 *   reduced    → `opacity: 1; transform: none`            (`initial={false}`:
 *                mounted at rest, with nothing to move away from)
 *
 * So a regression that dropped the `reduce` gate would put `rotate(-30deg)` back
 * on the node under a reduced-motion preference, and these cases would fail.
 * Confirmed in a real browser as well (Chromium, emulated `prefers-reduced-
 * motion: reduce`, then `data-motion='full'`) — see the T-053 commit message.
 */
describe('<ThemeToggle> obeys the motion preference (T-053)', () => {
  /** The `motion.span` wrapping the icon: the only span the button renders. */
  function iconStyle(container: HTMLElement): string {
    const span = container.querySelector('button > span')
    return span?.getAttribute('style') ?? ''
  }

  it('mounts the icon at rest when the system asks for reduced motion', () => {
    system.reduced = true
    const { container } = renderToggle('dark', 'fr')
    expect(iconStyle(container)).not.toContain('rotate')
    expect(iconStyle(container)).toContain('transform: none')
  })

  it('still animates when the system asks for nothing', () => {
    // The control case. Without it, the assertion above would also pass on a
    // component that never animates at all, and would prove nothing.
    system.reduced = false
    const { container } = renderToggle('dark', 'fr')
    expect(iconStyle(container)).toContain('rotate(-30deg)')
  })

  it('animates again when the user overrides the system from Settings', () => {
    // `engram-motion: full` is the deliberate "yes, I know, animate anyway".
    // This is what pins the component to `@/lib/motion` rather than to motion's
    // raw hook: reading the raw one would still pass the two cases above and
    // fail here, because the override is folded in by `lib/motion.ts` alone.
    system.reduced = true
    localStorage.setItem('engram-motion', 'full')
    const { container } = renderToggle('dark', 'fr')
    expect(iconStyle(container)).toContain('rotate(-30deg)')
  })
})
