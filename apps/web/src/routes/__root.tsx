import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext } from '@tanstack/react-router'
import { AppShell } from '@/components/shell/app-shell'

/** Typed router context (spec §1.1): the shared QueryClient. */
export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
})
