import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { formatDelta, type Delta } from '../metrics'
import { cn } from '@/lib/utils'

/**
 * A KPI stat tile (spec §3). Figures, not a chart. The value is mono tabular
 * (design: measured data is mono). The delta is NEUTRAL — a ▲/▼ glyph plus a
 * muted mono ratio, never red/green (those hues are reserved for ratings); the
 * sign and direction read from the glyph, not from color.
 */
export function StatTile({
  label,
  value,
  icon,
  delta,
  deltaPeriod,
  meta,
  trend,
}: {
  label: string
  value: ReactNode
  icon?: ReactNode
  delta?: Delta
  /** e.g. "sur 30 j" — the period the delta compares against. */
  deltaPeriod?: string
  /** A calm meta line (record, reliability count, low-data note). */
  meta?: ReactNode
  trend?: ReactNode
}) {
  const showDelta = delta && delta.pct !== null
  return (
    <div className="flex flex-col rounded-md bg-surface-2 px-4 py-3">
      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        {icon && <span className="text-text-muted">{icon}</span>}
        <span className="font-mono text-2xl font-medium leading-none tracking-[-0.01em] text-text tabular-nums">
          {value}
        </span>
      </div>
      <div className="mt-2 flex min-h-4 items-center gap-2">
        {showDelta && (
          <span className="flex items-center gap-0.5 text-text-muted">
            {delta.direction === 'up' ? (
              <ArrowUp className="size-3" strokeWidth={2} aria-hidden />
            ) : delta.direction === 'down' ? (
              <ArrowDown className="size-3" strokeWidth={2} aria-hidden />
            ) : null}
            <span className="font-mono text-xs tabular-nums">{formatDelta(delta)}</span>
            {deltaPeriod && <span className="text-2xs text-text-faint">{deltaPeriod}</span>}
          </span>
        )}
        {!showDelta && meta && <span className="text-xs text-text-faint">{meta}</span>}
      </div>
      {trend && <div className={cn('mt-2', !trend && 'hidden')}>{trend}</div>}
    </div>
  )
}
