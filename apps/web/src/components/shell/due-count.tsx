import { cn } from '@/lib/utils'
import type { SubjectColor } from './nav'

const BAR_BG: Record<SubjectColor, string> = {
  1: 'bg-subject-1',
  2: 'bg-subject-2',
  3: 'bg-subject-3',
  4: 'bg-subject-4',
  5: 'bg-subject-5',
  6: 'bg-subject-6',
  7: 'bg-subject-7',
  8: 'bg-subject-8',
}

/**
 * Due count as "pressure", not alert (spec §6, detail 1).
 * Intensity encodes urgency via typographic weight, never color:
 *   0 → retreating `·` (text-faint)
 *   1–20 → text-muted
 *   21–50 → text (primary)
 *   >50  → text + a 2px subject-tinted load bar under the number.
 * Never red — red is reserved for danger/Again.
 */
export function DueCount({
  count,
  subject,
  className,
}: {
  count: number
  subject?: SubjectColor | undefined
  className?: string
}) {
  if (count <= 0) {
    return (
      <span
        className={cn('font-mono text-xs text-text-faint tabular-nums', className)}
        aria-label="0 à réviser"
      >
        ·
      </span>
    )
  }

  const tone = count <= 20 ? 'text-text-muted' : 'text-text'
  const showBar = count > 50
  // Bar width scales with backlog, capped; 50→~40%, 200+→100%.
  const barWidth = Math.min(100, Math.round((count / 200) * 100))

  return (
    <span className={cn('inline-flex flex-col items-end gap-0.5', className)}>
      <span className={cn('font-mono text-xs tabular-nums', tone)}>{count}</span>
      {showBar && subject ? (
        <span className="h-0.5 w-8 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <span className={cn('block h-full', BAR_BG[subject])} style={{ width: `${barWidth}%` }} />
        </span>
      ) : null}
    </span>
  )
}
