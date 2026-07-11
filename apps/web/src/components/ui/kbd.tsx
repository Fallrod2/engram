import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Kbd — small in-house keyboard-shortcut chip in mono 2xs (spec §8: no shadcn
 * `kbd`). Renders single keys or short chords.
 */
function Kbd({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-border bg-surface-2 px-1',
        'font-mono text-2xs leading-none text-text-faint',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}

export { Kbd }
