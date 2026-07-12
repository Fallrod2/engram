import { useCallback, useEffect, useRef } from 'react'
import {
  addDays,
  addMonths,
  localDayKey,
  parseDayKey,
  startOfWeekMonday,
  type CalendarView,
} from '@/lib/calendar'

/**
 * Given the pressed key, the current view and the selected day key, return the
 * next day key — or `null` if the key is not a grid-navigation key (spec §2.4).
 * `Space` is deliberately UNMAPPED (reserved for the Phase 2 session).
 *
 *   ←/→ : ∓1 day · ↑/↓ : ∓1 week · PgUp/PgDn : ∓1 month (month) / ∓1 week (week)
 *   Home/End : Monday/Sunday of the row · t : today
 */
export function nextDayKeyForKey(
  key: string,
  view: CalendarView,
  dayKey: string,
  now: Date = new Date(),
): string | null {
  const d = parseDayKey(dayKey)
  switch (key) {
    case 'ArrowLeft':
      return localDayKey(addDays(d, -1))
    case 'ArrowRight':
      return localDayKey(addDays(d, 1))
    case 'ArrowUp':
      return localDayKey(addDays(d, -7))
    case 'ArrowDown':
      return localDayKey(addDays(d, 7))
    case 'PageUp':
      return localDayKey(view === 'week' ? addDays(d, -7) : addMonths(d, -1))
    case 'PageDown':
      return localDayKey(view === 'week' ? addDays(d, 7) : addMonths(d, 1))
    case 'Home':
      return localDayKey(startOfWeekMonday(d))
    case 'End':
      return localDayKey(addDays(startOfWeekMonday(d), 6))
    case 't':
    case 'T':
      return localDayKey(now)
    default:
      return null
  }
}

/**
 * 2D roving-grid keyboard behavior for the calendar (spec §2.4). One cell is
 * `tabIndex=0` (the selected `dayKey`); the rest are `-1`. Arrow/PgUp/Home/`t`
 * move the selection via `onSelect(newKey)` (which drives the search param);
 * after the grid re-renders we re-focus the selected cell so focus tracks the
 * cursor. `Enter` fires `onActivate`.
 */
export function useCalendarGrid({
  view,
  dayKey,
  onSelect,
  onActivate,
}: {
  view: CalendarView
  dayKey: string
  onSelect: (key: string) => void
  onActivate?: () => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  // Re-focus the selected cell only when the move came from the keyboard.
  const wantFocusRef = useRef(false)

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onActivate?.()
        return
      }
      const next = nextDayKeyForKey(e.key, view, dayKey)
      if (next === null) return
      e.preventDefault()
      wantFocusRef.current = true
      if (next !== dayKey) onSelect(next)
      else focusSelected() // e.g. `Home` already on Monday: still snap focus
    },
    [view, dayKey, onSelect, onActivate],
  )

  const focusSelected = useCallback(() => {
    const el = gridRef.current?.querySelector<HTMLElement>('[data-day-selected="true"]')
    el?.focus()
  }, [])

  useEffect(() => {
    if (wantFocusRef.current) {
      wantFocusRef.current = false
      focusSelected()
    }
  }, [dayKey, view, focusSelected])

  /** Props for a gridcell: the selected day is the single tab stop. */
  const getCellProps = useCallback(
    (cellKey: string) => {
      const selected = cellKey === dayKey
      return {
        role: 'gridcell' as const,
        tabIndex: selected ? 0 : -1,
        ...(selected ? { 'data-day-selected': 'true' as const } : {}),
      }
    },
    [dayKey],
  )

  return { gridRef, onKeyDown, getCellProps }
}
