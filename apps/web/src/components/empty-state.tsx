import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A thought-through empty state (spec §6, §7). Sober: an inline monochrome
 * illustration (Phase 6) or a calm icon fallback, an Inter `lg` line, a mono
 * meta line, an optional action. Never a bare `0` or an empty div.
 *
 * `illustration` (an inline `currentColor` SVG) takes priority over `icon`;
 * screens not yet migrated keep rendering the icon square (zero regression).
 */
export function EmptyState({
  icon: Icon,
  illustration,
  title,
  meta,
  action,
  className,
}: {
  icon?: LucideIcon
  /** Inline monochrome SVG (`currentColor`, `text-faint`). Wins over `icon`. */
  illustration?: ReactNode
  title: string
  /** Mono meta line (dates/counts language). Optional. */
  meta?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-[52vh] flex-col items-center justify-center gap-4 px-6 text-center',
        className,
      )}
    >
      {illustration ? (
        <span className="text-text-faint">{illustration}</span>
      ) : (
        Icon && (
          <span className="flex size-12 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-faint">
            <Icon className="size-5" strokeWidth={1.75} />
          </span>
        )
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-lg font-semibold tracking-[-0.01em] text-text">{title}</p>
        {meta && <p className="font-mono text-xs tabular-nums text-text-faint">{meta}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
