import { useEffect } from 'react'

/** True when the event target is a text-entry surface (input/textarea/CE). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export interface HotkeyHandler {
  /** Run the action. Return nothing. */
  (e: KeyboardEvent): void
}

export interface HotkeysOptions {
  enabled?: boolean
  /**
   * Allow single-key hotkeys to fire while a field is focused. Off by default —
   * `n`, `e`, `/`, `j`, `k`… are disabled in inputs (spec §1.7). Combos with a
   * modifier and `Escape` always fire regardless.
   */
  target?: Window | HTMLElement | null
}

/**
 * Lightweight keyboard-shortcut hook (spec §1.7). Keys are matched
 * case-insensitively; prefix with `mod+` for ⌘/Ctrl (e.g. `mod+enter`).
 * Single-key bindings are suppressed while a text field holds focus, except
 * `escape` and any `mod+` combo.
 */
export function useHotkeys(map: Record<string, HotkeyHandler>, options: HotkeysOptions = {}): void {
  const { enabled = true } = options

  useEffect(() => {
    if (!enabled) return
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
        handler(e)
        return
      }
    }

    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [map, enabled, options.target])
}
