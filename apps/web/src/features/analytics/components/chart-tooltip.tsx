import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Shared HTML tooltip shell (spec §1.3) — never Recharts' default. The value
 * leads (inverted hierarchy), a short line-key carries the series identity, and
 * the label + date wear TEXT tokens, never the series color. Series labels are
 * plain React children (text nodes) — never `innerHTML` on untrusted data.
 */
export function TooltipShell({ date, children }: { date: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none rounded-md border border-border bg-surface-3 px-2.5 py-2 shadow-md">
      <div className="flex flex-col gap-1">{children}</div>
      <div className="mt-1.5 font-mono text-2xs text-text-faint">{date}</div>
    </div>
  )
}

/** One tooltip row: mono value, line-key of the token color, sans label. */
export function TooltipRow({
  colorVar,
  label,
  value,
  strong,
}: {
  colorVar: string
  label: string
  value: string
  /** The Total row: primary ink instead of muted. */
  strong?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'w-10 text-right font-mono text-xs tabular-nums',
          strong ? 'text-text' : 'text-text-muted',
        )}
      >
        {value}
      </span>
      <span
        aria-hidden
        className="h-0.5 w-3 shrink-0 rounded-full"
        style={{ background: colorVar }}
      />
      <span className={cn('text-xs', strong ? 'font-medium text-text' : 'text-text-muted')}>
        {label}
      </span>
    </div>
  )
}
