import { Skeleton } from '@/components/ui/skeleton'

/** One dense list row skeleton (dot + name bar + trailing count bars). */
function RowSkeleton() {
  return (
    <div className="flex h-11 items-center gap-3 px-3">
      <Skeleton className="size-2 rounded-full" />
      <Skeleton className="h-3 w-40" />
      <div className="ml-auto flex items-center gap-6">
        <Skeleton className="h-2.5 w-6" />
        <Skeleton className="h-2.5 w-8" />
      </div>
    </div>
  )
}

/** Subjects screen skeleton (spec §1.6). */
export function SubjectsSkeleton() {
  return (
    <div className="flex flex-col gap-1" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <RowSkeleton key={i} />
      ))}
    </div>
  )
}

/** Decks screen skeleton: subject header + rows. */
export function DecksSkeleton() {
  return (
    <div aria-hidden>
      <div className="mb-6 flex items-center gap-2">
        <Skeleton className="size-2 rounded-full" />
        <Skeleton className="h-6 w-48" />
      </div>
      <div className="flex flex-col gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

/** Cards screen table skeleton (composer stays interactive above it). */
export function CardsTableSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-1.5">
          <Skeleton className="size-2 rounded-xs" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="ml-auto h-2.5 w-12" />
        </div>
      ))}
    </div>
  )
}
