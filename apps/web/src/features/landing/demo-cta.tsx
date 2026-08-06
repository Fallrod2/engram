import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { fetchHealth } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { AUTH_ENABLED_WEB } from '@/lib/supabase'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DemoBootWindow } from './demo-boot-window'
import { useDemoBoot } from './use-demo-boot'

/**
 * Is there a demo to offer, right now?
 *
 * AVAILABILITY IS LEARNED AT RUNTIME, not at build time. `GET /api/health` is
 * public and reports `demoLoginEnabled` — the exact predicate the server route
 * uses. So Alex can turn the demo on by setting the env vars on Vercel, with NO
 * front-end redeploy. Nothing about the demo is baked into the bundle: the
 * account's password lives on the server only and has no `VITE_` twin.
 * `AUTH_ENABLED_WEB` is part of the condition because without a Supabase client
 * there is nowhere to put the session (local dev / e2e, where the whole auth flow
 * is off anyway).
 *
 * Exported because a host sometimes has to decide more than "render the button":
 * `/login` also owns a separator above it, and a separator hanging over nothing
 * is worse than no demo at all. Every caller shares the one `qk.health` query, so
 * asking twice costs no second request and the two answers can never disagree.
 */
export type DemoAvailability = 'probing' | 'available' | 'unavailable'

export function useDemoAvailability(): DemoAvailability {
  const health = useQuery({
    queryKey: qk.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    // One shot: a server that cannot answer its own health probe is not going to
    // serve a demo session either, and the page must never retry-storm.
    retry: false,
    staleTime: 5 * 60_000,
  })
  if (!AUTH_ENABLED_WEB) return 'unavailable'
  if (health.isPending) return 'probing'
  return health.data?.demoLoginEnabled ? 'available' : 'unavailable'
}

/**
 * "Try the demo" CTA (landing spec §2). Beyond the availability rule above:
 *
 *  · IT NEVER SENDS CREDENTIALS. `POST /api/demo/session` takes no input; the
 *    server signs in with its own env credentials and hands back a token pair,
 *    which we install with `supabase.auth.setSession`.
 *  · WHILE THE PROBE IS IN FLIGHT the button's footprint is held with a skeleton
 *    rather than popping the CTA in (or spinning): the layout must not reflow
 *    under the reader. Probe failed, or no demo → nothing is rendered at all.
 *  · THE WAIT IS OWNED BY `useDemoBoot`: open a session, wait for the server to
 *    finish seeding, and only THEN sign the browser in — that order is what keeps
 *    the host page (and the boot window) mounted, because `routes/index.tsx` swaps
 *    the landing for the dashboard as soon as the auth status flips. Past 500 ms a
 *    window appears saying which step is running; see `use-demo-boot.ts` for why
 *    500 ms and why it is often never shown at all. A boot that never crosses that
 *    threshold behaves EXACTLY as before: a pending button, then the app.
 *
 * It lives in its own file since T-034, when the demo stopped being a landing-page
 * ornament: `/login` needs it too. Signing out used to land on a screen offering
 * an account you may not have and nothing else — a dead end for exactly the
 * visitor the demo exists for. One component means one availability rule; a second
 * button deciding for itself when to appear would drift the day the env vars move.
 */
export function DemoCta({
  onFailedChange,
  size = 'lg',
  className,
  skeletonClassName = 'h-9 w-36',
}: {
  /** Told when the boot failed, so the host can render the message where it fits. */
  onFailedChange?: (failed: boolean) => void
  size?: 'sm' | 'default' | 'lg'
  /** Applied to the button — `/login` stacks it full width, the landing does not. */
  className?: string
  /** Footprint held while the health probe is in flight; matches the button. */
  skeletonClassName?: string
}) {
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const availability = useDemoAvailability()

  const boot = useDemoBoot({
    onEnter: () => void navigate({ to: '/' }),
    onFailedChange: onFailedChange ?? noop,
    // The boot already paid for `GET /api/me`; hand it to the cache so the app
    // shell does not immediately ask again.
    onPrimed: (me) => qc.setQueryData(qk.me, me),
  })
  // Deliberately stays true through `ready`: the host is about to unmount and the
  // button must not become clickable again in between.
  const pending = boot.state.phase === 'working' || boot.state.phase === 'ready'

  if (availability === 'probing') {
    return (
      <Skeleton
        role="status"
        aria-label={t('landing.hero.demoCtaLoading')}
        className={cn('rounded-sm', skeletonClassName)}
      />
    )
  }
  if (availability === 'unavailable') return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={className}
        disabled={pending}
        onClick={boot.start}
      >
        {pending ? t('landing.hero.demoCtaPending') : t('landing.hero.demoCta')}
      </Button>
      <DemoBootWindow
        open={boot.windowOpen}
        state={boot.state}
        onRetry={boot.retry}
        onDismiss={boot.dismiss}
        onEnterAnyway={boot.enterAnyway}
      />
    </>
  )
}

/** Stable identity: `useDemoBoot` mirrors its callbacks into a ref every render. */
function noop(): void {}
