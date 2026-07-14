import { cn } from '@/lib/utils'
import { dueBarWidth, dueCountTier } from '@/lib/due-count'
import { SUBJECT_BG_CLASS, pigmentSlotForHex } from '@/lib/pigments'

/**
 * Due count as "pressure", not alert (design §6.1). Mono tabular, right
 * aligned; intensity encodes urgency by weight — never color, never red.
 *   0 → `·` text-faint · 1–20 → text-muted · 21–50 → text
 *   >50 → text + a 2px subject-tinted load bar under the number.
 */
export function DueCount({
  value,
  colorHex,
  className,
}: {
  value: number
  /** Stored subject hex; tints the >50 load bar. Omit for a neutral total. */
  colorHex?: string | undefined
  className?: string
}) {
  const tier = dueCountTier(value)

  if (tier === 'zero') {
    return (
      <span
        className={cn('font-mono text-xs tabular-nums text-text-faint', className)}
        aria-label="0 à réviser"
      >
        ·
      </span>
    )
  }

  const tone = tier === 'low' ? 'text-text-muted' : 'text-text'
  const slot = colorHex ? pigmentSlotForHex(colorHex) : null

  return (
    <span
      className={cn('inline-flex flex-col items-end gap-0.5', className)}
      aria-label={`${value} à réviser`}
    >
      <span className={cn('font-mono text-xs tabular-nums', tone)}>{value}</span>
      {tier === 'high' && colorHex ? (
        <span className="h-0.5 w-8 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <span
            className={cn('block h-full', slot ? SUBJECT_BG_CLASS[slot] : undefined)}
            style={
              slot
                ? { width: `${dueBarWidth(value)}%` }
                : { width: `${dueBarWidth(value)}%`, background: colorHex }
            }
          />
        </span>
      ) : null}
    </span>
  )
}

/**
 * Collapsed-sidebar variant: the due count becomes a micro badge over an icon
 * (spec §5). Hidden at zero (the calm `·` has no badge form).
 */
export function DueBadge({ value, className }: { value: number; className?: string }) {
  if (value <= 0) return null
  return (
    <span
      className={cn(
        'flex min-w-3.5 items-center justify-center rounded-full bg-accent-fill px-1',
        'font-mono text-[9px] leading-none text-accent-fg tabular-nums',
        className,
      )}
      aria-hidden
    >
      {value > 99 ? '99+' : value}
    </span>
  )
}
