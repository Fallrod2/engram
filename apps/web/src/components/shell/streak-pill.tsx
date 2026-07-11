import { Flame } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Streak pill (spec §6, detail 3). Mono count; the once-a-day "breathing"
 * animation lands in Phase 5/6 — here it is the calm resting state. Fake `0`
 * for Phase 0.
 */
export function StreakPill({
  days = 0,
  collapsed = false,
}: {
  days?: number
  collapsed?: boolean
}) {
  const active = days > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-1',
        collapsed && 'px-0',
        active ? 'text-text' : 'text-text-faint',
      )}
      aria-label={`Série de ${days} jour${days > 1 ? 's' : ''}`}
      title={`Série : ${days} j`}
    >
      <Flame className={cn('size-3.5', active ? 'text-warning' : 'text-text-faint')} />
      {!collapsed && <span className="font-mono text-xs tabular-nums">{days}</span>}
    </span>
  )
}
