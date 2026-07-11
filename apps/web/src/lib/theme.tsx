import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Theme model.
 *
 * - `theme` is the *preference*: `'dark' | 'light' | 'system'`.
 * - The resolved appearance is written as `data-theme` on `<html>` (only when
 *   an explicit dark/light is chosen); `'system'` removes the attribute so the
 *   CSS `prefers-color-scheme` fallback (see `styles.css`) takes over.
 * - Preference is persisted in `localStorage` under `engram-theme`.
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
  if (typeof localStorage === 'undefined') return 'system'
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system'
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

  // Reflect the preference onto <html> and persist it.
  useEffect(() => {
    applyTheme(theme)
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const resolved: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  const setTheme = useCallback((next: ThemePreference) => setThemeState(next), [])
  const toggle = useCallback(
    () => setThemeState(resolved === 'dark' ? 'light' : 'dark'),
    [resolved],
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
