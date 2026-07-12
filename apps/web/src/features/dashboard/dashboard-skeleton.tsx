import { Skeleton } from '@/components/ui/skeleton'

/**
 * Dashboard loading state (spec §5.4). Blocks sit at their FINAL heights so the
 * settle produces zero layout shift.
 */
export function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Skeleton className="h-[220px] rounded-lg lg:col-span-8" />
      <div className="flex flex-col gap-4 lg:col-span-4">
        <Skeleton className="h-[120px] rounded-lg" />
        <Skeleton className="h-[140px] rounded-lg" />
      </div>
      <Skeleton className="h-[92px] rounded-lg lg:col-span-12" />
    </div>
  )
}
