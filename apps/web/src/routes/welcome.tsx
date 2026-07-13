import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

/**
 * `/welcome` (landing spec §1) — renders the public landing UNCONDITIONALLY,
 * even in dev/e2e where auth is forced `authenticated` and `/` shows the
 * dashboard. This is the route to develop and verify the landing locally, and
 * the durable home for it. `RootLayout` renders it bare (no app shell), and
 * `requireAuth` exempts it so an anonymous deep-link is never bounced to /login.
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
