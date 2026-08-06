import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Multiline field — same surface-2 language as Input.
 *
 * `ComponentPropsWithRef` and not `TextareaHTMLAttributes`: the `ref` already
 * travelled through `{...props}` onto the `<textarea>` at runtime (React 19
 * passes it as an ordinary prop), the type simply did not say so — and a caller
 * that needs to put the caret back in a field (T-032's quick-add loop) has no
 * other way to reach the node. Widening only; every existing call site is
 * unaffected.
 */
function Textarea({ className, ...props }: React.ComponentPropsWithRef<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-text',
        'placeholder:text-text-faint',
        'transition-colors duration-fast ease-out hover:border-border-strong',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
