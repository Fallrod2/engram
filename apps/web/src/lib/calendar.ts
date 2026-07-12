/**
 * Calendar math for the Planning screen (spec §1.5). Pure functions, unit
 * tested — every day is a LOCAL calendar day (mono-user localhost), mirroring
 * the server's `apps/server/src/lib/day.ts`.
 *
 * PITFALL (API handoff): a `YYYY-MM-DD` key is a LOCAL day, never an instant.
 * We NEVER `new Date('YYYY-MM-DD')` (that parses as UTC midnight and shifts the
 * day west of Greenwich) — we always split into components and build a local
 * `Date`.
 */

/** A single day rendered in the month/week grid. */
export interface DayCell {
  date: Date
  /** `YYYY-MM-DD` local key. */
  key: string
  /** Belongs to the anchor's month (month view dims the others). */
  inMonth: boolean
  isToday: boolean
  isWeekend: boolean
}

/** Zero-pad to 2 digits. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** `Date` → `YYYY-MM-DD` local key (mirror of the server `localDayKey`). */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** `YYYY-MM-DD` local key → local midnight `Date` (parsed BY COMPONENTS). */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

/** Local midnight of a date (drops the time part). */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** New date `n` days after `d` (n may be negative), at the same wall-clock. */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/**
 * New date `n` months after `d`, clamping the day of month to the last valid
 * day of the target month (31 Jan + 1 month → 28/29 Feb) — used by PgUp/PgDn.
 */
export function addMonths(d: Date, n: number): Date {
  const y = d.getFullYear()
  const m = d.getMonth() + n
  const targetY = y + Math.floor(m / 12)
  const targetM = ((m % 12) + 12) % 12
  const lastDay = new Date(targetY, targetM + 1, 0).getDate()
  return new Date(targetY, targetM, Math.min(d.getDate(), lastDay))
}

/** Monday of the week containing `d` (weeks run Monday→Sunday, FR locale). */
export function startOfWeekMonday(d: Date): Date {
  const day = d.getDay() // 0=Sun … 6=Sat
  const deltaToMonday = (day + 6) % 7 // Mon→0, Sun→6
  return addDays(startOfDay(d), -deltaToMonday)
}

/** First day of the month containing `d`. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/** Same local calendar day? */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function isToday(d: Date, now: Date = new Date()): boolean {
  return isSameDay(d, now)
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay()
  return day === 0 || day === 6
}

/** Signed whole-day difference `b - a` in local calendar days. */
export function dayDiff(a: Date, b: Date): number {
  const DAY_MS = 24 * 60 * 60 * 1000
  // Divide start-of-day epochs; round to shrug off DST hour shifts.
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

/**
 * 6×7 month grid (42 cells) starting on the Monday ≤ the 1st of the anchor's
 * month. Rows are weeks, columns Monday→Sunday.
 */
export function monthMatrix(anchor: Date, now: Date = new Date()): DayCell[][] {
  const first = startOfMonth(anchor)
  const gridStart = startOfWeekMonday(first)
  const anchorMonth = anchor.getMonth()
  const rows: DayCell[][] = []
  for (let r = 0; r < 6; r++) {
    const row: DayCell[] = []
    for (let c = 0; c < 7; c++) {
      const date = addDays(gridStart, r * 7 + c)
      row.push({
        date,
        key: localDayKey(date),
        inMonth: date.getMonth() === anchorMonth,
        isToday: isToday(date, now),
        isWeekend: isWeekend(date),
      })
    }
    rows.push(row)
  }
  return rows
}

/** The 7 days (Monday→Sunday) of the week containing `anchor`. */
export function weekDays(anchor: Date, now: Date = new Date()): DayCell[] {
  const start = startOfWeekMonday(anchor)
  const anchorMonth = anchor.getMonth()
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i)
    return {
      date,
      key: localDayKey(date),
      inMonth: date.getMonth() === anchorMonth,
      isToday: isToday(date, now),
      isWeekend: isWeekend(date),
    }
  })
}

export type CalendarView = 'month' | 'week'

/**
 * Inclusive `{from, to}` bounds (local day keys) of the visible grid: the 42
 * cells for a month, the Monday→Sunday span for a week. These feed the
 * `/study-plan` window query.
 */
export function rangeFor(view: CalendarView, dayKey: string): { from: string; to: string } {
  const anchor = parseDayKey(dayKey)
  if (view === 'week') {
    const start = startOfWeekMonday(anchor)
    return { from: localDayKey(start), to: localDayKey(addDays(start, 6)) }
  }
  const first = startOfMonth(anchor)
  const gridStart = startOfWeekMonday(first)
  return { from: localDayKey(gridStart), to: localDayKey(addDays(gridStart, 41)) }
}
