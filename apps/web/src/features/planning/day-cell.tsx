import type { HTMLAttributes } from 'react'
import type { StudyPlanDay, Subject } from '@engram/shared'
import type { DayCell as DayCellData } from '@/lib/calendar'
import { formatLongDay } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DayLoad } from '@/components/day-load'
import { ExamChip } from '@/components/exam-chip'

const MAX_CHIPS = 2

/**
 * A month-grid cell (spec §2.2): day number (mono), the day's load (`DayLoad`,
 * intensity never red) and up to 2 pinned exam chips (then `+k`). Today = accent
 * ring on the number; selected = `accent-subtle` fill + a 2px accent edge bar
 * (mirror of the active nav item). Weekend numbers retreat to `text-faint`.
 */
export function DayCell({
  cell,
  day,
  max,
  subjectsById,
  selected,
  now,
  cellProps,
  onSelect,
}: {
  cell: DayCellData
  day: StudyPlanDay | undefined
  max: number
  subjectsById: Map<string, Subject>
  selected: boolean
  now?: Date
  cellProps: HTMLAttributes<HTMLDivElement> & { 'data-day-selected'?: 'true' }
  onSelect: () => void
}) {
  const total = day?.total ?? 0
  const exams = day?.exams ?? []
  const shownExams = exams.slice(0, MAX_CHIPS)
  const overflow = exams.length - shownExams.length

  return (
    <div
      {...cellProps}
      onClick={onSelect}
      aria-selected={selected}
      aria-label={`${formatLongDay(cell.key)} — ${total} reviews prévues, ${exams.length} examens`}
      className={cn(
        'group/cell relative flex min-h-[104px] cursor-pointer flex-col gap-1 p-1.5 text-left',
        'transition-colors duration-fast',
        cell.inMonth ? 'bg-bg' : 'bg-surface-1/40',
        selected ? 'bg-accent-subtle' : 'hover:bg-surface-2',
      )}
    >
      {selected && (
        <span className="absolute inset-y-0 left-0 w-0.5 rounded-r bg-accent" aria-hidden />
      )}
      <div className="flex items-start justify-between gap-1">
        <span
          className={cn(
            'flex size-5 items-center justify-center rounded-full font-mono text-xs tabular-nums',
            cell.isToday && 'ring-1 ring-accent',
            !cell.inMonth ? 'text-text-faint' : cell.isWeekend ? 'text-text-faint' : 'text-text',
          )}
        >
          {cell.date.getDate()}
        </span>
        <DayLoad value={total} max={max} variant="cell" />
      </div>

      {shownExams.length > 0 && (
        <div className="mt-auto flex flex-col gap-0.5">
          {shownExams.map((ex) => (
            <ExamChip
              key={ex.examId}
              title={ex.title}
              subjectIds={ex.subjectIds}
              dateIso={cell.date.toISOString()}
              subjectsById={subjectsById}
              compact
              {...(now ? { now } : {})}
            />
          ))}
          {overflow > 0 && (
            <span className="px-1 font-mono text-2xs tabular-nums text-text-muted">
              +{overflow} examen{overflow > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
