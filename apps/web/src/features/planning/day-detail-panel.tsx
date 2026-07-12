import { forwardRef, useMemo } from 'react'
import { CalendarOff, GraduationCap, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Exam, StudyPlanDay, Subject } from '@engram/shared'
import { localDayKey } from '@/lib/calendar'
import { formatLongDay, formatRelativeDay } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SUBJECT_BG_CLASS, pigmentSlotForHex } from '@/lib/pigments'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SubjectDot } from '@/components/subject-dot'
import { Countdown } from '@/components/countdown'
import { SubjectCompositionBar } from '@/components/subject-composition-bar'
import { daySegments } from './plan-utils'
import { TodayPanel } from './today-panel'

/**
 * Right-rail day detail (spec §2.5). Always reflects the selected `day`. For
 * today it becomes the enriched `<TodayPanel>` suggestion; for other days it
 * shows the projection (total + subject composition + legend) with a Réviser CTA
 * that is only active on days whose cards are actually due (today).
 */
export const DayDetailPanel = forwardRef<
  HTMLDivElement,
  {
    dayKey: string
    day: StudyPlanDay | undefined
    exams: Exam[]
    subjectsById: Map<string, Subject>
    isToday: boolean
    now: Date
    onEditExam: (exam: Exam) => void
    onDeleteExam: (exam: Exam) => void
  }
>(function DayDetailPanel(
  { dayKey, day, exams, subjectsById, isToday, now, onEditExam, onDeleteExam },
  ref,
) {
  const total = day?.total ?? 0
  const segments = useMemo(() => daySegments(day, subjectsById), [day, subjectsById])
  const maxSeg = segments.reduce((m, s) => Math.max(m, s.count), 0)
  const dayExams = exams.filter((e) => localDayKey(new Date(e.date)) === dayKey)

  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col gap-4 outline-none">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-mono text-sm tabular-nums text-text">{formatLongDay(dayKey)}</h2>
        <span className="text-xs text-text-muted">{formatRelativeDay(dayKey, now)}</span>
      </div>

      {isToday ? (
        <TodayPanel subjectsById={subjectsById} now={now} />
      ) : (
        <>
          {total > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-lg tabular-nums text-text">{total}</span>
                <span className="text-sm text-text-muted">reviews prévues</span>
              </div>
              {day && day.overdueCount > 0 && (
                <p className="-mt-2 font-mono text-xs tabular-nums text-text-muted">
                  dont {day.overdueCount} en retard
                </p>
              )}
              {segments.length > 0 && (
                <>
                  <SubjectCompositionBar segments={segments} />
                  <ul className="flex flex-col gap-1.5">
                    {segments.map((s) => {
                      const subject = subjectsById.get(s.subjectId)
                      const slot = pigmentSlotForHex(s.colorHex)
                      return (
                        <li key={s.subjectId} className="flex items-center gap-2">
                          <SubjectDot color={s.colorHex} muted={!!subject?.archived} />
                          <span className="min-w-0 flex-1 truncate text-sm text-text">
                            {subject?.name ?? 'Matière'}
                          </span>
                          <span
                            className="h-1 w-10 overflow-hidden rounded-full bg-surface-3"
                            aria-hidden
                          >
                            <span
                              className={cn('block h-full', slot && SUBJECT_BG_CLASS[slot])}
                              style={{
                                width: `${maxSeg > 0 ? (s.count / maxSeg) * 100 : 0}%`,
                                ...(slot ? {} : { background: s.colorHex }),
                              }}
                            />
                          </span>
                          <span className="w-6 text-right font-mono text-xs tabular-nums text-text-muted">
                            {s.count}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
              <div className="flex flex-col gap-1">
                <Button disabled className="w-full">
                  <GraduationCap />
                  Réviser
                </Button>
                <p className="text-2xs text-text-muted">Révision disponible le jour même.</p>
              </div>
            </div>
          ) : dayExams.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <CalendarOff className="size-4 text-text-faint" strokeWidth={1.75} />
              Rien de prévu ce jour.
            </div>
          ) : null}
        </>
      )}

      {dayExams.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
            Examens
          </p>
          {dayExams.map((exam) => (
            <div key={exam.id} className="group/ex flex items-center gap-2">
              <GraduationCap className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-sm text-text">{exam.title}</span>
              <span className="flex shrink-0 items-center gap-0.5">
                {exam.subjectIds
                  .map((id) => subjectsById.get(id))
                  .filter((s): s is Subject => !!s)
                  .slice(0, 3)
                  .map((s) => (
                    <SubjectDot key={s.id} color={s.color} muted={s.archived} />
                  ))}
              </span>
              <Countdown dateIso={exam.date} now={now} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 text-text-muted opacity-0 transition-opacity group-focus-within/ex:opacity-100 group-hover/ex:opacity-100"
                    aria-label={`Actions de l'examen ${exam.title}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onEditExam(exam)}>
                    <Pencil />
                    Éditer
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-danger [&_svg]:text-danger"
                    onSelect={() => onDeleteExam(exam)}
                  >
                    <Trash2 />
                    Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
