import * as React from 'react'
import { cn } from '@/lib/utils'

/** Multiline field — same surface-2 language as Input. */
function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
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
