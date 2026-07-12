import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import type { RatingMeta } from './labels'

/**
 * One rating button (spec §4.3): Kbd + FR label, then the projected interval in
 * mono `tabular-nums` colored by the rating token. Border is neutral at rest;
 * hover/focus borrows the token color + its `-subtle` fill. Never a full colored
 * fill at rest (design: color reserved). Focus is the global indigo double-ring.
 */

interface TokenClasses {
  interval: string
  hover: string
  flash: string
}

// Literal class names (no interpolation) so Tailwind v4 keeps them.
const TOKENS: Record<RatingMeta['token'], TokenClasses> = {
  danger: {
    interval: 'text-danger',
    hover: 'hover:border-danger hover:bg-danger-subtle',
    flash: 'border-danger bg-danger-subtle',
  },
  warning: {
    interval: 'text-warning',
    hover: 'hover:border-warning hover:bg-warning-subtle',
    flash: 'border-warning bg-warning-subtle',
  },
  success: {
    interval: 'text-success',
    hover: 'hover:border-success hover:bg-success-subtle',
    flash: 'border-success bg-success-subtle',
  },
  info: {
    interval: 'text-info',
    hover: 'hover:border-info hover:bg-info-subtle',
    flash: 'border-info bg-info-subtle',
  },
}

export function RatingButton({
  meta,
  interval,
  disabled,
  flash,
  onRate,
}: {
  meta: RatingMeta
  /** Formatted interval, or undefined while the preview is pending → `·`. */
  interval: string | undefined
  disabled: boolean
  flash: boolean
  onRate: () => void
}) {
  const t = TOKENS[meta.token]
  const label = interval
    ? `${meta.a11y} — prochaine révision dans ${interval}`
    : `${meta.a11y} — noter cette carte`
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onRate}
      aria-label={label}
      aria-keyshortcuts={String(meta.grade)}
      className={cn(
        'flex h-16 flex-col items-center justify-center gap-1 rounded-md border bg-surface-2',
        'transition-colors duration-fast ease-out disabled:pointer-events-none',
        flash ? t.flash : 'border-border',
        !flash && t.hover,
      )}
    >
      <span className="flex items-center gap-1.5">
        <Kbd>{meta.grade}</Kbd>
        <span className="text-sm font-medium text-text">{meta.label}</span>
      </span>
      <span
        className={cn('font-mono text-xs tabular-nums', interval ? t.interval : 'text-text-faint')}
      >
        {interval ?? '·'}
      </span>
    </button>
  )
}
