import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useTheme } from '@/lib/theme'

/**
 * How long a toast stays, in ms — the project's ONE answer to that question.
 *
 * T-036 reported the undo toast ("Dernière note annulée") outstaying its
 * welcome. No call site in the app sets a duration, so it was never longer than
 * any other toast: every one of them rode sonner's internal `TOAST_LIFETIME`, a
 * library default nobody could read from this codebase. Declaring it here turns
 * an invisible default into a decision — 4 s, long enough to read one line,
 * short enough not to sit over the session's rating row — and gives the next
 * person a single place to change it for all 70-odd toasts at once.
 *
 * Sonner still pauses this countdown while the pointer is over the toast or the
 * window is unfocused; a toast observed lasting longer was being held, not
 * mis-configured.
 */
export const TOAST_DURATION_MS = 4000

/** Toaster — discrete bottom-corner notifications, themed to engram surfaces. */
function Toaster(props: ToasterProps) {
  const { resolved } = useTheme()
  return (
    <Sonner
      theme={resolved}
      duration={TOAST_DURATION_MS}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--color-surface-3)',
          '--normal-text': 'var(--color-text)',
          '--normal-border': 'var(--color-border)',
          '--border-radius': 'var(--radius-md)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'group toast font-sans border border-border bg-surface-3 text-text shadow-md',
          description: 'text-text-muted',
          actionButton: 'bg-accent-fill text-accent-fg hover:bg-accent-fill-hover',
          cancelButton: 'bg-surface-2 text-text-muted',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
