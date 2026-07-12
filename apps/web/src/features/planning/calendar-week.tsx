import { useMemo } from 'react'
import type { HTMLAttributes } from 'react'
import type { StudyPlanDay, StudyPlanResponse, Subject } from '@engram/shared'
import { parseDayKey, weekDays, type DayCell as DayCellData } from '@/lib/calendar'
import { formatLongDay, weekdayAbbrevs } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DayLoad } from '@/components/day-load'
import { ExamChip } from '@/components/exam-chip'
import { SubjectCompositionBar } from '@/components/subject-composition-bar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCalendarGrid } from './use-calendar-grid'
import { daySegments, indexDays, subjectsById, windowMax } from './plan-utils'

/**
 * Week view (spec §3): same `role="grid"` and keyboard model as the month, but
 * 7 tall columns with more inline detail per day (load, subject composition,
 * stacked exam chips). Denser, thumb-friendly on small screens.
 */
export function CalendarWeek({
  dayKey,
  plan,
  subjects,
  now,
  onSelect,
  onActivate,
}: {
  dayKey: string
  plan: StudyPlanResponse | undefined
  subjects: Subject[] | undefined
  now?: Date
  onSelect: (key: string) => void
  onActivate: () => void
}) {
  const weekdays = weekdayAbbrevs()
  const days = useMemo(() => weekDays(parseDayKey(dayKey), now), [dayKey, now])
  const daysIndex = useMemo(() => indexDays(plan), [plan])
  const max = useMemo(() => windowMax(plan), [plan])
  const byId = useMemo(() => subjectsById(subjects), [subjects])

  const { gridRef, onKeyDown, getCellProps } = useCalendarGrid({
    view: 'week',
    dayKey,
    onSelect,
    onActivate,
  })

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label="Calendrier hebdomadaire"
      onKeyDown={onKeyDown}
      className="grid min-h-[60vh] grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border"
    >
      {days.map((cell, i) => (
        <WeekColumn
          key={cell.key}
          cell={cell}
          abbr={weekdays[i]!}
          day={daysIndex.get(cell.key)}
          max={max}
          subjectsById={byId}
          selected={cell.key === dayKey}
          cellProps={getCellProps(cell.key)}
          onSelect={() => onSelect(cell.key)}
          {...(now ? { now } : {})}
        />
      ))}
    </div>
  )
}

function WeekColumn({
  cell,
  abbr,
  day,
  max,
  subjectsById,
  selected,
  now,
  cellProps,
  onSelect,
}: {
  cell: DayCellData
  abbr: string
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
  const segments = daySegments(day, subjectsById)

  return (
    <div
      {...cellProps}
      onClick={onSelect}
      aria-selected={selected}
      aria-label={`${formatLongDay(cell.key)} — ${total} reviews prévues, ${exams.length} examens`}
      className={cn(
        'relative flex cursor-pointer flex-col outline-none transition-colors duration-fast',
        selected ? 'bg-accent-subtle' : 'bg-bg hover:bg-surface-2',
      )}
    >
      {selected && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" aria-hidden />}
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
          {abbr}
        </span>
        <span
          className={cn(
            'flex size-5 items-center justify-center rounded-full font-mono text-xs tabular-nums',
            cell.isToday && 'ring-1 ring-accent',
            cell.isWeekend ? 'text-text-faint' : 'text-text',
          )}
        >
          {cell.date.getDate()}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-2">
          <DayLoad value={total} max={max} variant="week" />
          {segments.length > 0 && <SubjectCompositionBar segments={segments} />}
          {exams.map((ex) => (
            <ExamChip
              key={ex.examId}
              title={ex.title}
              subjectIds={ex.subjectIds}
              dateIso={cell.date.toISOString()}
              subjectsById={subjectsById}
              {...(now ? { now } : {})}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
