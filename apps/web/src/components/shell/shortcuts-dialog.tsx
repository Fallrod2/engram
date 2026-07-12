import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Kbd } from '@/components/ui/kbd'
import {
  CONTEXT_KEYS,
  CONTEXT_LABELS,
  GLOBAL_KEYS,
  NAV_KEYS,
  contextForPathname,
  type KeyBinding,
} from '@/lib/keymap'
import { useShell } from './shell-context'

/** Render a binding's space-separated tokens, one `<Kbd>` each. */
function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex items-center gap-1">
      {keys.split(' ').map((token, i) => (
        <Kbd key={i}>{token}</Kbd>
      ))}
    </span>
  )
}

function Section({ title, bindings }: { title: string; bindings: readonly KeyBinding[] }) {
  return (
    <div>
      <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
        {title}
      </p>
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
        {bindings.map((b, i) => (
          <div key={i} className="contents">
            <span className="text-sm text-text">{b.label}</span>
            <Keys keys={b.keys} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Keyboard-shortcuts help (spec §3.4), opened by `?`. Lists the globals, the
 * navigation chords, and the shortcuts of the current screen — resolved from the
 * pathname via `keymap.ts`'s exhaustive context map (§3.4.1). Closes on Échap,
 * click-outside, or `?`.
 */
export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useShell()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const ctx = contextForPathname(pathname)

  // The help has no focused input, so screen-local single-key hotkeys (native
  // window listeners we don't own) would otherwise fire *behind* the open help.
  // A capture-phase window listener runs before those bubble-phase listeners and
  // swallows printable keys while the help owns the keyboard (spec §3.3.1 spirit).
  // Escape, Tab and arrows pass through so Radix can close / trap focus; `?`
  // closes the help here (the global `?` handler is muted while a modal is open).
  useEffect(() => {
    if (!shortcutsOpen) return
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab' || e.key.startsWith('Arrow')) return
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setShortcutsOpen(false)
        return
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDownCapture, true)
    return () => window.removeEventListener('keydown', onKeyDownCapture, true)
  }, [shortcutsOpen, setShortcutsOpen])

  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raccourcis clavier</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Section title="Globaux" bindings={GLOBAL_KEYS} />
          <Separator />
          <Section title="Navigation" bindings={NAV_KEYS} />
          {ctx && (
            <>
              <Separator />
              <Section title={`Écran — ${CONTEXT_LABELS[ctx]}`} bindings={CONTEXT_KEYS[ctx]} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
