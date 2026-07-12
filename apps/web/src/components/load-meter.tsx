import { cn } from '@/lib/utils'

/**
 * Review load as a neutral-intensity magnitude (spec §7.1, dataviz).
 *
 * A monochrome SEQUENTIAL meter: one cold-ink hue, length ∝ `min(1, value/max)`.
 * Length is the primary (fully colorblind-safe) channel — never red, never a
 * rating tint, never the accent (those are reserved). The exact number lives in
 * `<DayLoad>` alongside it; this bar is decorative (`aria-hidden`).
 */
export function LoadMeter({
  value,
  max,
  orientation = 'horizontal',
  className,
}: {
  value: number
  max: number
  orientation?: 'horizontal' | 'vertical'
  className?: string
}) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0
  const pct = `${Math.round(ratio * 100)}%`
  const vertical = orientation === 'vertical'
  return (
    <span
      className={cn(
        'block overflow-hidden rounded-full bg-surface-3',
        vertical ? 'h-full w-1' : 'h-0.5 w-full',
        className,
      )}
      aria-hidden
    >
      <span
        className={cn(
          'block bg-text-faint transition-[height,width] duration-fast',
          vertical ? 'w-full' : 'h-full',
        )}
        style={vertical ? { height: pct } : { width: pct }}
      />
    </span>
  )
}
