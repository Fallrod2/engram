import { lazy, Suspense, useMemo, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useT, type TFunction } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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

// Public landing lives in its OWN async chunk (not inlined here), so it never
// weighs on the dashboard's critical path (landing spec §5.4). `/welcome` imports
// the same module, so Vite dedupes it into a single shared chunk.
const LandingPage = lazy(() => import('@/features/landing/landing-page'))

/**
 * `/` is public (landing spec §1): the marketing landing for a signed-out
 * visitor, the dashboard once signed in. The header names the section
 * ("Aujourd'hui"), so there is NO in-page `<h1>` (§4.1). Tolerant loader: one
 * failing panel never blanks the screen; a safe default is always the "all
 * caught up" reward, never a white page.
 */
export const Route = createFileRoute('/')({
  loader: ({ context }) => {
    // Signed-out visitor (auth ON): show the landing and DO NOT fan out the
    // dashboard queries — each would 401 → forceSignOut → redirect to /login, so
    // the landing would never render (landing spec §1). Safe because the root
    // `beforeLoad` already awaited `auth.ready`. In dev/e2e auth is forced
    // `authenticated`, so this branch is skipped and the loader runs unchanged.
    if (context.auth.getState().status !== 'authenticated') return null
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
  component: IndexRoute,
  pendingComponent: DashboardSkeleton,
})

/** Branch on the live auth status: the public landing, or the real dashboard. */
function IndexRoute() {
  const { status } = useAuth()
  if (status === 'unauthenticated') {
    return (
      <Suspense fallback={null}>
        <LandingPage />
      </Suspense>
    )
  }
  return <DashboardPage />
}

function DashboardPage() {
  const router = useRouter()
  const t = useT()
  const [now] = useState(() => new Date())
  const [createOpen, setCreateOpen] = useState(false)
  const createSubject = useCreateSubject()

  const subjectsQuery = useQuery(subjectsListOptions())
  const dueCountsQuery = useQuery(dueCountsOptions())
  const decksQuery = useQuery(allDecksOptions())
  const examsQuery = useQuery(examsListOptions())
  const streaksQuery = useQuery(streaksOptions(now))
  const heatmapQuery = useQuery(heatmapOptions(now.getFullYear()))

  const subjects = subjectsQuery.data ?? []
  const byId = useMemo(() => buildSubjectsById(subjectsQuery.data), [subjectsQuery.data])
  // `dueKnown` gates every claim made from the queue size. Without it a failed
  // read collapsed to `total = 0` and the screen said "tout est à jour" (T-027).
  const dueKnown = dueCountsQuery.isSuccess
  const total = dueCountsQuery.data?.total ?? 0

  // Three states without a naked zero (§5.4). `dbEmpty` requires a *successful*
  // empty read (never onboarding on a failed fetch). `noCardsYet` distinguishes
  // "nothing created yet" from the legitimate "all caught up" reward — cheaply,
  // via `allDecks` (one query), NOT a per-deck cardCount fan-out (Phase 7).
  const dbEmpty = subjectsQuery.isSuccess && subjects.length === 0
  const noCardsYet =
    !dbEmpty &&
    dueKnown &&
    total === 0 &&
    decksQuery.isSuccess &&
    (decksQuery.data?.length ?? 0) === 0

  // Subjects are the backbone — without them the layout can't be decided.
  if (subjectsQuery.isError) {
    return <ErrorState kind="subjects" onRetry={() => void router.invalidate()} />
  }
  // …and until they are back, the layout is UNDECIDED: `dbEmpty` would be false
  // and the onboarding/reward branches would render on nothing at all (T-027).
  if (subjectsQuery.isPending) return <DashboardSkeleton />

  const showCounter = dueKnown && total > 0

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
            ) : (
              // ONE hero card in every other case. The `3xl` counter appears only
              // once the queue is actually known (`showCounter`); the panel below
              // owns the three states of that same query — skeleton, unavailable,
              // or the legitimate "all caught up" reward (T-027 b).
              <HeroCard>
                {showCounter && (
                  <div className="mb-4 flex items-baseline gap-2.5">
                    <span className="font-mono text-3xl font-medium leading-none tabular-nums text-text">
                      {total}
                    </span>
                    <span className="text-sm text-text-muted">{t('dashboard.toReviewToday')}</span>
                  </div>
                )}
                <TodayPanel subjectsById={byId} now={now} hideTotal={showCounter} />
              </HeroCard>
            )}
          </div>

          <div className="flex flex-col gap-4 lg:col-span-4">
            {/* Pending ≠ unavailable (T-027): a query still in flight gets a
                skeleton at the block's final height, never a verdict. */}
            {streaksQuery.isPending ? (
              <Skeleton
                className="h-[120px] rounded-lg"
                role="status"
                aria-busy="true"
                aria-label={t('dashboard.loadingStreak')}
              />
            ) : streaksQuery.isSuccess ? (
              <StreakCard streaks={streaksQuery.data} />
            ) : (
              <BlockUnavailable label={t('dashboard.streak.label')} t={t} />
            )}
            {examsQuery.isPending ? (
              <Skeleton
                className="h-[140px] rounded-lg"
                role="status"
                aria-busy="true"
                aria-label={t('dashboard.loadingExams')}
              />
            ) : examsQuery.isSuccess ? (
              <UpcomingExams exams={examsQuery.data} subjectsById={byId} now={now} />
            ) : (
              <BlockUnavailable label={t('dashboard.exams.label')} t={t} />
            )}
          </div>

          {/* Recent activity — soft Phase 5 dependency (§5.3.D): its absence never
              blocks the dashboard. Still in flight → a skeleton holds the slot;
              failed → the strip is simply not part of the page. */}
          {heatmapQuery.isPending ? (
            <Skeleton
              className="h-[92px] rounded-lg lg:col-span-12"
              role="status"
              aria-busy="true"
              aria-label={t('dashboard.loadingActivity')}
            />
          ) : (
            heatmapQuery.isSuccess && (
              <div className="lg:col-span-12">
                <RecentActivity heatmap={heatmapQuery.data} now={now} />
              </div>
            )
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
