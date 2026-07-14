import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { HeatmapResponse } from '@engram/shared'
import {
  addDays,
  dayDiff,
  localDayKey,
  parseDayKey,
  startOfDay,
  startOfWeekMonday,
} from '@/lib/calendar'
import { formatLongDay } from '@/lib/format'
import { heatLevel, HEAT_BG_CLASS } from '../heat-scale'
import { cn } from '@/lib/utils'

const CELL = 11
const GAP = 3
const PITCH = CELL + GAP // 14px

const WEEKDAYS = ['Lun', '', 'Mer', '', 'Ven', '', ''] as const

interface Cell {
  key: string
  date: Date
  inYear: boolean
  count: number
}

/**
 * The activity heatmap (spec §4) — a GitHub-style contribution calendar, built
 * in CSS grid (Recharts has no calendar heatmap; simulating one would break the
 * mark specs). Sequential single-hue encoding via the shared `HEAT_BG_CLASS`
 * ramp, fixed thresholds, roving-tabindex keyboard navigation, tooltip on hover
 * AND focus. This is the one justified deviation from "Recharts for graphs".
 */
export function ActivityHeatmap({
  data,
  year,
  onYearChange,
  minYear,
}: {
  data: HeatmapResponse
  year: number
  onYearChange: (dir: -1 | 1) => void
  minYear: number
}) {
  const model = useMemo(() => buildGrid(data, year), [data, year])
  const { weeks, monthLabels, gridStart } = model

  const todayKey = localDayKey(new Date())
  const defaultCursor = useMemo(() => {
    const inYear = data.days.find((d) => d.date === todayKey)
    if (inYear) return todayKey
    const active = [...data.days].reverse().find((d) => d.count > 0)
    return active?.date ?? `${year}-01-01`
  }, [data.days, todayKey, year])

  const [cursor, setCursor] = useState(defaultCursor)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const refMap = useRef(new Map<string, HTMLButtonElement>())

  // Horizontal scroller: auto-scroll to the active month on mount and signal
  // that there's more to the left/right with edge fades (fix-mobile-shell
  // §heatmap — the year is wider than a phone and January-first hides today).
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  function updateEdges() {
    const el = scrollerRef.current
    if (!el) return
    setEdges({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    })
  }

  // Reset the cursor when the year changes under it.
  useEffect(() => {
    setCursor(defaultCursor)
  }, [defaultCursor])

  // Center the active week (today / latest activity) in view on mount + year change.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const offset = dayDiff(gridStart, parseDayKey(defaultCursor))
    const x = Math.floor(offset / 7) * PITCH + 30 // +30 = weekday-label gutter
    el.scrollLeft = Math.max(0, x - el.clientWidth / 2)
    updateEdges()
  }, [defaultCursor, gridStart])

  const countByKey = model.countByKey
  const activeKey = hoverKey ?? (focused ? cursor : null)

  function move(nextDate: Date) {
    const jan1 = new Date(year, 0, 1)
    const dec31 = new Date(year, 11, 31)
    const clamped =
      nextDate < jan1 ? jan1 : startOfDay(nextDate) > dec31 ? dec31 : startOfDay(nextDate)
    const key = localDayKey(clamped)
    refMap.current.get(key)?.focus()
  }

  function onKeyDown(e: KeyboardEvent) {
    const cur = parseDayKey(cursor)
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        move(addDays(cur, -7))
        break
      case 'ArrowRight':
        e.preventDefault()
        move(addDays(cur, 7))
        break
      case 'ArrowUp':
        e.preventDefault()
        move(addDays(cur, -1))
        break
      case 'ArrowDown':
        e.preventDefault()
        move(addDays(cur, 1))
        break
      case 'Home':
        e.preventDefault()
        move(startOfWeekMonday(cur))
        break
      case 'End':
        e.preventDefault()
        move(addDays(startOfWeekMonday(cur), 6))
        break
      case 'PageUp':
        e.preventDefault()
        if (year - 1 >= minYear) onYearChange(-1)
        break
      case 'PageDown':
        e.preventDefault()
        onYearChange(1)
        break
      default:
        return
    }
    // A keyboard move just happened: drop any stale hover so the focused day's
    // tooltip wins. `onMouseLeave` only fires on real pointer movement, so
    // without this the tooltip would keep showing the previously hovered cell
    // while the focus ring moved elsewhere (spec §4: the focused day's tooltip).
    setHoverKey(null)
  }

  // Tooltip position from the active cell's grid coordinates (pixel-exact).
  const tip = activeKey ? tipFor(activeKey) : null
  function tipFor(key: string) {
    const offset = dayDiff(gridStart, parseDayKey(key))
    const w = Math.floor(offset / 7)
    const d = ((offset % 7) + 7) % 7
    const count = countByKey.get(key) ?? 0
    // The scroller uses overflow-x:auto, which per the CSS overflow spec forces
    // overflow-y to compute to `auto` too — so a tooltip popped ABOVE a top-row
    // cell gets its top edge clipped. The top two rows (Lun/Mar) have no room
    // above the month-label band, so flip their tooltip to render below the cell.
    const below = d <= 1
    return { left: w * PITCH + CELL / 2, top: d * PITCH, count, key, below }
  }

  return (
    <div>
      <div className="relative">
        <div ref={scrollerRef} onScroll={updateEdges} className="overflow-x-auto pb-1">
          <div className="inline-flex flex-col gap-1">
            {/* Month labels */}
            <div className="flex" style={{ marginLeft: 30 }}>
              <div className="relative" style={{ height: 14, width: weeks.length * PITCH }}>
                {monthLabels.map((ml) => (
                  <span
                    key={`${ml.label}-${ml.week}`}
                    className="absolute font-mono text-2xs text-text-faint"
                    style={{ left: ml.week * PITCH }}
                  >
                    {ml.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex gap-1.5">
              {/* Weekday labels */}
              <div className="flex flex-col" style={{ gap: GAP, width: 24 }}>
                {WEEKDAYS.map((w, i) => (
                  <span
                    key={i}
                    className="font-mono text-2xs leading-none text-text-faint"
                    style={{ height: CELL, lineHeight: `${CELL}px` }}
                  >
                    {w}
                  </span>
                ))}
              </div>

              {/* Cell grid */}
              <div
                role="grid"
                aria-label={`Activité ${year}`}
                onKeyDown={onKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                className="relative flex"
                style={{ gap: GAP }}
              >
                {weeks.map((week, wi) => (
                  <div key={wi} role="row" className="flex flex-col" style={{ gap: GAP }}>
                    {week.map((cell) =>
                      cell.inYear ? (
                        <button
                          key={cell.key}
                          ref={(el) => {
                            if (el) refMap.current.set(cell.key, el)
                            else refMap.current.delete(cell.key)
                          }}
                          type="button"
                          role="gridcell"
                          tabIndex={cell.key === cursor ? 0 : -1}
                          aria-label={ariaLabel(cell.count, cell.key)}
                          onFocus={() => setCursor(cell.key)}
                          onMouseEnter={() => setHoverKey(cell.key)}
                          onMouseLeave={() => setHoverKey((k) => (k === cell.key ? null : k))}
                          className={cn(
                            'rounded-xs transition-[filter] duration-fast hover:brightness-125',
                            HEAT_BG_CLASS[heatLevel(cell.count)],
                          )}
                          style={{ width: CELL, height: CELL }}
                        />
                      ) : (
                        <span key={cell.key} style={{ width: CELL, height: CELL }} aria-hidden />
                      ),
                    )}
                  </div>
                ))}

                {tip && (
                  <div
                    className={cn(
                      'pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-3 px-2 py-1 shadow-md',
                      tip.below ? 'translate-y-0' : '-translate-y-full',
                    )}
                    style={{ left: tip.left, top: tip.below ? tip.top + CELL + 6 : tip.top - 6 }}
                  >
                    {/* Count only: the shipped `heatmapResponseSchema` (packages/shared,
                      the sole source of API types) carries `count` per day but no
                      `studyMs`, so the spec §4 "X reviews · Y min" format isn't
                      available here. The twin HeatmapTable is the exhaustive channel. */}
                    <div className="font-mono text-xs tabular-nums text-text">
                      {tip.count} review{tip.count > 1 ? 's' : ''}
                    </div>
                    <div className="font-mono text-2xs text-text-faint">
                      {formatLongDay(tip.key)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Edge fades signalling horizontal scroll (fix-mobile-shell §heatmap). */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface-2 to-transparent transition-opacity duration-fast',
            edges.left ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface-2 to-transparent transition-opacity duration-fast',
            edges.right ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>

      {data.total === 0 && (
        <p className="mt-3 text-sm text-text-muted">Aucune activité en {year}.</p>
      )}
    </div>
  )
}

function ariaLabel(count: number, key: string): string {
  const day = formatLongDay(key)
  if (count === 0) return `Aucune review le ${day}`
  return `${count} review${count > 1 ? 's' : ''} le ${day}`
}

interface GridModel {
  weeks: Cell[][]
  monthLabels: { week: number; label: string }[]
  gridStart: Date
  countByKey: Map<string, number>
}

/** Lay the dense year feed out as [week][weekday] cells, Monday-first. */
function buildGrid(data: HeatmapResponse, year: number): GridModel {
  const countByKey = new Map<string, number>()
  for (const d of data.days) countByKey.set(d.date, d.count)

  const jan1 = new Date(year, 0, 1)
  const dec31 = new Date(year, 11, 31)
  const gridStart = startOfWeekMonday(jan1)
  const numWeeks = Math.ceil((dayDiff(gridStart, dec31) + 1) / 7)

  const weeks: Cell[][] = []
  const monthLabels: { week: number; label: string }[] = []
  let lastMonth = -1

  for (let w = 0; w < numWeeks; w++) {
    const week: Cell[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(gridStart, w * 7 + d)
      const inYear = date.getFullYear() === year
      const key = localDayKey(date)
      week.push({ key, date, inYear, count: countByKey.get(key) ?? 0 })
    }
    // Month label from the first in-year day of this column.
    const firstInYear = week.find((c) => c.inYear)
    if (firstInYear) {
      const m = firstInYear.date.getMonth()
      if (m !== lastMonth) {
        monthLabels.push({
          week: w,
          label: firstInYear.date.toLocaleDateString('fr-FR', { month: 'short' }),
        })
        lastMonth = m
      }
    }
    weeks.push(week)
  }

  return { weeks, monthLabels, gridStart, countByKey }
}
