import { Skeleton } from '@/components/ui/skeleton'

/**
 * Result rows while a page loads. Six rows of the real geometry (checkbox,
 * glyph, front, deck, due) so the list does not jump when the answer lands —
 * a skeleton whose shape is wrong is just a fancier spinner.
 */
export function SearchResultsSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col" role="status" aria-busy="true" aria-label={label}>
      {['w-3/5', 'w-2/5', 'w-1/2', 'w-4/6', 'w-1/3', 'w-2/4'].map((w) => (
        <div key={w} className="flex h-11 items-center gap-3 border-b border-border px-2">
          <Skeleton className="size-4 shrink-0 rounded-xs" />
          <Skeleton className="size-2 shrink-0 rounded-xs" />
          <Skeleton className={`h-3 ${w}`} />
          <Skeleton className="ml-auto h-2.5 w-24" />
          <Skeleton className="h-2.5 w-10" />
        </div>
      ))}
    </div>
  )
}
