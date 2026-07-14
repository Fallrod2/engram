import { useRef, type KeyboardEvent } from 'react'
import { ANALYTICS_WINDOWS, windowTabLabel, type AnalyticsWindow } from '../window'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * The single filter rank (spec §1.5): 30 j · 90 j · 12 mois · Tout, above the
 * content it scopes (tiles + windowed charts). A radiogroup — arrows move and
 * select in one step; the choice lives in the URL (`?window=`). The heatmap is
 * intentionally NOT scoped by this (it has its own year stepper).
 */
export function WindowFilter({
  value,
  onChange,
}: {
  value: AnalyticsWindow
  onChange: (w: AnalyticsWindow) => void
}) {
  const t = useT()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      next = (index + 1) % ANALYTICS_WINDOWS.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + ANALYTICS_WINDOWS.length) % ANALYTICS_WINDOWS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ANALYTICS_WINDOWS.length - 1
    if (next === null) return
    e.preventDefault()
    const w = ANALYTICS_WINDOWS[next]!
    onChange(w)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('analytics.windowAria')}
      className="inline-flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5"
    >
      {ANALYTICS_WINDOWS.map((w, i) => {
        const selected = w === value
        return (
          <button
            key={w}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(w)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'rounded-sm px-3 py-1 text-sm font-medium transition-colors duration-fast',
              selected ? 'bg-accent-subtle text-text' : 'text-text-muted hover:text-text',
            )}
          >
            {windowTabLabel(w)}
          </button>
        )
      })}
    </div>
  )
}
