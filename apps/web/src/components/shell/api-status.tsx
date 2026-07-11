import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { fetchHealth } from '@/lib/api'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Sober API-health indicator for the sidebar footer. Polls `/api/health` via
 * TanStack Query and validates against the shared Zod schema (see lib/api).
 */
export function ApiStatus({ collapsed = false }: { collapsed?: boolean }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const state: 'ok' | 'down' | 'checking' = isPending ? 'checking' : isError ? 'down' : 'ok'

  const dotTone =
    state === 'ok' ? 'bg-success' : state === 'down' ? 'bg-danger' : 'bg-text-faint animate-pulse'

  const label =
    state === 'ok'
      ? `API en ligne · ${data?.service ?? 'engram-server'}`
      : state === 'down'
        ? 'API injoignable'
        : 'Vérification…'

  const dot = <span className={cn('size-1.5 shrink-0 rounded-full', dotTone)} aria-hidden />

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex h-6 items-center justify-center" role="status" aria-label={label}>
            {dot}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex items-center gap-2" role="status" aria-label={label}>
      {dot}
      <span className="truncate text-2xs text-text-faint">{label}</span>
    </div>
  )
}
