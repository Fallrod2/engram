import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useTheme } from '@/lib/theme'

/** Toaster — discrete bottom-corner notifications, themed to engram surfaces. */
function Toaster(props: ToasterProps) {
  const { resolved } = useTheme()
  return (
    <Sonner
      theme={resolved}
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
