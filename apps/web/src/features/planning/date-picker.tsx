import { useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addMonths,
  isSameDay,
  localDayKey,
  monthMatrix,
  parseDayKey,
  startOfMonth,
} from '@/lib/calendar'
import { formatLongDay, formatMonthLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const

/**
 * A themed date picker (spec §1.6 replaces the shadcn `calendar`): hairline
 * borders, `accent` on the selected day, an `accent` ring on today, mono
 * tabular digits, NEVER red. Built on our own `monthMatrix` — no extra dep.
 */
export function DatePicker({
  value,
  onChange,
  invalid,
}: {
  value: Date
  onChange: (d: Date) => void
  invalid?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(value))
  const matrix = monthMatrix(viewMonth)

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setViewMonth(startOfMonth(value))
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          className={cn('w-full justify-start font-mono text-xs', invalid && 'border-danger')}
        >
          <CalendarDays className="size-4 text-text-muted" />
          {formatLongDay(localDayKey(value))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-text-muted"
            aria-label={t('planning.prevMonth')}
            onClick={() => setViewMonth((m) => addMonths(m, -1))}
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm font-medium capitalize text-text">
            {formatMonthLabel(viewMonth)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-text-muted"
            aria-label={t('planning.nextMonth')}
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d, i) => (
            <span
              key={i}
              className="flex h-6 items-center justify-center text-2xs font-semibold uppercase tracking-[0.06em] text-text-faint"
            >
              {d}
            </span>
          ))}
          {matrix.flat().map((cell) => {
            const selected = isSameDay(cell.date, value)
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => {
                  onChange(parseDayKey(cell.key))
                  setOpen(false)
                }}
                className={cn(
                  'flex size-8 items-center justify-center rounded-sm font-mono text-xs tabular-nums transition-colors duration-fast',
                  selected
                    ? 'bg-accent-fill text-accent-fg'
                    : cell.inMonth
                      ? 'text-text hover:bg-surface-3'
                      : 'text-text-faint hover:bg-surface-3',
                  !selected && cell.isToday && 'ring-1 ring-accent',
                )}
                aria-label={formatLongDay(cell.key)}
                aria-current={cell.isToday ? 'date' : undefined}
              >
                {cell.date.getDate()}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
