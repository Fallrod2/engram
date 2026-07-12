import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMediaQuery } from '@/lib/use-media-query'
import { NAV_CHORDS } from '@/lib/keymap'
import { FLAT_NAV } from './nav'

const COLLAPSE_KEY = 'engram-sidebar-collapsed'
/** Window (ms) between pressing `g` and the chord's second key (spec §3.3). */
const G_CHORD_WINDOW = 1200

/** Kind of entity the global create host can open (spec §4.3). */
export type CreateKind = 'subject' | 'deck' | 'exam'

/** A pending global create request, consumed by `CreateHost` in `app-shell`. */
export interface CreateRequest {
  kind: CreateKind
  /** Required for `deck` (chosen via the palette's pick-subject sub-step). */
  subjectId?: string
}

interface ShellContextValue {
  /** Effective collapse (forced true on narrow viewports). */
  collapsed: boolean
  /** Whether the collapse toggle is meaningful (wide viewport only). */
  canToggleCollapse: boolean
  toggleCollapse: () => void
  commandOpen: boolean
  setCommandOpen: (open: boolean) => void
  /** Keyboard-shortcuts help dialog (`?`), mounted in `app-shell` (spec §3.4). */
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
  /** Open a global create dialog from anywhere (palette host, spec §4.3). */
  openCreate: (kind: CreateKind, opts?: { subjectId?: string }) => void
  /** The pending create request, or `null`. Read by `CreateHost`. */
  createRequest: CreateRequest | null
  closeCreate: () => void
  /**
   * True while a full-screen review session is mounted (spec §4.1). The global
   * shortcut handler early-returns so ⌘K / `[` / ⌘1…9 / g-chords never fire
   * mid-review.
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

/**
 * True when a Radix modal surface (Dialog / AlertDialog) is open (spec §3.3.1).
 * Radix stamps `data-state="open"` on the content of these roles. Global
 * shortcuts early-return while one is up so they never fire "through" a modal
 * whose focus sits on a button (not an editable field). `⌘K` is the one assumed
 * exception — the palette may re-invoke/close over a dialog (Radix stacks it).
 */
function isModalSurfaceOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) !== null
  )
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  // ≥1280 expands by default; 768–1279 collapses by default but stays
  // toggleable; <768 the sidebar is hidden (mobile tab bar takes over).
  const isWide = useMediaQuery('(min-width: 1280px)')
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [pref, setPref] = useState<boolean | null>(readCollapsePref)
  const [commandOpen, setCommandOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null)
  // A ref, not state: the session flag only gates the keydown handler and must
  // not re-subscribe the listener when it flips.
  const sessionActiveRef = useRef(false)
  const setSessionActive = useCallback((active: boolean) => {
    sessionActiveRef.current = active
  }, [])

  // g-chord state (spec §3.3). Refs, not state: the pending flag only gates the
  // keydown handler and must not re-render or re-subscribe the listener.
  const pendingGRef = useRef(false)
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearPendingG = useCallback(() => {
    pendingGRef.current = false
    if (gTimerRef.current) {
      clearTimeout(gTimerRef.current)
      gTimerRef.current = null
    }
  }, [])

  const openCreate = useCallback((kind: CreateKind, opts?: { subjectId?: string }) => {
    setCreateRequest({ kind, ...(opts?.subjectId ? { subjectId: opts.subjectId } : {}) })
  }, [])
  const closeCreate = useCallback(() => setCreateRequest(null), [])

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

  // Global shortcuts: ⌘K (palette), g-chords (nav), `?` (help), `[` (collapse),
  // ⌘1…9 (jump to nav item). All but ⌘K are inert while a session owns the
  // keyboard, a field is focused, or a modal surface is open (spec §3.3.1).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A full-screen session owns the keyboard (spec §4.1).
      if (sessionActiveRef.current) {
        clearPendingG()
        return
      }
      const mod = e.metaKey || e.ctrlKey

      // ⌘K — the one global that coexists with an open modal (Radix stacks it).
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        clearPendingG()
        setCommandOpen((o) => !o)
        return
      }

      // Every other global is inert while a modal surface owns the screen.
      // Escape is never intercepted here (Radix uses it to close the surface).
      if (isModalSurfaceOpen()) {
        clearPendingG()
        return
      }

      const editable = isEditableTarget(e.target)

      // Second key of a g-chord: navigate on a match, otherwise cancel.
      if (pendingGRef.current && !mod) {
        clearPendingG()
        if (!editable) {
          const chord = NAV_CHORDS.find((c) => c.key === e.key.toLowerCase())
          if (chord) {
            e.preventDefault()
            void navigate({ to: chord.to })
          }
        }
        return
      }

      // Arm a g-chord (spec §3.3): `g` alone, outside a field, opens the window.
      if (e.key.toLowerCase() === 'g' && !mod && !editable) {
        e.preventDefault()
        pendingGRef.current = true
        if (gTimerRef.current) clearTimeout(gTimerRef.current)
        gTimerRef.current = setTimeout(() => {
          pendingGRef.current = false
          gTimerRef.current = null
        }, G_CHORD_WINDOW)
        return
      }

      // `?` → toggle the keyboard-shortcuts help. Accept both the resolved `?`
      // char and Shift+`/` (layouts/synthetic events that report the base key).
      if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !mod && !editable) {
        e.preventDefault()
        setShortcutsOpen((o) => !o)
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

      if (e.key === '[' && !mod && !editable) {
        e.preventDefault()
        toggleCollapse()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearPendingG()
    }
  }, [navigate, toggleCollapse, clearPendingG])

  const value = useMemo<ShellContextValue>(
    () => ({
      collapsed,
      canToggleCollapse: isDesktop,
      toggleCollapse,
      commandOpen,
      setCommandOpen,
      shortcutsOpen,
      setShortcutsOpen,
      openCreate,
      createRequest,
      closeCreate,
      setSessionActive,
    }),
    [
      collapsed,
      isDesktop,
      toggleCollapse,
      commandOpen,
      shortcutsOpen,
      openCreate,
      createRequest,
      closeCreate,
      setSessionActive,
    ],
  )

  return <ShellContext value={value}>{children}</ShellContext>
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used within <ShellProvider>')
  return ctx
}
