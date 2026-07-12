import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import type { HeatmapResponse } from '@engram/shared'
import { addDays, localDayKey } from '@/lib/calendar'
import { useT } from '@/lib/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { heatLevel, HEAT_BG_CLASS } from '@/features/analytics/heat-scale'

const DAYS = 14

/**
 * "Activité récente" (spec §5.3.D). A 14-cell band of the last two weeks, tinted
 * by review intensity with the shared heat scale (no Recharts). Soft dependency
 * on Phase 5 tokens/heatmap — the dashboard hides this block when the data is
 * absent (RECENT_ACTIVITY_ENABLED), so it never blocks the screen.
 */
export function RecentActivity({ heatmap, now }: { heatmap: HeatmapResponse; now: Date }) {
  const t = useT()
  const cells = useMemo(() => {
    const byDate = new Map(heatmap.days.map((d) => [d.date, d.count]))
    const out: { date: string; count: number }[] = []
    for (let i = DAYS - 1; i >= 0; i--) {
      const key = localDayKey(addDays(now, -i))
      out.push({ date: key, count: byDate.get(key) ?? 0 })
    }
    return out
  }, [heatmap, now])

  const total = cells.reduce((s, c) => s + c.count, 0)
  const activeDays = cells.filter((c) => c.count > 0).length

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
          {t('dashboard.activity.label')}
        </p>
        <Link
          to="/analytics"
          className="text-xs text-text-faint transition-colors hover:text-accent"
        >
          {t('dashboard.activity.viewAnalytics')}
        </Link>
      </div>
      <div className="flex items-end gap-1">
        {cells.map((c) => (
          <Tooltip key={c.date}>
            <TooltipTrigger asChild>
              <span
                className={`h-6 flex-1 rounded-xs ${HEAT_BG_CLASS[heatLevel(c.count)]}`}
                aria-hidden
              />
            </TooltipTrigger>
            <TooltipContent>
              <span className="font-mono text-2xs tabular-nums">
                {t(
                  c.count > 1
                    ? 'dashboard.activity.tooltip_other'
                    : 'dashboard.activity.tooltip_one',
                  {
                    date: c.date,
                    count: c.count,
                  },
                )}
              </span>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <p className="font-mono text-xs tabular-nums text-text-faint">
        {t(total > 1 ? 'dashboard.activity.summary_other' : 'dashboard.activity.summary_one', {
          total,
          active: activeDays,
          days: DAYS,
        })}
      </p>
    </section>
  )
}
