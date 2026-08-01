import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { GraduationCap, Sparkles, Unplug } from 'lucide-react'
import type { Subject } from '@engram/shared'
import { cn } from '@/lib/utils'
import { useT, type TFunction } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SubjectDot } from '@/components/subject-dot'
import { Countdown } from '@/components/countdown'
import { dueCountsOptions } from '@/features/due-counts/queries'
import { studyTodayOptions } from './queries'

/**
 * "What to review today" (spec §4) — reusable, mounted on the Planning detail
 * for today and ready for the Dashboard. The live number is the authoritative
 * `dueCounts.total` ("due NOW"), distinct from the day projection. Reward empty
 * state at zero; a calm, never-alarmist exam prompt when a deadline is near.
 */
export function TodayPanel({
  subjectsById,
  now,
  hideTotal = false,
  className,
}: {
  subjectsById: Map<string, Subject>
  now?: Date
  /**
   * Hide the internal `2xl` total line (spec §5.3.A). The Dashboard renders the
   * single héroïque `3xl` counter itself, so the panel must not double it. The
   * planning `DayDetailPanel` usage keeps the default `false` — unchanged.
   */
  hideTotal?: boolean
  className?: string
}) {
  const t = useT()
  const countsQuery = useQuery(dueCountsOptions())
  const counts = countsQuery.data
  // T-042 — the SAME geste as the one this file was written to close, one query
  // to the right: `useQuery(...).data` throws the handle away, so a failed read
  // is indistinguishable from an empty one. `today?.overdueCount ?? 0` then made
  // "dont N en retard" vanish, and the imminent-exam banner with it, on a read
  // that had simply failed. The handle is kept, and only a SUCCESSFUL read is
  // allowed to feed the two things this query alone knows.
  const todayQuery = useQuery(studyTodayOptions())
  const today = todayQuery.isSuccess ? todayQuery.data : undefined

  const total = counts?.total ?? 0
  const overdue = today?.overdueCount ?? 0

  // Soonest exam within a week, across subjects (calm priority prompt).
  const prompt = useMemo(() => {
    const withExam = (today?.subjects ?? [])
      .map((s) => ({ subjectId: s.subjectId, ex: s.nextExam }))
      .filter(
        (s): s is { subjectId: string; ex: NonNullable<(typeof s)['ex']> } =>
          s.ex !== null && s.ex.daysUntil >= 0 && s.ex.daysUntil <= 7,
      )
    if (withExam.length === 0) return null
    withExam.sort((a, b) => a.ex.daysUntil - b.ex.daysUntil)
    const soonest = withExam[0]!.ex
    const subjectIds = withExam
      .filter((s) => s.ex.examId === soonest.examId)
      .map((s) => s.subjectId)
    return { title: soonest.title, date: soonest.date, subjectIds }
  }, [today])

  // "Tout est à jour" is an ASSERTION about the queue, and `counts?.total ?? 0`
  // let a pending — or outright failed — read produce it (T-027 b): while the
  // demo account was still being seeded server-side, every dashboard read was
  // in flight or erroring and the screen calmly told the visitor there was
  // nothing to review. Three states, never two: unknown-yet, unknown-because-it
  // -failed, and known. Only the last one is allowed to say anything.
  if (countsQuery.isPending) {
    return (
      <div
        className={cn('flex flex-col gap-3', className)}
        role="status"
        aria-busy="true"
        aria-label={t('today.loadingAria')}
      >
        <div className="flex items-start gap-2.5">
          <Skeleton className="mt-0.5 size-8 rounded-lg" />
          <div className="flex flex-col gap-1.5 pt-1">
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      </div>
    )
  }

  if (countsQuery.isError) {
    return (
      <div className={cn('flex flex-col items-start gap-3', className)}>
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex size-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-faint">
            <Unplug className="size-4" strokeWidth={1.75} />
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-base font-medium text-text">{t('today.unknownTitle')}</p>
            <p className="text-xs text-text-muted">{t('today.unknownBody')}</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void countsQuery.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex size-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-faint">
            <Sparkles className="size-4" strokeWidth={1.75} />
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-base font-medium text-text">{t('today.nothingTitle')}</p>
            <p className="text-xs text-text-muted">{t('today.nothingBody')}</p>
          </div>
        </div>
        {todayQuery.isError ? (
          <DetailUnavailable t={t} onRetry={() => void todayQuery.refetch()} />
        ) : (
          prompt && (
            <ExamPrompt
              prompt={prompt}
              subjectsById={subjectsById}
              t={t}
              {...(now ? { now } : {})}
            />
          )
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {!hideTotal && (
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-medium tabular-nums text-text">{total}</span>
          <span className="text-sm text-text-muted">{t('today.toReviewToday')}</span>
        </div>
      )}
      {/* The overdue split and the exam banner both come from `studyToday`, and
          from nowhere else. Pending renders nothing — their absence asserts
          nothing, and `counts` (which gates this whole branch) lands with them.
          A FAILED read is another matter: it used to read as "no backlog, no
          exam", which is a claim, so it says so instead. */}
      {overdue > 0 && (
        <p className="-mt-1 font-mono text-xs tabular-nums text-text-muted">
          {t('today.overdue', { n: overdue })}
        </p>
      )}

      {counts && counts.bySubject.length > 0 && (
        <ul className="-mx-2 flex flex-col">
          {counts.bySubject.map((b) => {
            const s = subjectsById.get(b.subjectId)
            if (!s) return null
            return (
              <li key={b.subjectId}>
                {/* Whole row is the tap target (≥44px), not just the count
                    (fix-mobile-shell §touch-targets). */}
                <Link
                  to="/review"
                  search={{ subjectId: b.subjectId }}
                  className="group flex min-h-11 items-center gap-2 rounded-sm px-2 transition-colors hover:bg-surface-2"
                >
                  <SubjectDot color={s.color} muted={s.archived} />
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{s.name}</span>
                  <span className="font-mono text-xs tabular-nums text-text-muted transition-colors group-hover:text-accent">
                    {b.dueCount}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {todayQuery.isError ? (
        <DetailUnavailable t={t} onRetry={() => void todayQuery.refetch()} />
      ) : (
        prompt && (
          <ExamPrompt prompt={prompt} subjectsById={subjectsById} t={t} {...(now ? { now } : {})} />
        )
      )}

      <Button asChild className="mt-1 w-full">
        <Link to="/review">
          <GraduationCap />
          {t('common.reviewNow')}
        </Link>
      </Button>
    </div>
  )
}

/**
 * The one thing a failed `studyToday` read is allowed to say: that the backlog
 * split and the imminent-exam banner are missing, not absent. Deliberately the
 * same chrome as `ExamPrompt` — it stands in the slot that banner would occupy,
 * so nothing moves when the retry succeeds.
 */
function DetailUnavailable({ t, onRetry }: { t: TFunction; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
      <Unplug className="mt-0.5 size-3.5 shrink-0 text-text-faint" strokeWidth={1.75} />
      <p className="text-xs text-text-muted">
        {t('today.detailUnavailable')}{' '}
        <button
          type="button"
          onClick={onRetry}
          className="rounded-sm underline underline-offset-2 transition-colors duration-fast hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('common.retry')}
        </button>
      </p>
    </div>
  )
}

function ExamPrompt({
  prompt,
  subjectsById,
  now,
  t,
}: {
  prompt: { title: string; date: string; subjectIds: string[] }
  subjectsById: Map<string, Subject>
  now?: Date
  t: TFunction
}) {
  const names = prompt.subjectIds
    .map((id) => subjectsById.get(id)?.name)
    .filter((n): n is string => !!n)
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
      <GraduationCap className="mt-0.5 size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
      <p className="text-xs text-text-muted">
        {t('today.examPrompt')}{' '}
        <span className="text-text">{t('today.examTitle', { title: prompt.title })}</span> —{' '}
        <Countdown dateIso={prompt.date} {...(now ? { now } : {})} className="text-xs" />
        {names.length > 0 && <>{t('today.examPriorise', { names: names.join(', ') })}</>}
      </p>
    </div>
  )
}
