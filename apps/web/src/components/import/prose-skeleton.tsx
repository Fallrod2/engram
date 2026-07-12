import { Skeleton } from '@/components/ui/skeleton'

/** Decreasing-width prose skeleton for extracted text (spec §1.6). */
export function ProseSkeleton({ lines = 7 }: { lines?: number }) {
  const widths = ['w-1/3', 'w-11/12', 'w-full', 'w-5/6', 'w-full', 'w-3/4', 'w-2/3', 'w-4/5']
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${widths[i % widths.length]}`} />
      ))}
    </div>
  )
}
