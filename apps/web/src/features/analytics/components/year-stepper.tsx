import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Calendar navigation for the heatmap (spec §1.5) — NOT a data filter. `next`
 * caps at the current year; `prev` is bounded by `minYear`.
 */
export function YearStepper({
  year,
  minYear,
  maxYear,
  onChange,
}: {
  year: number
  minYear: number
  maxYear: number
  onChange: (year: number) => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-text-muted"
        aria-label="Année précédente"
        disabled={year <= minYear}
        onClick={() => onChange(year - 1)}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-12 text-center font-mono text-sm tabular-nums text-text">{year}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-text-muted"
        aria-label="Année suivante"
        disabled={year >= maxYear}
        onClick={() => onChange(year + 1)}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
