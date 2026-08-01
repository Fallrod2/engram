import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * A non-due counter (decks/cards): mono tabular value in text-muted, right
 * aligned (spec §1.10). `value === undefined` renders a mini shimmer.
 *
 * T-042 — a shimmer says "still coming", which is a claim of its own, and it is
 * false the moment the read has failed: the cell then shimmers for ever and the
 * screen looks busy rather than broken. `unknown` is the third state: the
 * column keeps its width and prints an em-dash instead of a figure nobody has.
 */
export function CountStat({
  value,
  unknown = false,
  className,
}: {
  value: number | undefined
  /** The read FAILED (as opposed to `value === undefined`, still in flight). */
  unknown?: boolean
  className?: string
}) {
  const t = useT()
  if (unknown) {
    return (
      <span
        aria-label={t('common.unknownValue')}
        className={cn('text-right font-mono text-xs tabular-nums text-text-faint', className)}
      >
        —
      </span>
    )
  }
  if (value === undefined) {
    return <Skeleton className={cn('h-2.5 w-6 justify-self-end', className)} />
  }
  return (
    <span className={cn('text-right font-mono text-xs tabular-nums text-text-muted', className)}>
      {value}
    </span>
  )
}
