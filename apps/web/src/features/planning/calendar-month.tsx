import { useMemo } from 'react'
import type { StudyPlanResponse, Subject } from '@engram/shared'
import { monthMatrix, parseDayKey } from '@/lib/calendar'
import { weekdayAbbrevs } from '@/lib/format'
import { DayCell } from './day-cell'
import { useCalendarGrid } from './use-calendar-grid'
import { indexDays, subjectsById, windowMax } from './plan-utils'

/**
 * Month view (spec §2): a `role="grid"` of 6×7 cells (Monday→Sunday), 1px
 * hairline gaps, keyboard-driven via `useCalendarGrid`. The selected day is the
 * single tab stop; the whole toolbar/detail wiring lives in the route.
 */
export function CalendarMonth({
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
  const matrix = useMemo(() => monthMatrix(parseDayKey(dayKey), now), [dayKey, now])
  const daysIndex = useMemo(() => indexDays(plan), [plan])
  const max = useMemo(() => windowMax(plan), [plan])
  const byId = useMemo(() => subjectsById(subjects), [subjects])

  const { gridRef, onKeyDown, getCellProps } = useCalendarGrid({
    view: 'month',
    dayKey,
    onSelect,
    onActivate,
  })

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-border">
      <div className="grid grid-cols-7 bg-bg" role="presentation">
        {weekdays.map((label) => (
          <div
            key={label}
            role="columnheader"
            className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint"
          >
            {label}
          </div>
        ))}
      </div>
      <div
        ref={gridRef}
        role="grid"
        aria-label="Calendrier mensuel"
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-px bg-border"
      >
        {matrix.map((week, r) => (
          <div key={r} role="row" className="contents">
            {week.map((cell) => (
              <DayCell
                key={cell.key}
                cell={cell}
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
        ))}
      </div>
    </div>
  )
}
