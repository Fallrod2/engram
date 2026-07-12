import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useReducedMotion } from 'motion/react'
import { z } from 'zod'
import { GraduationCap } from 'lucide-react'
import type { HeatmapResponse } from '@engram/shared'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { AnalyticsIllustration } from '@/components/illustrations'
import { localDayKey } from '@/lib/calendar'
import { subjectsListOptions } from '@/features/subjects/queries'
import {
  deltasOptions,
  heatmapOptions,
  retentionOptions,
  reviewVolumeOptions,
  streaksOptions,
  studyTimeOptions,
} from '@/features/analytics/queries'
import { parseWindow, windowLabel, type AnalyticsWindow } from '@/features/analytics/window'
import { sparkFromHeatmap } from '@/features/analytics/metrics'
import { WindowFilter } from '@/features/analytics/components/window-filter'
import { StatTilesRow } from '@/features/analytics/components/stat-tiles-row'
import { ActivityHeatmap } from '@/features/analytics/components/activity-heatmap'
import { HeatmapLegend } from '@/features/analytics/components/heatmap-legend'
import { YearStepper } from '@/features/analytics/components/year-stepper'
import { ChartCard } from '@/features/analytics/components/chart-card'
import { ChartTableView } from '@/features/analytics/components/chart-table-view'
import { ReviewVolumeChart } from '@/features/analytics/components/review-volume-chart'
import { StudyTimeChart } from '@/features/analytics/components/study-time-chart'
import { RetentionBySubjectChart } from '@/features/analytics/components/retention-by-subject-chart'
import {
  AnalyticsSkeleton,
  ChartCardSkeleton,
  HeatmapSkeleton,
  StatTilesSkeleton,
} from '@/features/analytics/components/analytics-skeletons'

const analyticsSearchSchema = z.object({
  window: z.enum(['30d', '90d', '365d', 'all']).catch('30d'),
})

export const Route = createFileRoute('/analytics')({
  validateSearch: analyticsSearchSchema,
  loader: async ({ context }) => {
    const now = new Date()
    const year = now.getFullYear()
    // Only the non-windowed above-the-fold data is ensured here — so a window
    // change never re-runs the loader (no pending flash); the windowed charts
    // load via `useQuery` with keepPreviousData. Tolerant: no panel blanks all.
    await Promise.allSettled([
      context.queryClient.ensureQueryData(streaksOptions(now)),
      context.queryClient.ensureQueryData(heatmapOptions(year)),
      context.queryClient.ensureQueryData(subjectsListOptions()),
    ])
  },
  component: AnalyticsPage,
  pendingComponent: AnalyticsPending,
  errorComponent: AnalyticsError,
})

function AnalyticsError() {
  const router = useRouter()
  return <ErrorState kind="planning" onRetry={() => void router.invalidate()} />
}

/**
 * Analytics is a root-of-section screen: the global shell header already names
 * it "Analytics", so there is NO in-page `<h1>` (§4.1 — removes the doublon).
 * Only the window-filter row renders here.
 */
function PageHeaderRow({ children }: { children?: React.ReactNode }) {
  return children ? <div className="mb-6">{children}</div> : null
}

function AnalyticsPending() {
  return (
    <div>
      <PageHeaderRow />
      <AnalyticsSkeleton />
    </div>
  )
}

