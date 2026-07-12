import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import type { Exam, Subject } from '@engram/shared'
import { localDayKey } from '@/lib/calendar'
import { useT } from '@/lib/i18n'
import { SubjectDot } from '@/components/subject-dot'
import { Countdown } from '@/components/countdown'

const MAX = 3

/**
 * "Prochains examens" block (spec §5.3.C). Up to 3 upcoming exams (`date >=
 * today`, asc), each a row with a title, its subjects' dots and a `Countdown`
 * (mono, never red). A row deep-links to the planning day with the exam dialog.
 */
export function UpcomingExams({
  exams,
  subjectsById,
  now,
}: {
  exams: Exam[]
  subjectsById: Map<string, Subject>
  now: Date
}) {
  const t = useT()
  const todayKey = localDayKey(now)
  const upcoming = useMemo(
    () =>
      exams
        .filter((e) => localDayKey(new Date(e.date)) >= todayKey)
        .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
        .slice(0, MAX),
    [exams, todayKey],
  )

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-4">
      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
        {t('dashboard.exams.label')}
      </p>
      {upcoming.length === 0 ? (
        <div className="flex flex-col items-start gap-1 py-1">
          <p className="text-sm text-text-muted">{t('dashboard.exams.none')}</p>
          <Link
            to="/planning"
            className="text-xs text-text-faint transition-colors hover:text-accent"
          >
            {t('dashboard.exams.plan')}
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col">
          {upcoming.map((exam) => {
            const dots = exam.subjectIds
              .map((id) => subjectsById.get(id))
              .filter((s): s is Subject => !!s)
            const dayKey = localDayKey(new Date(exam.date))
            return (
              <li key={exam.id}>
                <Link
                  to="/planning"
                  search={{ day: dayKey, exam: exam.id }}
                  className="-mx-2 flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-surface-2"
                >
                  {dots.length > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      {dots.map((s) => (
                        <SubjectDot key={s.id} color={s.color} muted={s.archived} />
                      ))}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{exam.title}</span>
                  <Countdown dateIso={exam.date} now={now} />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
