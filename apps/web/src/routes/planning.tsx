import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { z } from 'zod'
import type { Exam, StudyPlanDay, StudyPlanResponse, Subject } from '@engram/shared'
import {
  addDays,
  addMonths,
  localDayKey,
  parseDayKey,
  rangeFor,
  type CalendarView,
} from '@/lib/calendar'
import { formatLongDay, formatMonthLabel, formatWeekLabel } from '@/lib/format'
import { useHotkeys } from '@/lib/use-hotkeys'
import { useMediaQuery } from '@/lib/use-media-query'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EmptyState } from '@/components/empty-state'
import { useT } from '@/lib/i18n'
import { ErrorState } from '@/components/error-state'
import { ConfirmDelete } from '@/components/confirm-delete'
import { PlanningIllustration } from '@/components/illustrations'
import { subjectsListOptions } from '@/features/subjects/queries'
import {
  examsListOptions,
  studyPlanOptions,
  useCreateExam,
  useDeleteExam,
  useUpdateExam,
} from '@/features/planning/queries'
import { indexDays, subjectsById } from '@/features/planning/plan-utils'
import { CalendarMonth } from '@/features/planning/calendar-month'
import { CalendarWeek } from '@/features/planning/calendar-week'
import { DayDetailPanel } from '@/features/planning/day-detail-panel'
import { ExamList, type ExamListHandle } from '@/features/planning/exam-list'
import { ExamFormDialog } from '@/features/planning/exam-form-dialog'
import {
  DayDetailSkeleton,
  ExamListSkeleton,
  PlanningGridSkeleton,
} from '@/features/planning/planning-skeleton'

const planningSearchSchema = z.object({
  view: z.enum(['month', 'week']).catch('month'),
  // The single cursor state (YYYY-MM-DD local). The visible month/week derives
  // from it. Defaults to today.
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(() => localDayKey(new Date())),
  // Deep-linkable exam dialog: 'new' | examId. Absent = closed.
  exam: z.string().optional(),
})

export const Route = createFileRoute('/planning')({
  validateSearch: planningSearchSchema,
  loaderDeps: ({ search }) => ({ view: search.view, day: search.day }),
  loader: async ({ context, deps }) => {
    const range = rangeFor(deps.view, deps.day)
    // Tolerant preload: never let one failing panel blank the whole screen —
    // per-panel errors are surfaced in the component (spec §5.3).
    await Promise.allSettled([
      context.queryClient.ensureQueryData(studyPlanOptions(range)),
      context.queryClient.ensureQueryData(examsListOptions()),
      context.queryClient.ensureQueryData(subjectsListOptions()),
    ])
  },
  component: PlanningPage,
  pendingComponent: PlanningSkeleton,
  // Safety net for an unrecoverable failure on first load (spec §10). The loader
  // is tolerant (Promise.allSettled) and panel errors render inline, so this only
  // catches a render/throw that would otherwise blank the route.
  errorComponent: PlanningError,
})

function PlanningError() {
  const router = useRouter()
  return <ErrorState kind="planning" onRetry={() => void router.invalidate()} />
}

function PlanningPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const t = useT()
  const { view, day, exam } = search

  // Stable "now" for the session so today/countdowns don't drift per render.
  const [now] = useState(() => new Date())
  const todayKey = localDayKey(now)

  // Below 768 the 7×6 month grid is unreadable at thumb size → clamp the DISPLAY
  // to the week without rewriting the URL (spec §8.3), so a resize back to
  // desktop restores the user's chosen view. The month/week tabs hide < md.
  const isMobile = useMediaQuery('(max-width: 767px)')
  const effectiveView: CalendarView = isMobile ? 'week' : view

  // Bottom Sheet holds the day detail on mobile (the side rail is hidden < md).
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  useEffect(() => {
    if (!isMobile) setMobileDetailOpen(false)
  }, [isMobile])

  const range = useMemo(() => rangeFor(effectiveView, day), [effectiveView, day])
  const planQuery = useQuery(studyPlanOptions(range))
  const examsQuery = useQuery(examsListOptions())
  const subjectsQuery = useQuery(subjectsListOptions())

  const exams = useMemo(() => examsQuery.data ?? [], [examsQuery.data])
  const byId = useMemo(() => subjectsById(subjectsQuery.data), [subjectsQuery.data])
  const daysIndex = useMemo(() => indexDays(planQuery.data), [planQuery.data])
  const selectedDay = daysIndex.get(day)
  const isToday = day === todayKey

  const detailRef = useRef<HTMLDivElement>(null)
  const examListRef = useRef<ExamListHandle>(null)
  const [deleteTarget, setDeleteTarget] = useState<Exam | null>(null)

  const createExam = useCreateExam()
  const updateExam = useUpdateExam()
  const deleteExam = useDeleteExam()

  const setDay = (key: string) => void navigate({ search: (p) => ({ ...p, day: key }) })
  // Selecting a day from the grid: on mobile it opens the bottom detail Sheet.
  const selectDay = (key: string) => {
    setDay(key)
    if (isMobile) setMobileDetailOpen(true)
  }
  const setView = (v: CalendarView) => void navigate({ search: (p) => ({ ...p, view: v }) })
  const openExam = (id: string) => void navigate({ search: (p) => ({ ...p, exam: id }) })
  const closeExam = () =>
    void navigate({
      search: (p) => ({ ...p, exam: undefined }),
    })

  const editSelectedDayExam = () => {
    const dayExams = exams.filter((e) => localDayKey(new Date(e.date)) === day)
    if (dayExams.length === 1) openExam(dayExams[0]!.id)
    else examListRef.current?.focus()
  }

  useHotkeys(
    {
      m: (e) => {
        e.preventDefault()
        setView('month')
      },
      s: (e) => {
        e.preventDefault()
        setView('week')
      },
      n: (e) => {
        e.preventDefault()
        openExam('new')
      },
      // Back to today (the `<Kbd>t</Kbd>` on the button was never wired, §3.6).
      t: (e) => {
        e.preventDefault()
        setDay(todayKey)
      },
      e: (e) => {
        e.preventDefault()
        editSelectedDayExam()
      },
    },
    // Mute the grid's global single-key shortcuts while the exam dialog is open,
    // so keys never leak to the background (view switches, re-edits) during
    // editing — a modal owns the keyboard while it's up.
    { enabled: exam === undefined },
  )

  const anchor = parseDayKey(day)
  const periodLabel = effectiveView === 'month' ? formatMonthLabel(anchor) : formatWeekLabel(anchor)
  const step = (dir: -1 | 1) =>
    setDay(
      localDayKey(effectiveView === 'month' ? addMonths(anchor, dir) : addDays(anchor, dir * 7)),
    )

  const editingExam = exam && exam !== 'new' ? exams.find((e) => e.id === exam) : undefined

  // Vide total : 0 exam, forecast tout à zéro (aucune due sur la fenêtre).
  const planEmpty =
    !planQuery.isError &&
    (planQuery.data?.days.every((d) => d.total === 0) ?? false) &&
    exams.length === 0

  return (
    <div>
      {/* Toolbar (the shell header already names the section "Planning", §4.1).
          "Nouvel examen" moved here; the month/week tabs hide < md (week is
          forced on mobile). */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-text-muted"
            aria-label={effectiveView === 'month' ? 'Mois précédent' : 'Semaine précédente'}
            onClick={() => step(-1)}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-40 text-center text-lg font-semibold capitalize tracking-[-0.01em] text-text">
            {periodLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="text-text-muted"
            aria-label={effectiveView === 'month' ? 'Mois suivant' : 'Semaine suivante'}
            onClick={() => step(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button variant="secondary" onClick={() => setDay(todayKey)}>
          Aujourd'hui
          <Kbd className="ml-1">t</Kbd>
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => openExam('new')}>
            <Plus />
            Nouvel examen
            <Kbd className="ml-1 border-accent-fg/30 bg-transparent text-accent-fg">n</Kbd>
          </Button>
          <Tabs
            value={view}
            onValueChange={(v) => setView(v as CalendarView)}
            className="hidden md:block"
          >
            <TabsList>
              <TabsTrigger value="month">
                Mois
                <Kbd className="ml-1.5 border-transparent bg-transparent">m</Kbd>
              </TabsTrigger>
              <TabsTrigger value="week">
                Semaine
                <Kbd className="ml-1.5 border-transparent bg-transparent">s</Kbd>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {planEmpty ? (
        <EmptyState
          illustration={<PlanningIllustration />}
          title={t('empty.planningTitle')}
          meta={t('empty.planningMeta')}
          action={
            <Button onClick={() => openExam('new')}>
              <Plus />
              {t('shortcuts.keys.newExam')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* Grid */}
          <div className="min-w-0 flex-1">
            {planQuery.isError ? (
              <PanelError
                message="Impossible de charger la charge prévue."
                onRetry={() => void planQuery.refetch()}
              />
            ) : (
              <GridSwitch
                view={effectiveView}
                dayKey={day}
                plan={planQuery.data}
                subjects={subjectsQuery.data}
                now={now}
                onSelect={selectDay}
                onActivate={() =>
                  isMobile ? setMobileDetailOpen(true) : detailRef.current?.focus()
                }
              />
            )}
          </div>

          {/* Right rail — hidden < md, where the bottom Sheet takes over (§8.3). */}
          <aside className="hidden w-full shrink-0 flex-col gap-4 md:flex lg:w-80">
            <PlanningRail
              detailRef={detailRef}
              examListRef={examListRef}
              planLoading={planQuery.isLoading}
              dayKey={day}
              selectedDay={selectedDay}
              exams={exams}
              subjectsById={byId}
              isToday={isToday}
              now={now}
              examsError={examsQuery.isError}
              examsLoading={examsQuery.isLoading}
              onEditExam={(ex) => openExam(ex.id)}
              onDeleteExam={setDeleteTarget}
              onNewExam={() => openExam('new')}
              onRetryExams={() => void examsQuery.refetch()}
            />
          </aside>
        </div>
      )}

      {/* Mobile day detail (< md): a bottom Sheet with the same rail. */}
      <Sheet open={mobileDetailOpen} onOpenChange={setMobileDetailOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto pb-8">
          <SheetHeader className="pb-0">
            <SheetTitle>{formatLongDay(day)}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 p-4 pt-0">
            <PlanningRail
              planLoading={planQuery.isLoading}
              dayKey={day}
              selectedDay={selectedDay}
              exams={exams}
              subjectsById={byId}
              isToday={isToday}
              now={now}
              examsError={examsQuery.isError}
              examsLoading={examsQuery.isLoading}
              onEditExam={(ex) => openExam(ex.id)}
              onDeleteExam={setDeleteTarget}
              onNewExam={() => openExam('new')}
              onRetryExams={() => void examsQuery.refetch()}
            />
          </div>
        </SheetContent>
      </Sheet>

      <ExamFormDialog
        open={exam !== undefined}
        onOpenChange={(o) => !o && closeExam()}
        {...(editingExam ? { exam: editingExam } : {})}
        defaultDateKey={day}
        onCreate={(input) => createExam.mutate(input)}
        onUpdate={(id, patch) => updateExam.mutate({ id, patch })}
      />
      <ConfirmDelete
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={deleteTarget ? `Supprimer « ${deleteTarget.title} » ?` : ''}
        description="Supprime cet examen. L'échéance disparaît du planning. Irréversible."
        onConfirm={() => deleteTarget && deleteExam.mutate({ id: deleteTarget.id })}
      />
    </div>
  )
}

function GridSwitch({
  view,
  dayKey,
  plan,
  subjects,
  now,
  onSelect,
  onActivate,
}: {
  view: CalendarView
  dayKey: string
  plan: StudyPlanResponse | undefined
  subjects: Subject[] | undefined
  now: Date
  onSelect: (key: string) => void
  onActivate: () => void
}) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduce ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        {view === 'month' ? (
          <CalendarMonth
            dayKey={dayKey}
            plan={plan}
            subjects={subjects}
            now={now}
            onSelect={onSelect}
            onActivate={onActivate}
          />
        ) : (
          <CalendarWeek
            dayKey={dayKey}
            plan={plan}
            subjects={subjects}
            now={now}
            onSelect={onSelect}
            onActivate={onActivate}
          />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * The planning right rail: the selected-day detail + the upcoming-exams list.
 * Shared by the desktop side column and the mobile bottom Sheet (§8.3). Refs are
 * optional — only the desktop instance wires them for keyboard focus.
 */
function PlanningRail({
  detailRef,
  examListRef,
  planLoading,
  dayKey,
  selectedDay,
  exams,
  subjectsById: byId,
  isToday,
  now,
  examsError,
  examsLoading,
  onEditExam,
  onDeleteExam,
  onNewExam,
  onRetryExams,
}: {
  detailRef?: React.Ref<HTMLDivElement>
  examListRef?: React.Ref<ExamListHandle>
  planLoading: boolean
  dayKey: string
  selectedDay: StudyPlanDay | undefined
  exams: Exam[]
  subjectsById: Map<string, Subject>
  isToday: boolean
  now: Date
  examsError: boolean
  examsLoading: boolean
  onEditExam: (ex: Exam) => void
  onDeleteExam: (ex: Exam) => void
  onNewExam: () => void
  onRetryExams: () => void
}) {
  return (
    <>
      <div className="rounded-lg border border-border bg-surface-1 p-4">
        {planLoading ? (
          <DayDetailSkeleton />
        ) : (
          <DayDetailPanel
            {...(detailRef ? { ref: detailRef } : {})}
            dayKey={dayKey}
            day={selectedDay}
            exams={exams}
            subjectsById={byId}
            isToday={isToday}
            now={now}
            onEditExam={onEditExam}
            onDeleteExam={onDeleteExam}
          />
        )}
      </div>

      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
            Examens à venir
          </p>
        </div>
        <Separator className="mb-2" />
        {examsError ? (
          <PanelError message="Impossible de charger les examens." onRetry={onRetryExams} />
        ) : examsLoading ? (
          <ExamListSkeleton />
        ) : (
          <ExamList
            {...(examListRef ? { ref: examListRef } : {})}
            exams={exams}
            subjectsById={byId}
            now={now}
            onNew={onNewExam}
            onEdit={onEditExam}
            onDelete={onDeleteExam}
          />
        )}
      </div>
    </>
  )
}

/** Inline per-panel error (never blanks the screen). */
function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-border bg-surface-2 p-4">
      <p className="text-sm text-text-muted">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  )
}

function PlanningSkeleton() {
  return (
    <div>
      <div className="mb-4 h-8" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <PlanningGridSkeleton />
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <DayDetailSkeleton />
          </div>
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <ExamListSkeleton />
          </div>
        </aside>
      </div>
    </div>
  )
}
