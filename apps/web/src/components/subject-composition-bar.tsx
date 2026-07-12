import { cn } from '@/lib/utils'
import { SUBJECT_BG_CLASS, pigmentSlotForHex } from '@/lib/pigments'

export interface CompositionSegment {
  subjectId: string
  count: number
  /** Stored subject hex — resolves to a themeable pigment slot. */
  colorHex: string
}

/**
 * Part-to-whole composition of a day's load by subject (spec §7.2, dataviz).
 *
 * A pocketed horizontal bar: each segment width ∝ its count, tinted by the
 * subject's pigment (order FROZEN by pigment slot so a subject keeps its color
 * when the set changes), separated by a 2px SURFACE gap (never a stroke). The
 * text/counters live in the legend in text tokens — identity comes from the
 * segment + `SubjectDot`, never color-only.
 */
export function SubjectCompositionBar({
  segments,
  className,
}: {
  segments: CompositionSegment[]
  className?: string
}) {
  const positive = segments.filter((s) => s.count > 0)
  const total = positive.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return null

  // Frozen categorical order: by pigment slot (non-canonical hues sort last).
  const ordered = [...positive].sort(
    (a, b) => (pigmentSlotForHex(a.colorHex) ?? 99) - (pigmentSlotForHex(b.colorHex) ?? 99),
  )

  return (
    <div className={cn('flex h-2 w-full gap-0.5 overflow-hidden rounded-full', className)}>
      {ordered.map((s) => {
        const slot = pigmentSlotForHex(s.colorHex)
        return (
          <span
            key={s.subjectId}
            className={cn(
              'block h-full first:rounded-l-full last:rounded-r-full',
              slot && SUBJECT_BG_CLASS[slot],
            )}
            style={{
              width: `${(s.count / total) * 100}%`,
              ...(slot ? {} : { background: s.colorHex }),
            }}
            aria-hidden
          />
        )
      })}
    </div>
  )
}
