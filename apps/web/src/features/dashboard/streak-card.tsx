import { Flame } from 'lucide-react'
import type { StreaksResponse } from '@engram/shared'
import { cn } from '@/lib/utils'

/**
 * Streak block of the dashboard rail (spec §5.3.B). Calm resting state only —
 * the once-a-day "breathing" lives on the always-visible `StreakPill` (sidebar,
 * §5.3bis), not here. Never alarmist, never red.
 */
export function StreakCard({ streaks }: { streaks: StreaksResponse }) {
  const active = streaks.current > 0
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-4">
      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">Série</p>
      <div className="flex items-center gap-2.5">
        <Flame
          className={cn('size-6 shrink-0', active ? 'text-warning' : 'text-text-faint')}
          strokeWidth={1.75}
        />
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-medium tabular-nums text-text">
            {streaks.current}
          </span>
          <span className="text-sm text-text-muted">
            jour{streaks.current > 1 ? 's' : ''} de suite
          </span>
        </span>
      </div>
      <p className="font-mono text-xs tabular-nums text-text-faint">
        record {streaks.longest} · {streaks.totalStudyDays} jours étudiés
      </p>
      {!streaks.includesToday && streaks.current > 0 && (
        <p className="text-xs text-text-muted">Révise aujourd'hui pour ne pas casser ta série.</p>
      )}
    </section>
  )
}
