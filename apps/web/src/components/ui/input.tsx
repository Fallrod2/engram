import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Text input — surface-2 field, hairline border, mono not forced.
 *
 * Props include `ref` (React 19 passes it as a normal prop): the search screen
 * needs to focus its field from a keyboard shortcut.
 */
function Input({ className, type, ...props }: React.ComponentPropsWithRef<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-8 w-full rounded-sm border border-border bg-surface-2 px-3 text-sm text-text',
        'placeholder:text-text-faint',
        'transition-colors duration-fast ease-out hover:border-border-strong',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
