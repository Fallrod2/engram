import { weekdayAbbrevs } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Cold-cache calendar skeleton (spec §5.1): the day-header chrome is real and
 * immediate; only the cells and the right rail shimmer. Never a full-screen
 * spinner. Warm cache re-renders skip this entirely.
 */
export function PlanningGridSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-border">
      <div className="grid grid-cols-7 bg-bg">
        {weekdayAbbrevs().map((label) => (
          <div
            key={label}
            className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {Array.from({ length: 42 }, (_, i) => (
          <div key={i} className="flex min-h-[104px] flex-col gap-2 bg-bg p-1.5">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="mt-1 h-0.5 w-8" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function DayDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-6 w-24" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-6" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExamListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="size-2 rounded-full" />
        </div>
      ))}
    </div>
  )
}
