import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMediaQuery } from '@/lib/use-media-query'
import { FLAT_NAV } from './nav'

const COLLAPSE_KEY = 'engram-sidebar-collapsed'

interface ShellContextValue {
  /** Effective collapse (forced true on narrow viewports). */
  collapsed: boolean
  /** Whether the collapse toggle is meaningful (wide viewport only). */
  canToggleCollapse: boolean
  toggleCollapse: () => void
  commandOpen: boolean
  setCommandOpen: (open: boolean) => void
  /**
   * True while a full-screen review session is mounted (spec §4.1). The global
   * shortcut handler early-returns so ⌘K / `[` / ⌘1…9 never fire mid-review.
   */
  setSessionActive: (active: boolean) => void
}

const ShellContext = createContext<ShellContextValue | null>(null)

/** Stored collapse preference, or `null` when the user has never chosen. */
function readCollapsePref(): boolean | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(COLLAPSE_KEY)
  return raw === 'true' ? true : raw === 'false' ? false : null
}

/** True when the target of a keyboard event is a text-entry surface. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  // ≥1280 expands by default; 768–1279 collapses by default but stays
  // toggleable; <768 the sidebar is hidden (mobile tab bar takes over).
  const isWide = useMediaQuery('(min-width: 1280px)')
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [pref, setPref] = useState<boolean | null>(readCollapsePref)
  const [commandOpen, setCommandOpen] = useState(false)
  // A ref, not state: the session flag only gates the keydown handler and must
  // not re-subscribe the listener when it flips.
  const sessionActiveRef = useRef(false)
  const setSessionActive = useCallback((active: boolean) => {
    sessionActiveRef.current = active
  }, [])

  // No stored choice → auto: expanded when wide, collapsed when narrower.
  const collapsed = pref ?? !isWide

  const toggleCollapse = useCallback(() => {
    if (!isDesktop) return
    setPref((prev) => {
      const base = prev ?? !isWide
      const next = !base
      localStorage.setItem(COLLAPSE_KEY, String(next))
      return next
    })
  }, [isDesktop, isWide])

  // Global shortcuts: ⌘K (palette), [ (collapse), ⌘1…9 (jump to nav item).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A full-screen session owns the keyboard (spec §4.1).
      if (sessionActiveRef.current) return
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((o) => !o)
        return
      }

      if (mod && /^[1-9]$/.test(e.key)) {
        const target = FLAT_NAV[Number(e.key) - 1]
        if (target) {
          e.preventDefault()
          void navigate({ to: target.to })
        }
        return
      }

      if (e.key === '[' && !mod && !isEditableTarget(e.target)) {
        e.preventDefault()
        toggleCollapse()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, toggleCollapse])

  const value = useMemo<ShellContextValue>(
    () => ({
      collapsed,
      canToggleCollapse: isDesktop,
      toggleCollapse,
      commandOpen,
      setCommandOpen,
      setSessionActive,
    }),
    [collapsed, isDesktop, toggleCollapse, commandOpen, setSessionActive],
  )

  return <ShellContext value={value}>{children}</ShellContext>
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used within <ShellProvider>')
  return ctx
}
