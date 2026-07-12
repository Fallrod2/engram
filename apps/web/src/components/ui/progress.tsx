import { cn } from '@/lib/utils'

/**
 * Progress bar (Phase 3 §1.8) — in-house, token-aligned, no new dependency.
 * Two modes:
 *  - determinate: pass `value` (0–100) → an accent fill of that width.
 *  - indeterminate: omit `value` → a calm accent segment slides across the
 *    track (spec §4.2, generation-in-progress). Frozen under reduced-motion.
 *
 * The track is `surface-2`; the fill is the single accent (spec discipline —
 * this is the generation's only accent). `role="progressbar"` + ARIA value.
 */
export function Progress({
  value,
  className,
  'aria-label': ariaLabel,
}: {
  /** 0–100. Omit for an indeterminate bar. */
  value?: number
  className?: string
  'aria-label'?: string
}) {
  const indeterminate = value === undefined
  const clamped = indeterminate ? undefined : Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(clamped !== undefined ? { 'aria-valuenow': Math.round(clamped) } : {})}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-surface-2', className)}
    >
      {indeterminate ? (
        <div
          className="absolute inset-y-0 left-0 w-1/4 rounded-full bg-accent"
          style={{
            animation: 'engram-progress-indeterminate 1.4s var(--ease-out) infinite',
          }}
        />
      ) : (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-base ease-out"
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  )
}
