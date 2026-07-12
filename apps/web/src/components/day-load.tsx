import { cn } from '@/lib/utils'
import { dueCountTier } from '@/lib/due-count'
import { LoadMeter } from './load-meter'

/**
 * A day's load in a calendar cell/column (spec §7.1): the `<LoadMeter>` (length
 * = magnitude) redundantly encoded by a mono tabular number whose typographic
 * density encodes the tier (mirrors `DueCount`):
 *   0 → `·` text-faint · 1–20 → text-muted · 21–50 → text · >50 → text.
 * `max` is relative to the visible window so pressure reads within the grid.
 */
export function DayLoad({
  value,
  max,
  variant = 'cell',
  className,
}: {
  value: number
  max: number
  variant?: 'cell' | 'week'
  className?: string
}) {
  const tier = dueCountTier(value)
  const week = variant === 'week'

  if (tier === 'zero') {
    return (
      <span
        className={cn(
          'font-mono tabular-nums text-text-faint',
          week ? 'text-sm' : 'text-xs',
          className,
        )}
        aria-label="0 review prévue"
      >
        ·
      </span>
    )
  }

  const tone = tier === 'low' ? 'text-text-muted' : 'text-text'
  return (
    <span
      className={cn('flex items-center gap-1.5', className)}
      aria-label={`${value} reviews prévues`}
    >
      <span className={cn('font-mono tabular-nums', week ? 'text-base' : 'text-xs', tone)}>
        {value}
      </span>
      <LoadMeter value={value} max={max} className={week ? 'max-w-16' : 'w-10'} />
    </span>
  )
}
