import { Flame } from 'lucide-react'
import type { StreaksResponse } from '@engram/shared'
import { Button } from '@/components/ui/button'
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
import { useT, usePlural } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * The four KPI tiles (spec §3): streak (unscoped) · study time · reviews ·
 * success — the numbers read in two seconds. Deltas compare against the
 * previous equivalent period and are hidden for `all` (no previous).
 *
 * `subjectScoped` says the other three tiles have been narrowed to one subject.
 * The streak has NOT — the endpoint takes no subject and never will, because a
 * streak measures showing up, which belongs to the person and not to one of
 * their subjects. So the tile says so, in words, right where it is read: three
 * scoped figures next to one global figure with nothing to distinguish them
 * would simply be a wrong number.
 *
 * T-066 — EVERY source is now optional, and the row draws whatever landed.
 * The screen used to gate the whole row on `streaks && volume && studyTime`,
 * with a skeleton as the else: one dropped request and four tiles pulsed for
 * ever. Per-tile is the right grain for the FIGURES — the sources map almost
 * one-to-one onto tiles, and blanking three answers we have because a fourth is
 * missing hides more truth than it protects. The RETRY is one, for the row:
 * four buttons in four 100px boxes is noise, and "try that row again" is the
 * only intent anyone has here.
 */
export function StatTilesRow({
  streaks,
  spark,
  studyMs,
  totals,
  deltas,
  windowLabel,
  reduce,
  subjectScoped = false,
  onRetry,
}: {
  /** `undefined` = this source did not land. Its tile says `—`, never `0`. */
  streaks: StreaksResponse | undefined
  spark: number[]
  studyMs: number | undefined
  totals: RatingTotals | undefined
  deltas: AnalyticsDeltas | null
  windowLabel: string
  reduce: boolean
  subjectScoped?: boolean
  /** Set when at least one source failed: the row grows an inline retry line. */
  onRetry?: () => void
}) {
  const t = useT()
  const plural = usePlural()
  const rate = totals ? successRate(totals) : null
  const period = t('analytics.period', { label: windowLabel })

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={t('dashboard.streak.label')}
          icon={<Flame className="size-5" strokeWidth={1.75} aria-hidden />}
          value={
            streaks ? (
              <>
                {streaks.current}
                <span className="ml-0.5 text-lg text-text-muted">{t('analytics.dayUnit')}</span>
              </>
            ) : (
              <Unknown />
            )
          }
          meta={
            streaks ? (
              <span
                className="font-mono tabular-nums"
                {...(subjectScoped ? { title: t('analytics.streakScopeNote') } : {})}
              >
                {t('analytics.streakRecord', { count: streaks.longest })}
                {subjectScoped && (
                  <>
                    <span className="mx-1.5 text-border-strong">·</span>
                    <span className="font-sans">{t('analytics.subjectScopeAll')}</span>
                  </>
                )}
              </span>
            ) : (
              <span>{t('analytics.tileUnavailable')}</span>
            )
          }
          trend={
            spark.some((n) => n > 0) ? <StreakSparkline data={spark} reduce={reduce} /> : undefined
          }
        />

        <StatTile
          label={t('analytics.studyTime')}
          value={
            studyMs === undefined ? <Unknown /> : studyMs > 0 ? formatDuration(studyMs) : '0 min'
          }
          {...(studyMs === undefined
            ? {}
            : {
                delta: computeDelta(studyMs, deltas ? deltas.studyMs : null),
                deltaPeriod: period,
              })}
          meta={
            <span className="text-text-faint">
              {studyMs === undefined ? t('analytics.tileUnavailable') : '—'}
            </span>
          }
        />

        <StatTile
          label={t('analytics.reviews')}
          value={totals ? formatCount(totals.total) : <Unknown />}
          {...(totals
            ? {
                delta: computeDelta(totals.total, deltas ? deltas.reviews : null),
                deltaPeriod: period,
              }
            : {})}
          meta={
            <span className="text-text-faint">{totals ? '—' : t('analytics.tileUnavailable')}</span>
          }
        />

        <StatTile
          label={t('analytics.success')}
          value={rate === null ? <Unknown /> : formatPercent(rate)}
          meta={
            !totals ? (
              <span>{t('analytics.tileUnavailable')}</span>
            ) : rate === null ? (
              <span className={cn(totals.total > 0 && 'text-text-faint')}>
                {t('analytics.notEnoughData')}
              </span>
            ) : (
              <span className="font-mono tabular-nums">
                {t(`analytics.reviewsCount_${plural(totals.total)}`, {
                  count: formatCount(totals.total),
                })}
              </span>
            )
          }
        />
      </div>

      {onRetry && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          {t('analytics.tilesError')}
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </p>
      )}
    </div>
  )
}

/** The app-wide "we could not read this" mark, at tile weight. */
function Unknown() {
  return <span className="text-text-faint">—</span>
}
