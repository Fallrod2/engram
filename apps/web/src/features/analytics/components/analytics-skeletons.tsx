import { Skeleton } from '@/components/ui/skeleton'

/**
 * One skeleton per section (spec §1.7) — never a spinner. A warm cache renders
 * nothing here; a window change holds the previous frame (ChartCard), so these
 * only show on the very first, cold load.
 */

export function StatTilesSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-md bg-surface-2 px-4 py-3">
          <Skeleton className="h-3 w-16 bg-surface-3" />
          <Skeleton className="mt-3 h-7 w-24 bg-surface-3" />
          <Skeleton className="mt-3 h-3 w-20 bg-surface-3" />
        </div>
      ))}
    </div>
  )
}

export function HeatmapSkeleton() {
  return (
    <div className="rounded-md bg-surface-2 p-4">
      <Skeleton className="h-5 w-24 bg-surface-3" />
      <div className="mt-4 overflow-hidden">
        <div className="flex gap-[3px]">
          {Array.from({ length: 40 }).map((_, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {Array.from({ length: 7 }).map((__, d) => (
                <Skeleton key={d} className="size-[11px] rounded-xs bg-surface-3" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** A chart card placeholder whose height INCLUDES the axis band (no scroll). */
export function ChartCardSkeleton({ height = 264 }: { height?: number }) {
  return (
    <div className="rounded-md bg-surface-2 p-4">
      <Skeleton className="h-5 w-32 bg-surface-3" />
      <Skeleton className="mt-4 w-full bg-surface-3" style={{ height }} />
    </div>
  )
}

export function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <StatTilesSkeleton />
      <HeatmapSkeleton />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
      <ChartCardSkeleton height={200} />
    </div>
  )
}
