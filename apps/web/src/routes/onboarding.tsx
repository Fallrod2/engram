import { createFileRoute } from '@tanstack/react-router'
import { OnboardingFlow } from '@/features/onboarding/onboarding-flow'
import { useDocumentTitle } from '@/lib/use-document-title'
import { useT } from '@/lib/i18n'

/**
 * `/onboarding` — the first-run journey (T-049).
 *
 * A REAL ROUTE, not an overlay on the dashboard, for three reasons: Settings
 * links back to it (« Mise en route → Revoir »), the back button behaves, and
 * the root layout can render it OUTSIDE the app shell — so the sidebar's data
 * queries do not fan out behind a screen the user has not asked anything of.
 *
 * No loader and no guard. The journey is reachable at any time by anyone signed
 * in; whether it is OFFERED automatically is a separate decision, taken once per
 * page load in the root `beforeLoad` from `GET /api/onboarding`.
 */
export const Route = createFileRoute('/onboarding')({
  component: OnboardingRoute,
})

function OnboardingRoute() {
  const t = useT()
  useDocumentTitle(t('onboarding.journey.title'))
  return <OnboardingFlow />
}
