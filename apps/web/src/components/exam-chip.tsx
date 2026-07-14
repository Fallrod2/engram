import { GraduationCap } from 'lucide-react'
import type { Subject } from '@engram/shared'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SubjectDot } from '@/components/subject-dot'
import { Countdown } from '@/components/countdown'

const MAX_DOTS = 3

/**
 * A neutral exam pin (spec §1.8): `surface-2` + hairline, a `GraduationCap`
 * glyph, up to 3 `SubjectDot`s (then `+k`) and a truncated title. Never a rating
 * tint, never the accent. Hover (tooltip) reveals the full title, subjects and
 * `<Countdown>`.
 */
export function ExamChip({
  title,
  subjectIds,
  dateIso,
  subjectsById,
  compact = false,
  now,
  className,
}: {
  title: string
  subjectIds: string[]
  dateIso?: string
  subjectsById: Map<string, Subject>
  compact?: boolean
  now?: Date
  className?: string
}) {
  const subjects = subjectIds.map((id) => subjectsById.get(id)).filter((s): s is Subject => !!s)
  const shownDots = subjects.slice(0, MAX_DOTS)
  const overflow = subjects.length - shownDots.length

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'flex w-full items-center gap-1 rounded-xs border border-border bg-surface-2 px-1.5',
            compact ? 'py-0.5' : 'py-1',
            className,
          )}
        >
          <GraduationCap className="size-3 shrink-0 text-text-muted" strokeWidth={1.75} />
          {/* In the dense month grid (`compact`), the subject dots ate the width
              that the title needs, leaving "Pa…"/"Th…" at ≤1024px. Drop them there
              — the glyph already reads "exam" and the tooltip still lists subjects
              (fix-mobile-shell §load-legend). */}
          {!compact &&
            shownDots.map((s) => (
              <SubjectDot key={s.id} color={s.color} className="size-1.5" muted={s.archived} />
            ))}
          {!compact && overflow > 0 && (
            <span className="font-mono text-2xs tabular-nums text-text-faint">+{overflow}</span>
          )}
          <span className="truncate text-2xs text-text">{title}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-56">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text">{title}</span>
          {subjects.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {subjects.map((s) => (
                <span key={s.id} className="flex items-center gap-1 text-2xs text-text-muted">
                  <SubjectDot color={s.color} className="size-1.5" />
                  {s.name}
                </span>
              ))}
            </div>
          )}
          {dateIso && <Countdown dateIso={dateIso} {...(now ? { now } : {})} />}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
