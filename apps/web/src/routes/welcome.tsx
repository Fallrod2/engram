import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

/**
 * `/welcome` (landing spec §1) — renders the public landing UNCONDITIONALLY,
 * even in dev/e2e where auth is forced `authenticated` and `/` shows the
 * dashboard. This is the route to develop and verify the landing locally, and
 * the durable home for it. `RootLayout` renders it bare (no app shell), and
 * `requireAuth` exempts it so an anonymous deep-link is never bounced to /login.
 *
 * It is also the DURABLE WAY BACK to the landing for a signed-in user: `/` turns
 * into the dashboard once authenticated, so without this route the product's own
 * presentation page would be unreachable to anyone with an account. It is linked
 * from Réglages → À propos and from ⌘K.
 *
 * Note when developing the landing locally: with web auth disabled (the local
 * default) the store reports `authenticated`, so the page shows its signed-in
 * CTAs ("Ouvrir l'app") instead of "Se connecter / Créer un compte". The
 * anonymous variant is covered by `landing-page.test.tsx` and by
 * `e2e/tests-auth/landing.spec.ts`, which builds with a real Supabase URL.
 *
 * Same dynamic import as `routes/index.tsx`, so Vite dedupes it into ONE shared
 * async chunk (landing spec §5.4) — the landing never touches the entry bundle.
 */
const LandingPage = lazy(() => import('@/features/landing/landing-page'))

export const Route = createFileRoute('/welcome')({
  component: WelcomeRoute,
})

function WelcomeRoute() {
  return (
    <Suspense fallback={null}>
      <LandingPage />
    </Suspense>
  )
}
