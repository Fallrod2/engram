import { useEffect, useRef, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const

/** `YYYY-MM-DD`, the only form of a day this input accepts. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse a typed day key into a real local date, or `null`.
 *
 * Stricter than `parseDayKey`, which trusts its caller: `2026-02-31` and
 * `2026-13-01` both produce a `Date` there (JS rolls them over), and silently
 * moving somebody's exam to March because they typed a day that does not exist
 * is worse than refusing the value. The round-trip through `localDayKey` is the
 * check — a date that does not print back as what was typed did not exist.
 */
export function parseTypedDay(text: string): Date | null {
  const trimmed = text.trim()
  if (!DAY_KEY.test(trimmed)) return null
  const date = parseDayKey(trimmed)
  if (Number.isNaN(date.getTime())) return null
  return localDayKey(date) === trimmed ? date : null
}

/**
 * A themed date picker (spec §1.6 replaces the shadcn `calendar`): hairline
 * borders, `accent` on the selected day, an `accent` ring on today, mono
 * tabular digits, NEVER red.
 *
 * T-036 — THE DATE IS TYPEABLE. It used to be a button and a grid of buttons and
 * nothing else, so setting an exam three months out meant three clicks on a
 * chevron, and setting it to a date you already knew meant navigating to it. The
 * field is now an `<input>` carrying `YYYY-MM-DD`; the calendar moves into an
 * icon button beside it and keeps doing what it is good at (browsing).
 *
 * Why `YYYY-MM-DD` and not the reader's locale: this is the app's `localDayKey`
 * shape, it is what the API stores, it does not reorder between FR and EN — and
 * `03/04` means two different days on either side of the Channel. The long
 * localized form is not lost: it is the input's accessible name, and every day
 * button in the grid still carries it.
 *
 * Typing is committed on every keystroke that parses, so the calendar below
 * follows along. Nonsense is NOT committed — the field keeps the text so it can
 * be finished, marks itself invalid, and snaps back to the live value on blur
 * rather than leaving a half-typed date standing where a real one should be.
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

  const valueKey = localDayKey(value)
  const [text, setText] = useState(valueKey)
  // Follow the value when it moves from OUTSIDE (the grid, a form reset), but
  // never fight the user mid-keystroke: their own commits already match, so this
  // only ever fires for a change they did not type.
  const lastValueRef = useRef(valueKey)
  useEffect(() => {
    if (lastValueRef.current === valueKey) return
    lastValueRef.current = valueKey
    setText(valueKey)
  }, [valueKey])

  const typedInvalid = parseTypedDay(text) === null

  const commit = (next: string) => {
    setText(next)
    const parsed = parseTypedDay(next)
    if (!parsed) return
    lastValueRef.current = localDayKey(parsed)
    setViewMonth(startOfMonth(parsed))
    onChange(parsed)
  }

  const pick = (key: string) => {
    const date = parseDayKey(key)
    lastValueRef.current = key
    setText(key)
    onChange(date)
    setOpen(false)
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={text}
        onChange={(e) => commit(e.target.value)}
        // A half-typed date must not survive leaving the field: snap back to the
        // value the form actually holds.
        onBlur={() => setText(localDayKey(value))}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder={t('planning.datePlaceholder')}
        aria-label={t('planning.dateInputAria', { date: formatLongDay(valueKey) })}
        aria-invalid={invalid || typedInvalid || undefined}
        className={cn(
          'min-w-0 flex-1 font-mono text-xs tabular-nums',
          (invalid || typedInvalid) && 'border-danger',
        )}
      />
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
            size="icon"
            aria-label={t('planning.openCalendar')}
          >
            <CalendarDays className="size-4 text-text-muted" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="end">
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
                  onClick={() => pick(cell.key)}
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
    </div>
  )
}
