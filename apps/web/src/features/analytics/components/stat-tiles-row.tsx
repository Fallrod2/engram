import { Flame } from 'lucide-react'
import type { StreaksResponse } from '@engram/shared'
import { StatTile } from './stat-tile'
import { StreakSparkline } from './streak-sparkline'
import {
  computeDelta,
  formatCount,
  formatDuration,
  formatPercent,
  successRate,
  type RatingTotals,
} from '../metrics'
import type { AnalyticsDeltas } from '../queries'
import { cn } from '@/lib/utils'

/**
 * The four KPI tiles (spec §3): streak (unscoped) · study time · reviews ·
 * success — the numbers read in two seconds. Deltas compare against the
 * previous equivalent period and are hidden for `all` (no previous).
 */
export function StatTilesRow({
  streaks,
  spark,
  studyMs,
  totals,
  deltas,
  windowLabel,
  reduce,
}: {
  streaks: StreaksResponse
  spark: number[]
  studyMs: number
  totals: RatingTotals
  deltas: AnalyticsDeltas | null
  windowLabel: string
  reduce: boolean
}) {
  const rate = successRate(totals)
  const period = `sur ${windowLabel}`

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatTile
        label="Streak"
        icon={<Flame className="size-5" strokeWidth={1.75} aria-hidden />}
        value={
          <>
            {streaks.current}
            <span className="ml-0.5 text-lg text-text-muted">j</span>
          </>
        }
        meta={<span className="font-mono tabular-nums">record {streaks.longest} j</span>}
        trend={
          spark.some((n) => n > 0) ? <StreakSparkline data={spark} reduce={reduce} /> : undefined
        }
      />

      <StatTile
        label="Temps d'étude"
        value={studyMs > 0 ? formatDuration(studyMs) : '0 min'}
        delta={computeDelta(studyMs, deltas ? deltas.studyMs : null)}
        deltaPeriod={period}
        meta={<span className="text-text-faint">—</span>}
      />

      <StatTile
        label="Reviews"
        value={formatCount(totals.total)}
        delta={computeDelta(totals.total, deltas ? deltas.reviews : null)}
        deltaPeriod={period}
        meta={<span className="text-text-faint">—</span>}
      />

      <StatTile
        label="Réussite"
        value={rate === null ? <span className="text-text-faint">—</span> : formatPercent(rate)}
        meta={
          rate === null ? (
            <span className={cn(totals.total > 0 && 'text-text-faint')}>
              pas encore assez de données
            </span>
          ) : (
            <span className="font-mono tabular-nums">
              {formatCount(totals.total)} review{totals.total > 1 ? 's' : ''}
            </span>
          )
        }
      />
    </div>
  )
}
