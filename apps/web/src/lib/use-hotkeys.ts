import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'

/** True when the event target is a text-entry surface (input/textarea/CE). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

/**
 * True when a Radix modal surface (Dialog / AlertDialog) is open. Radix stamps
 * `data-state="open"` on the content of these roles while they are mounted.
 *
 * NOTE: this predicate is intentionally duplicated from `isModalSurfaceOpen` in
 * `components/shell/shell-context.tsx` — `lib/` must not depend on `shell/`.
 * Keep the two selectors in sync if either changes (same modal criterion).
 */
function isModalSurfaceOpen(): boolean {
  if (typeof document === 'undefined') return false
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) !== null
  )
}

export interface HotkeyHandler {
  /** Run the action. Return nothing. */
  (e: KeyboardEvent): void
}

export interface HotkeysOptions {
  enabled?: boolean
  /**
   * Let single-key hotkeys fire while a Radix modal surface (Dialog /
   * AlertDialog) is open. Off by default: a screen's local single-key
   * shortcuts (`a`, `e`, `n`…) must not leak to the background while a dialog
   * owns the keyboard, even when focus sits on a button (not an editable
   * field). Modifier combos (`mod+…`) and `Escape` always fire regardless.
   */
  allowInModal?: boolean
  target?: Window | HTMLElement | null
}

/**
 * Lightweight keyboard-shortcut hook (spec §1.7). Keys are matched
 * case-insensitively; prefix with `mod+` for ⌘/Ctrl (e.g. `mod+enter`).
 * Single-key bindings are suppressed while a text field holds focus, except
 * `escape` and any `mod+` combo.
 */
export function useHotkeys(map: Record<string, HotkeyHandler>, options: HotkeysOptions = {}): void {
  const { enabled = true, allowInModal = false } = options

  // Navigation-aware guard (spec §1.7, §4). TanStack Router keeps the previous
  // route's component — and therefore its `window` keydown listener — mounted
  // while the next route's loader is in flight. Without this, a single-key
  // shortcut typed mid-navigation would fire the *old* screen's handler (e.g.
  // creating a subject while entering a deck). Suppress every screen's hotkeys
  // while a navigation is pending so only the settled route can act.
  const navigating = useRouterState({ select: (s) => s.status !== 'idle' })

  useEffect(() => {
    if (!enabled || navigating) return
    const el: Window | HTMLElement = options.target ?? window

    const onKeyDown = (ev: Event) => {
      const e = ev as KeyboardEvent
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      for (const [combo, handler] of Object.entries(map)) {
        const wantsMod = combo.startsWith('mod+')
        const wantKey = wantsMod ? combo.slice(4) : combo
        if (wantsMod !== mod) continue
        if (wantKey !== key) continue
        // Single-key bindings are muted inside fields (except Escape).
        if (!wantsMod && key !== 'escape' && isEditableTarget(e.target)) continue
        // Single-key bindings are muted while a modal surface is open, so a
        // screen's local shortcuts never fire "through" a dialog whose focus
        // sits on a button. Modifier combos, Escape, and opt-in (`allowInModal`)
        // handlers still fire.
        if (!wantsMod && key !== 'escape' && !allowInModal && isModalSurfaceOpen()) continue
        handler(e)
        return
      }
    }

    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [map, enabled, allowInModal, navigating, options.target])
}
