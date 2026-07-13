import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, redirect, Outlet } from '@tanstack/react-router'
import { AppShell } from '@/components/shell/app-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'
import { requireAuth, type AuthStore } from '@/lib/auth-store'

/** Typed router context (spec §1.1/§3.4): the shared QueryClient + auth store. */
export interface RouterContext {
  queryClient: QueryClient
  auth: AuthStore
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ location, context }) => {
    // Resolve the initial hydration FIRST (audit §3) so the store is never read
    // while `loading` — this avoids bouncing an already-signed-in user to /login
    // on a hard refresh, and avoids a flash of protected content. `/login` is
    // exempt inside `requireAuth` (anti-loop, audit §8).
    await context.auth.ready
    const redirectTo = requireAuth({
      auth: context.auth,
      pathname: location.pathname,
      href: location.href,
    })
    if (redirectTo) throw redirect(redirectTo)
  },
  component: RootLayout,
})

/** Centered skeleton while the initial session resolves (no full-screen spinner). */
function AuthSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <div className="flex w-full max-w-sm flex-col gap-3 px-4" aria-hidden>
        <Skeleton className="mx-auto h-6 w-24" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  )
}

function RootLayout() {
  const { status } = useAuth()
  if (status === 'loading') return <AuthSplash />
  if (status === 'unauthenticated') return <Outlet /> // /login renders bare
  return <AppShell /> // AppShell already contains its own <Outlet/>
}
