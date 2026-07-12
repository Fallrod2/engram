import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * A non-due counter (decks/cards): mono tabular value in text-muted, right
 * aligned (spec §1.10). `value === undefined` renders a mini shimmer.
 */
export function CountStat({ value, className }: { value: number | undefined; className?: string }) {
  if (value === undefined) {
    return <Skeleton className={cn('h-2.5 w-6 justify-self-end', className)} />
  }
  return (
    <span className={cn('text-right font-mono text-xs tabular-nums text-text-muted', className)}>
      {value}
    </span>
  )
}
