import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Theme model.
 *
 * - `theme` is the *preference*: `'dark' | 'light' | 'system'`.
 * - The resolved appearance is written as `data-theme` on `<html>` (only when
 *   an explicit dark/light is chosen); `'system'` removes the attribute so the
 *   CSS `prefers-color-scheme` fallback (see `styles.css`) takes over. That
 *   fallback is pure CSS, so an OS that flips to dark at sunset flips the app
 *   with it — no reload, no listener, nothing to miss.
 * - Preference is persisted in `localStorage` under `engram-theme`, and ONLY on
 *   an explicit choice (29/07/2026).
 *
 * NO STORED VALUE = NO CHOICE = FOLLOW THE SYSTEM (29/07/2026). The default used to
 * be `dark`, and the provider persisted whatever it had resolved on mount — so
 * the very first paint wrote `engram-theme=dark` for everyone, choice or not.
 * Two things follow, and both are deliberate:
 *
 *   · Writing moved out of the mount effect and into `setTheme`. From now on a
 *     stored value means somebody picked it, which is the whole premise of
 *     "an explicit choice is never overwritten".
 *   · Users who were here BEFORE this change already carry that auto-written
 *     `dark`, and it is indistinguishable from a real choice. They keep dark —
 *     the safe direction: the alternative is repainting an app someone may well
 *     have chosen to keep dark, to fix a preference they never expressed. One
 *     visit to Settings → « Système » puts them on the system default for good.
 */
export type ThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'engram-theme'

interface ThemeContextValue {
  /** The user's stored preference. */
  theme: ThemePreference
  /** The appearance actually rendered right now. */
  resolved: ResolvedTheme
  setTheme: (theme: ThemePreference) => void
  /** Convenience: flip between dark and light (never lands on `system`). */
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStoredTheme(): ThemePreference {
  // Aucune préférence stockée = aucun choix exprimé = on suit le système. Le
  // défaut projet reste sombre : `:root` est sombre dans `styles.css`, et le
  // clair n'arrive que sous `prefers-color-scheme: light`.
  if (typeof localStorage === 'undefined') return 'system'
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system'
  } catch {
    // Safari en navigation privée : `localStorage` existe et lève à l'accès.
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', theme)
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme)
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark)

  // Track the OS preference so `resolved` stays correct in `system` mode.
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Reflect the preference onto <html>. NOT persisted here: mounting is not
  // choosing, and a write on mount is exactly what made "no choice" and "chose
  // dark" the same stored string. Persistence belongs to `setTheme`.
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const resolved: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
    // `'system'` is stored like the rest: it is a choice — "go back to following
    // my OS" — and erasing the key instead would work today only because the
    // default happens to agree with it.
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Rien à faire : le choix s'applique quand même pour cette page.
    }
  }, [])
  // Goes through `setTheme`, so the flip is persisted like any other explicit
  // choice — it IS one, made from the shell instead of from Settings.
  const toggle = useCallback(
    () => setTheme(resolved === 'dark' ? 'light' : 'dark'),
    [resolved, setTheme],
  )

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme, toggle }),
    [theme, resolved, setTheme, toggle],
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
