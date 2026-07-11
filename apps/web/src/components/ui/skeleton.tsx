import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Skeleton — surface-2 placeholder with a soft opacity pulse (spec §5/§7).
 * Loading states use these, never a full-screen spinner.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-sm bg-surface-2', className)} {...props} />
}

export { Skeleton }
