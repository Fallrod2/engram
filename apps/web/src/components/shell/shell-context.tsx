import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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
}

const ShellContext = createContext<ShellContextValue | null>(null)

function readCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(COLLAPSE_KEY) === 'true'
}

/** True when the target of a keyboard event is a text-entry surface. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const isWide = useMediaQuery('(min-width: 1280px)')
  const [userCollapsed, setUserCollapsed] = useState<boolean>(readCollapsed)
  const [commandOpen, setCommandOpen] = useState(false)

  // Below 1280px the sidebar is always collapsed (spec §5 responsive).
  const collapsed = isWide ? userCollapsed : true

  const toggleCollapse = useCallback(() => {
    if (!isWide) return
    setUserCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(COLLAPSE_KEY, String(next))
      return next
    })
  }, [isWide])

  // Global shortcuts: ⌘K (palette), [ (collapse), ⌘1…9 (jump to nav item).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
      canToggleCollapse: isWide,
      toggleCollapse,
      commandOpen,
      setCommandOpen,
    }),
    [collapsed, isWide, toggleCollapse, commandOpen],
  )

  return <ShellContext value={value}>{children}</ShellContext>
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used within <ShellProvider>')
  return ctx
}
