import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useReducedMotion } from '@/lib/motion'
import { z } from 'zod'
import { GraduationCap } from 'lucide-react'
import type { HeatmapResponse } from '@engram/shared'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { useT } from '@/lib/i18n'
import { ErrorState } from '@/components/error-state'
import { AnalyticsIllustration } from '@/components/illustrations'
import { localDayKey } from '@/lib/calendar'
import { subjectsListOptions } from '@/features/subjects/queries'
import {
  deltasOptions,
  examReadinessOptions,
  hardestCardsOptions,
  heatmapOptions,
  retentionOptions,
  reviewVolumeOptions,
  streaksOptions,
  studyTimeOptions,
} from '@/features/analytics/queries'
import { parseWindow, windowLabel, type AnalyticsWindow } from '@/features/analytics/window'
import { sparkFromHeatmap } from '@/features/analytics/metrics'
import { panelBody } from '@/features/analytics/panel-state'
import { WindowFilter } from '@/features/analytics/components/window-filter'
import { SubjectFilter } from '@/features/analytics/components/subject-filter'
import { ReadinessOverview } from '@/features/analytics/components/readiness-overview'
import { StatTilesRow } from '@/features/analytics/components/stat-tiles-row'
import { ActivityHeatmap } from '@/features/analytics/components/activity-heatmap'
import { HeatmapLegend } from '@/features/analytics/components/heatmap-legend'
import { YearStepper } from '@/features/analytics/components/year-stepper'
import { ChartCard } from '@/features/analytics/components/chart-card'
import { ChartEmpty } from '@/features/analytics/components/chart-empty'
import { ChartTableView } from '@/features/analytics/components/chart-table-view'
import { ReviewVolumeChart } from '@/features/analytics/components/review-volume-chart'
import { StudyTimeChart } from '@/features/analytics/components/study-time-chart'
import { RetentionBySubjectChart } from '@/features/analytics/components/retention-by-subject-chart'
import { HardestCardsPanel } from '@/features/analytics/components/hardest-cards-panel'
import {
  AnalyticsSkeleton,
  ChartCardSkeleton,
  HardestCardsSkeleton,
  HeatmapSkeleton,
  ReadinessSkeleton,
  StatTilesSkeleton,
} from '@/features/analytics/components/analytics-skeletons'

/**
 * `subject` is a FILTER in the URL, not a route: the comparison and any single
 * subject are the same screen, so switching between them must not navigate
 * anywhere (and a narrowed view must stay shareable/reloadable). An unknown id
 * is tolerated here and resolved against the loaded subject list below — the
 * server would answer an empty payload for it, which reads as "you have no
 * data" rather than "that subject is gone".
 */
