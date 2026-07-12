import { useMemo, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { useT, type TFunction } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'
import { subjectsById as buildSubjectsById } from '@/features/planning/plan-utils'
import { subjectsListOptions, useCreateSubject } from '@/features/subjects/queries'
import { allDecksOptions } from '@/features/decks/queries'
import { dueCountsOptions } from '@/features/due-counts/queries'
import { examsListOptions, studyTodayOptions } from '@/features/planning/queries'
import { streaksOptions, heatmapOptions } from '@/features/analytics/queries'
import { TodayPanel } from '@/features/planning/today-panel'
import { SubjectFormDialog } from '@/features/subjects/subject-form-dialog'
import { StreakCard } from '@/features/dashboard/streak-card'
import { UpcomingExams } from '@/features/dashboard/upcoming-exams'
import { RecentActivity } from '@/features/dashboard/recent-activity'
import { DashboardSkeleton } from '@/features/dashboard/dashboard-skeleton'
import { WelcomePanel } from '@/features/onboarding/welcome-panel'

/**
 * Dashboard `/` (spec §5) — replaces the Phase 1 redirect. The header names the
 * section ("Aujourd'hui"), so there is NO in-page `<h1>` (§4.1). Tolerant
 * loader: one failing panel never blanks the screen; a safe default is always
 * the "all caught up" reward, never a white page.
 */
export const Route = createFileRoute('/')({
  loader: ({ context }) => {
    const now = new Date()
    return Promise.allSettled([
      context.queryClient.ensureQueryData(dueCountsOptions()),
      context.queryClient.ensureQueryData(studyTodayOptions()),
      context.queryClient.ensureQueryData(subjectsListOptions()),
      context.queryClient.ensureQueryData(allDecksOptions()),
      context.queryClient.ensureQueryData(examsListOptions()),
      context.queryClient.ensureQueryData(streaksOptions(now)),
      context.queryClient.ensureQueryData(heatmapOptions(now.getFullYear())),
    ])
  },
  component: DashboardPage,
  pendingComponent: DashboardSkeleton,
})

function DashboardPage() {
  const router = useRouter()
  const t = useT()
  const [now] = useState(() => new Date())
  const [createOpen, setCreateOpen] = useState(false)
  const createSubject = useCreateSubject()

  const subjectsQuery = useQuery(subjectsListOptions())
  const dueCounts = useQuery(dueCountsOptions()).data
  const decksQuery = useQuery(allDecksOptions())
  const examsQuery = useQuery(examsListOptions())
  const streaks = useQuery(streaksOptions(now)).data
  const heatmap = useQuery(heatmapOptions(now.getFullYear())).data

  const subjects = subjectsQuery.data ?? []
  const byId = useMemo(() => buildSubjectsById(subjectsQuery.data), [subjectsQuery.data])
  const total = dueCounts?.total ?? 0

  // Three states without a naked zero (§5.4). `dbEmpty` requires a *successful*
  // empty read (never onboarding on a failed fetch). `noCardsYet` distinguishes
  // "nothing created yet" from the legitimate "all caught up" reward — cheaply,
  // via `allDecks` (one query), NOT a per-deck cardCount fan-out (Phase 7).
  const dbEmpty = subjectsQuery.isSuccess && subjects.length === 0
  const noCardsYet =
    !dbEmpty && total === 0 && decksQuery.isSuccess && (decksQuery.data?.length ?? 0) === 0

  // Subjects are the backbone — without them the layout can't be decided.
  if (subjectsQuery.isError) {
    return <ErrorState kind="subjects" onRetry={() => void router.invalidate()} />
  }

  return (
    <>
      {dbEmpty ? (
        // DB empty → ONLY the welcome panel; streak/exams/activity are NOT
        // mounted (§5.4-i — no naked zeros around the onboarding).
        <WelcomePanel onCreateSubject={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-8">
            {noCardsYet ? (
              <NoCardsHero t={t} />
            ) : total === 0 ? (
              <HeroCard>
                {/* Cards exist, queue is clear → the legitimate reward. */}
                <TodayPanel subjectsById={byId} now={now} />
              </HeroCard>
            ) : (
              <HeroCard>
                <div className="mb-4 flex items-baseline gap-2.5">
                  <span className="font-mono text-3xl font-medium leading-none tabular-nums text-text">
                    {total}
                  </span>
                  <span className="text-sm text-text-muted">{t('dashboard.toReviewToday')}</span>
                </div>
                <TodayPanel subjectsById={byId} now={now} hideTotal />
              </HeroCard>
            )}
          </div>

          <div className="flex flex-col gap-4 lg:col-span-4">
            {streaks ? (
              <StreakCard streaks={streaks} />
            ) : (
              <BlockUnavailable label={t('dashboard.streak.label')} t={t} />
            )}
            {examsQuery.isSuccess ? (
              <UpcomingExams exams={examsQuery.data} subjectsById={byId} now={now} />
            ) : (
              <BlockUnavailable label={t('dashboard.exams.label')} t={t} />
            )}
          </div>

          {/* Recent activity — soft Phase 5 dependency (§5.3.D): shown only when
              the heatmap is available; its absence never blocks the dashboard. */}
          {heatmap && (
            <div className="lg:col-span-12">
              <RecentActivity heatmap={heatmap} now={now} />
            </div>
          )}
        </div>
      )}

      <SubjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(values) => createSubject.mutate(values)}
      />
    </>
  )
}

function HeroCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface-1 p-6">{children}</div>
}

/** Subjects exist but no deck/card yet (§5.4-ii) — a boot prompt, not the reward. */
function NoCardsHero({ t }: { t: TFunction }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-6">
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold tracking-[-0.01em] text-text">
          {t('dashboard.noCardsTitle')}
        </p>
        <p className="text-sm text-text-muted">{t('dashboard.noCardsBody')}</p>
      </div>
      <Button variant="secondary" asChild className="self-start">
        <Link to="/subjects">
          <Layers />
          {t('dashboard.viewMySubjects')}
        </Link>
      </Button>
    </div>
  )
}

/** Calm inline fallback for a rail block whose data failed to load (tolerant §5.6.6). */
function BlockUnavailable({ label, t }: { label: string; t: TFunction }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-4">
      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">{label}</p>
      <p className="text-sm text-text-muted">{t('common.unavailable')}</p>
    </section>
  )
}
