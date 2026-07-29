import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  redirect,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import { AppShell } from '@/components/shell/app-shell'
import { NotFoundScreen } from '@/components/not-found'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth, useAuthLink } from '@/lib/auth'
import { linkRedirect, requireAuth, type AuthStore } from '@/lib/auth-store'
import {
  hasOfferedOnboarding,
  isOnboardingExempt,
  markOnboardingOffered,
} from '@/features/onboarding/gate'
import { onboardingStatusOptions } from '@/features/onboarding/queries'

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
    // An invite/recovery email link takes priority: force the bare set-password
    // screen before the normal auth check (which exempts /set-password).
    const toLink = linkRedirect({
      pathname: location.pathname,
      linkState: context.auth.getLinkState(),
    })
    if (toLink) throw redirect(toLink)
    const redirectTo = requireAuth({
      auth: context.auth,
      pathname: location.pathname,
      href: location.href,
    })
    if (redirectTo) throw redirect(redirectTo)
    if (await shouldOfferOnboarding(context, location.pathname)) {
      throw redirect({ to: '/onboarding' })
    }
  },
  component: RootLayout,
  // Unmatched URL (T-028 b). Without this the router falls back to its built-in
  // bare `Not Found` string: untranslated, unstyled and with no way back.
  notFoundComponent: NotFoundScreen,
})

/**
 * Should THIS navigation be diverted into the first-run journey (T-049)?
 *
 * The four guards, cheapest first, and none of them optional:
 *
 *  1. once per page load. The latch means a marker that failed to save is a
 *     nuisance, never a trap — see `features/onboarding/gate.ts`.
 *  2. not on a screen that owns itself (`/login`, `/set-password`, the journey
 *     itself…), which is what `isOnboardingExempt` lists.
 *  3. only for a signed-in caller. A signed-out visitor gets the landing, and
 *     firing `/api/onboarding` for them would 401 → forceSignOut → the landing
 *     would never render (same trap the `/` loader documents).
 *  4. the server says the account is new. `ensureQueryData` with an infinite
 *     `staleTime` means ONE request per page load, not one per navigation.
 *
 * A FAILED PROBE NEVER DIVERTS ANYONE. The catch is deliberate and total: the
 * journey is a nicety, the app is not. A server hiccup must not stand between a
 * user and their cards, so an unresolved status reads as "do not offer".
 */
async function shouldOfferOnboarding(context: RouterContext, pathname: string): Promise<boolean> {
  if (hasOfferedOnboarding()) return false
  if (isOnboardingExempt(pathname)) return false
  if (context.auth.getState().status !== 'authenticated') return false
  const status = await context.queryClient
    .ensureQueryData(onboardingStatusOptions())
    .catch(() => null)
  // Latch HERE, on the resolution and not on the redirect: the decision has been
  // made for this page load whatever it was. Latching only on the redirect would
  // leave a FAILED probe unlatched, and since the query carries no data and does
  // not retry, every subsequent navigation would fire the request again.
  markOnboardingOffered()
  return status?.pending === true
}

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
  const linkState = useAuthLink()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (status === 'loading') return <AuthSplash />
  // During an invite/recovery flow the set-password screen renders bare (outside
  // the shell) even though the recovery session makes `status` authenticated.
  if (linkState.kind !== 'none') return <Outlet />
  // `/welcome` always renders the landing bare (no shell), even in dev/e2e where
  // auth is forced `authenticated` — it's the route to develop/verify the public
  // landing locally (landing spec §1). Placed AFTER the link branch to preserve
  // the invite/recovery flow.
  if (pathname === '/welcome') return <Outlet />
  // The suspended screen renders bare (outside the shell) even though the user is
  // authenticated — the shell's data queries would just 403 `suspended` (A3).
  if (pathname === '/suspended') return <Outlet />
  // The first-run journey renders bare too (T-049): it is a full-screen guided
  // pass over settings, and mounting the shell behind it would fan out every
  // sidebar query for an account that has, by definition, nothing in it yet.
  if (pathname === '/onboarding') return <Outlet />
  if (status === 'unauthenticated') return <Outlet /> // /login and `/` landing render bare
  return <AppShell /> // AppShell already contains its own <Outlet/>
}
