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

/** Import screen skeleton (spec §1.6): two ghost subject groups of rows. */
export function ImportSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g}>
          <div className="mb-2 flex items-center gap-2 px-3">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-2.5 w-32" />
          </div>
          <div className="flex flex-col gap-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex h-11 items-center gap-3 px-3">
                <Skeleton className="h-4 w-8 rounded-xs" />
                <Skeleton className="h-3 w-48" />
                <Skeleton className="ml-auto h-2.5 w-24" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Note detail skeleton (spec §1.6): launch panel + prose. */
export function NoteSkeleton() {
  return (
    <div aria-hidden>
      <div className="mb-6 flex items-center gap-2">
        <Skeleton className="size-2 rounded-full" />
        <Skeleton className="h-6 w-64" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-sm" />
          <Skeleton className="h-8 w-28 self-end rounded-sm" />
        </div>
        <div className="flex flex-col gap-3">
          {['w-1/3', 'w-11/12', 'w-full', 'w-5/6', 'w-full', 'w-2/3'].map((w, i) => (
            <Skeleton key={i} className={`h-3 ${w}`} />
          ))}
        </div>
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
