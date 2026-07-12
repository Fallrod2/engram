import { HEAT_BG_CLASS, HEAT_LEVELS } from '../heat-scale'
import { cn } from '@/lib/utils'

/**
 * `Moins ▢▢▢▢▢ Plus` — the five sequential steps (spec §4). Shares the exact
 * `HEAT_BG_CLASS` ramp with the grid cells, so legend and data can never drift.
 */
export function HeatmapLegend() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-2xs text-text-faint">Moins</span>
      <div className="flex gap-[3px]">
        {HEAT_LEVELS.map((lvl) => (
          <span
            key={lvl}
            aria-hidden
            className={cn('size-[11px] rounded-xs', HEAT_BG_CLASS[lvl])}
          />
        ))}
      </div>
      <span className="text-2xs text-text-faint">Plus</span>
    </div>
  )
}