const analyticsSearchSchema = z.object({
  window: z.enum(['30d', '90d', '365d', 'all']).catch('30d'),
  subject: z.string().optional().catch(undefined),
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
  const { window: win, subject: subjectParam } = Route.useSearch()
  const navigate = Route.useNavigate()
  const t = useT()
  const reduce = !!useReducedMotion()

  const [now] = useState(() => new Date())
  const currentYear = now.getFullYear()
  const todayKey = localDayKey(now)
  const [year, setYear] = useState(currentYear)

  const window = parseWindow(win)
  const subjectsQuery = useQuery(subjectsListOptions())
  const subjects = subjectsQuery.data ?? []
  /**
   * T-066 — the subject list is this screen's only CROSS-CUTTING read: three
   * panels resolve their rows through it and DROP whatever they cannot name.
   * `?? []` therefore did not merely empty the filter, it turned a failed read
   * into "no exam coming up", "not enough reviews to rank" and "no retention
   * data" — the exact mistake `<ReadinessOverview>` carries a comment against.
   * So it is passed down as a fact, and each panel shows its own error and its
   * own retry rather than an empty state it has not earned.
   */
  const subjectsUnavailable = subjectsQuery.isError
  const retrySubjects = () => void subjectsQuery.refetch()
  // An id nobody owns is dropped rather than sent: it would key its own empty
  // cache entry and render four "no data" panels that are really "no such
  // subject". Until the list has loaded we keep the URL's value, so a reload on
  // a narrowed view does not flash the unfiltered screen.
  const subjectId = subjectsQuery.data
    ? subjects.find((s) => s.id === subjectParam)?.id
    : subjectParam
  const selectedSubject = subjects.find((s) => s.id === subjectId)

  const setWindow = (w: AnalyticsWindow) =>
    void navigate({ search: (prev) => ({ ...prev, window: w }), replace: true })
  const setSubject = (id: string | undefined) =>
    void navigate({
      search: (prev) => ({ ...prev, ...(id ? { subject: id } : { subject: undefined }) }),
      replace: true,
    })

  const streaksQuery = useQuery(streaksOptions(now))
  const heatmapQuery = useQuery(heatmapOptions(year, subjectId))
  // The sparkline lives INSIDE the streak tile and must be scoped like it: the
  // streak is global (see `streaksOptions`), so a subject-filtered curve under a
  // global number would be two different questions in one tile.
  const sparkHeatmapQuery = useQuery(heatmapOptions(currentYear))
  const volumeQuery = useQuery(reviewVolumeOptions(window, now, subjectId))
  const studyTimeQuery = useQuery(studyTimeOptions(window, now, subjectId))
  const retentionQuery = useQuery(retentionOptions(window, now))
  const deltasQuery = useQuery(deltasOptions(window, now, subjectId))
  const hardestQuery = useQuery(hardestCardsOptions(undefined, subjectId))
  const readinessQuery = useQuery(examReadinessOptions(now, subjectId))

  const label = windowLabel(window)

  // Global empty: no review has ever been recorded (0 study days ever).
  if (streaksQuery.data && streaksQuery.data.totalStudyDays === 0) {
    return (
      <div>
        <PageHeaderRow />
        <EmptyState
          illustration={<AnalyticsIllustration />}
          title={t('empty.analyticsTitle')}
          meta={t('empty.analyticsMeta')}
          action={
            <Button asChild>
              <Link to="/review">
                <GraduationCap className="size-4" />
                {t('common.startSession')}
              </Link>
            </Button>
          }
        />
      </div>
    )
  }

  const spark = sparkHeatmapQuery.data
    ? sparkFromHeatmap(sparkHeatmapQuery.data.days, todayKey)
    : []
  const tilesFetching = volumeQuery.isFetching || studyTimeQuery.isFetching

  /**
   * The KPI row, T-066. It used to be `streaks && volume && studyTime ? row :
   * skeleton`, and this route's loader is `Promise.allSettled` ON PURPOSE — so a
   * failure never reaches `AnalyticsError`, and one dropped request left four
   * tiles pulsing until the tab was closed.
   *
   * Granularity: per-tile for the FIGURES, one retry for the ROW. The five
   * sources map almost one-to-one onto the four tiles, so blanking the row
   * because one failed would hide three answers that did arrive; but four retry
   * buttons in four 100px boxes is noise, and nobody wants to re-ask for one
   * tile. The skeleton now only covers the honest case: still waiting, nothing
   * broken.
   */
  // Spelled out one handle at a time rather than `[…].some(q => q.isError)`:
  // `read-guard.test.ts` matches `<handle>.<status>` by shape, and an array
  // hides the very question it exists to ask. Naming them also lists, in one
  // place, exactly which reads this row depends on.
  const tilesFailed =
    streaksQuery.isError ||
    volumeQuery.isError ||
    studyTimeQuery.isError ||
    deltasQuery.isError ||
    sparkHeatmapQuery.isError
  const tilesLanded = streaksQuery.data && volumeQuery.data && studyTimeQuery.data
  const retryTiles = () => {
    for (const q of [streaksQuery, volumeQuery, studyTimeQuery, deltasQuery, sparkHeatmapQuery]) {
      if (q.isError) void q.refetch()
    }
  }

  /**
   * Every panel's skeleton/error/data decision, in one tested place.
   *
   * These were seven hand-written `data || isError` gates, and the review
   * measured that dropping the `|| isError` from any of them left the entire
   * suite green — `read-guard.test.ts` only asks that SOME status member be read
   * on the handle, and each of these panels also reads `isFetching` and passes
   * `error={…}` down, so the gate's own term was redundant to that scan. The
   * handle goes in whole (see `panel-state.ts`): there is no term at the call
   * site left to drop, and `panel-state.test.ts` owns the rule itself.
   *
   * That scan reads the SOURCE of this file and looks for `…Query` in the
   * condition of any ternary rendering a `*Skeleton`, so a local alias for a
   * query payload (`const heatmap = heatmapQuery.data`) is a hole in it: the
   * gate could be rewritten onto the alias and the scan would see nothing. No
   * panel here keeps one — every payload is read as `xQuery.data` at its use
   * site, which is what makes the scan's regex sufficient. Don't add one.
   */
  const tilesBody = panelBody({ data: tilesLanded, isError: tilesFailed })
  const readinessBody = panelBody(readinessQuery, subjectsUnavailable)
  const heatmapBody = panelBody(heatmapQuery)
  const volumeBody = panelBody(volumeQuery)
  const studyTimeBody = panelBody(studyTimeQuery)
  const retentionBody = panelBody(retentionQuery, subjectsUnavailable)
  const hardestBody = panelBody(hardestQuery, subjectsUnavailable)

  const clampYear = (y: number) => Math.min(currentYear, Math.max(currentYear - 5, y))

  return (
    <div>
      <PageHeaderRow>
        {/* One filter rank, two axes: a period and a subject (spec §1.5). */}
        <div className="flex flex-wrap items-center gap-3">
          <WindowFilter value={window} onChange={setWindow} />
          <SubjectFilter
            subjects={subjects}
            unavailable={subjectsUnavailable}
            value={subjectId}
            onChange={setSubject}
          />
        </div>
      </PageHeaderRow>

      <div className="flex flex-col gap-6">
        {/* KPI tiles */}
        {tilesBody !== 'skeleton' ? (
          <div className={tilesFetching ? 'opacity-50 transition-opacity duration-base' : ''}>
            <StatTilesRow
              streaks={streaksQuery.data}
              spark={spark}
              studyMs={studyTimeQuery.data?.totalMs}
              totals={volumeQuery.data?.totals}
              deltas={deltasQuery.data ?? null}
              windowLabel={label}
              reduce={reduce}
              subjectScoped={!!subjectId}
              {...(tilesFailed ? { onRetry: retryTiles } : {})}
            />
          </div>
        ) : (
          <StatTilesSkeleton />
        )}

        {/* Exam readiness — a forecast, so neither the window nor the year
            stepper touches it. Placed high: it is the only panel that can change
            what someone does in the next hour. */}
        {readinessBody !== 'skeleton' ? (
          <ReadinessOverview
            data={readinessQuery.data}
            subjects={subjects}
            subjectsUnavailable={subjectsUnavailable}
            now={now}
            isFetching={readinessQuery.isFetching}
            error={readinessQuery.isError}
            onRetry={() => {
              if (readinessQuery.isError) void readinessQuery.refetch()
              if (subjectsUnavailable) retrySubjects()
            }}
          />
        ) : (
          <ReadinessSkeleton />
        )}

        {/* Activity heatmap — its own year stepper, NOT window-scoped. The card
            frame survives a failed read (T-066): the year stepper stays usable,
            so "ask again" and "ask for another year" are the same gesture, and
            the grid of 365 pulsing squares stops pretending to be on its way. */}
        {heatmapBody !== 'skeleton' ? (
          <ChartCard
            title={t('analytics.activity')}
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
            {...(heatmapQuery.data ? { table: <HeatmapTable data={heatmapQuery.data} /> } : {})}
          >
            {heatmapQuery.data ? (
              <ActivityHeatmap
                data={heatmapQuery.data}
                year={year}
                minYear={currentYear - 5}
                onYearChange={(dir) => setYear((y) => clampYear(y + dir))}
              />
            ) : (
              <ChartEmpty
                variant="error"
                title={t('analytics.activityError')}
                onRetry={() => void heatmapQuery.refetch()}
                height={140}
              />
            )}
          </ChartCard>
        ) : (
          <HeatmapSkeleton />
        )}

        {/* Windowed charts */}
        <div className="grid gap-6 lg:grid-cols-2">
          {volumeBody !== 'skeleton' ? (
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

          {studyTimeBody !== 'skeleton' ? (
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

        {retentionBody !== 'skeleton' ? (
          <RetentionBySubjectChart
            data={retentionQuery.data}
            subjects={subjects}
            subjectsUnavailable={subjectsUnavailable}
            windowLabel={label}
            isFetching={retentionQuery.isFetching}
            error={retentionQuery.isError}
            onRetry={() => {
              if (retentionQuery.isError) void retentionQuery.refetch()
              if (subjectsUnavailable) retrySubjects()
            }}
            {...(selectedSubject ? { highlightSubjectId: selectedSubject.id } : {})}
          />
        ) : (
          <ChartCardSkeleton height={180} />
        )}

        {hardestBody !== 'skeleton' ? (
          <HardestCardsPanel
            data={hardestQuery.data}
            subjects={subjects}
            subjectsUnavailable={subjectsUnavailable}
            isFetching={hardestQuery.isFetching}
            error={hardestQuery.isError}
            onRetry={() => {
              if (hardestQuery.isError) void hardestQuery.refetch()
              if (subjectsUnavailable) retrySubjects()
            }}
          />
        ) : (
          <HardestCardsSkeleton />
        )}
      </div>
    </div>
  )
}

function HeatmapTable({ data }: { data: HeatmapResponse }) {
  const t = useT()
  const rows = data.days.filter((d) => d.count > 0).sort((a, b) => b.date.localeCompare(a.date))
  return (
    <ChartTableView
      columns={[
        { key: 'date', header: t('analytics.colDay'), render: (d) => d.date, mono: true },
        {
          key: 'count',
          header: t('analytics.colReviews'),
          align: 'right',
          mono: true,
          render: (d) => d.count,
        },
      ]}
      rows={rows}
      rowKey={(d) => d.date}
      caption={t('analytics.activityByDay')}
    />
  )
}
