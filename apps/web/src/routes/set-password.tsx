import { createFileRoute, redirect, useNavigate, Link } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { useAuthLink } from '@/lib/auth'
import { authStore } from '@/lib/auth-store'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AuthBrand } from '@/features/auth/auth-brand'
import { SetPasswordForm } from '@/features/auth/set-password-form'

/**
 * Set-password screen (invite/recovery onboarding) — rendered OUTSIDE the app
 * shell (RootLayout shows a bare `<Outlet/>` while a link flow is active), same
 * visual family as `/login`. Reached through an email link: the root guard
 * redirects a pending flow here. A signed-in user visiting directly bounces home;
 * a token-less anonymous visit shows the "expired link" dead-end (with its escape
 * to /forgot-password) rather than a silent /login redirect (spec fix-auth-public,
 * MAJOR 1).
 */
export const Route = createFileRoute('/set-password')({
  beforeLoad: async ({ context }) => {
    await context.auth.ready
    const linkState = context.auth.getLinkState()
    if (linkState.kind === 'none') {
      // A signed-in user hitting this screen directly has nothing to set up.
      if (context.auth.getState().status === 'authenticated') {
        throw redirect({ to: '/' })
      }
      // Anonymous direct visit / an expired link whose token never reached the
      // store: DON'T bounce silently to /login — render the dead-end screen so the
      // user gets an escape to /forgot-password. `noToken` lets the component tell
      // this apart from the transient `none` seen while a finished flow navigates
      // away (which must render nothing, not the expired screen).
      return { noToken: true }
    }
    return { noToken: false }
  },
  component: SetPasswordPage,
})

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <AuthBrand />
        <Card>{children}</Card>
      </div>
    </div>
  )
}

function SetPasswordPage() {
  const t = useT()
  const navigate = useNavigate()
  const linkState = useAuthLink()
  const { noToken } = Route.useRouteContext()

  // Terminal dead-end: an expired/used link, OR a token-less direct visit. Same
  // screen, same escape to /forgot-password — never a silent redirect.
  if (linkState.kind === 'error' || (noToken && linkState.kind === 'none')) {
    return (
      <Shell>
        <CardHeader>
          <h1 className="text-lg font-semibold tracking-[-0.01em] text-text">
            {t('auth.link.expiredTitle')}
          </h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">{t('auth.link.expiredDesc')}</p>
          {/* Primary escape from the account dead-end: request a fresh reset link.
              Clear the terminal error state before navigating so the root guard
              does not immediately bounce us back here. */}
          <Button asChild className="w-full">
            <Link to="/forgot-password" onClick={() => authStore.clearLinkState()}>
              {t('auth.link.resetLink')}
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login" onClick={() => authStore.clearLinkState()}>
              {t('auth.link.backToLogin')}
            </Link>
          </Button>
        </CardContent>
      </Shell>
    )
  }

  // The link flow just ended (password set, or the user is escaping the dead-end
  // screen): the store cleared `linkState` and a navigation is already in flight.
  // Render nothing rather than flashing the raw set-password form for a frame.
  if (linkState.kind === 'none') return null

  const recovery = linkState.kind === 'setup' && linkState.linkType === 'recovery'
  return (
    <Shell>
      <CardHeader>
        <h1 className="text-lg font-semibold tracking-[-0.01em] text-text">
          {recovery ? t('auth.setPassword.titleRecovery') : t('auth.setPassword.title')}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {recovery ? t('auth.setPassword.subtitleRecovery') : t('auth.setPassword.subtitle')}
        </p>
      </CardHeader>
      <CardContent>
        <SetPasswordForm
          onSuccess={() => {
            // Onboarding done: end the link flow and enter the app.
            authStore.clearLinkState()
            void navigate({ to: '/' })
          }}
        />
      </CardContent>
    </Shell>
  )
}