function AnalyticsPage() {
  const { window: win } = Route.useSearch()
  const navigate = Route.useNavigate()
  const reduce = !!useReducedMotion()

  const [now] = useState(() => new Date())
  const currentYear = now.getFullYear()
  const todayKey = localDayKey(now)
  const [year, setYear] = useState(currentYear)

  const window = parseWindow(win)
  const setWindow = (w: AnalyticsWindow) => void navigate({ search: { window: w }, replace: true })

  const streaksQuery = useQuery(streaksOptions(now))
  const subjectsQuery = useQuery(subjectsListOptions())
  const heatmapQuery = useQuery(heatmapOptions(year))
  const sparkHeatmapQuery = useQuery(heatmapOptions(currentYear))
  const volumeQuery = useQuery(reviewVolumeOptions(window, now))
  const studyTimeQuery = useQuery(studyTimeOptions(window, now))
  const retentionQuery = useQuery(retentionOptions(window, now))
  const deltasQuery = useQuery(deltasOptions(window, now))

  const label = windowLabel(window)

  // Global empty: no review has ever been recorded (0 study days ever).
  if (streaksQuery.data && streaksQuery.data.totalStudyDays === 0) {
    return (
      <div>
        <PageHeaderRow />
        <EmptyState
          illustration={<AnalyticsIllustration />}
          title="Rien à analyser pour l'instant."
          meta="0 review enregistrée"
          action={
            <Button asChild>
              <Link to="/review">
                <GraduationCap className="size-4" />
                Lancer une session
              </Link>
            </Button>
          }
        />
      </div>
    )
  }

  const tilesReady = streaksQuery.data && volumeQuery.data && studyTimeQuery.data
  const spark = sparkHeatmapQuery.data
    ? sparkFromHeatmap(sparkHeatmapQuery.data.days, todayKey)
    : []
  const tilesFetching = volumeQuery.isFetching || studyTimeQuery.isFetching

  const clampYear = (y: number) => Math.min(currentYear, Math.max(currentYear - 5, y))

  return (
    <div>
      <PageHeaderRow>
        <WindowFilter value={window} onChange={setWindow} />
      </PageHeaderRow>

      <div className="flex flex-col gap-6">
        {/* KPI tiles */}
        {tilesReady && streaksQuery.data && volumeQuery.data && studyTimeQuery.data ? (
          <div className={tilesFetching ? 'opacity-50 transition-opacity duration-base' : ''}>
            <StatTilesRow
              streaks={streaksQuery.data}
              spark={spark}
              studyMs={studyTimeQuery.data.totalMs}
              totals={volumeQuery.data.totals}
              deltas={deltasQuery.data ?? null}
              windowLabel={label}
              reduce={reduce}
            />
          </div>
        ) : (
          <StatTilesSkeleton />
        )}

        {/* Activity heatmap — its own year stepper, NOT window-scoped */}
        {heatmapQuery.data ? (
          <ChartCard
            title="Activité"
            isFetching={heatmapQuery.isFetching}
            toolbar={
              <div className="flex items-center gap-4">
                <div className="hidden sm:block">
                  <HeatmapLegend />
                </div>
                <YearStepper
                  year={year}
                  minYear={currentYear - 5}
                  maxYear={currentYear}
                  onChange={(y) => setYear(clampYear(y))}
                />
              </div>
            }
            table={<HeatmapTable data={heatmapQuery.data} />}
          >
            <ActivityHeatmap
              data={heatmapQuery.data}
              year={year}
              minYear={currentYear - 5}
              onYearChange={(dir) => setYear((y) => clampYear(y + dir))}
            />
          </ChartCard>
        ) : (
          <HeatmapSkeleton />
        )}

        {/* Windowed charts */}
        <div className="grid gap-6 lg:grid-cols-2">
          {volumeQuery.data || volumeQuery.isError ? (
            <ReviewVolumeChart
              data={volumeQuery.data}
              windowLabel={label}
              isFetching={volumeQuery.isFetching}
              error={volumeQuery.isError}
              onRetry={() => void volumeQuery.refetch()}
              reduce={reduce}
            />
          ) : (
            <ChartCardSkeleton />
          )}

          {studyTimeQuery.data || studyTimeQuery.isError ? (
            <StudyTimeChart
              data={studyTimeQuery.data}
              windowLabel={label}
              isFetching={studyTimeQuery.isFetching}
              error={studyTimeQuery.isError}
              onRetry={() => void studyTimeQuery.refetch()}
              reduce={reduce}
            />
          ) : (
            <ChartCardSkeleton />
          )}
        </div>

        {retentionQuery.data || retentionQuery.isError ? (
          <RetentionBySubjectChart
            data={retentionQuery.data}
            subjects={subjectsQuery.data ?? []}
            windowLabel={label}
            isFetching={retentionQuery.isFetching}
            error={retentionQuery.isError}
            onRetry={() => void retentionQuery.refetch()}
          />
        ) : (
          <ChartCardSkeleton height={180} />
        )}
      </div>
    </div>
  )
}

function HeatmapTable({ data }: { data: HeatmapResponse }) {
  const rows = data.days.filter((d) => d.count > 0).sort((a, b) => b.date.localeCompare(a.date))
  return (
    <ChartTableView
      columns={[
        { key: 'date', header: 'Jour', render: (d) => d.date, mono: true },
        { key: 'count', header: 'Reviews', align: 'right', mono: true, render: (d) => d.count },
      ]}
      rows={rows}
      rowKey={(d) => d.date}
      caption="Activité par jour"
    />
  )
}
