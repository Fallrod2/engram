import { createFileRoute, redirect, useNavigate, Link } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { useAuthLink } from '@/lib/auth'
import { authStore } from '@/lib/auth-store'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SetPasswordForm } from '@/features/auth/set-password-form'

/**
 * Set-password screen (invite/recovery onboarding) — rendered OUTSIDE the app
 * shell (RootLayout shows a bare `<Outlet/>` while a link flow is active), same
 * visual family as `/login`. Reached only through an email link: the root guard
 * redirects a pending flow here; a direct visit with no active flow bounces home
 * or to /login.
 */
export const Route = createFileRoute('/set-password')({
  beforeLoad: async ({ context }) => {
    await context.auth.ready
    const linkState = context.auth.getLinkState()
    if (linkState.kind === 'none') {
      // No invite/recovery flow in progress: this screen is not meant to be
      // visited directly. Send a signed-in user home, everyone else to /login.
      throw redirect({
        to: context.auth.getState().status === 'authenticated' ? '/' : '/login',
      })
    }
  },
  component: SetPasswordPage,
})

function Shell({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span
            className="flex size-6 items-center justify-center rounded-sm bg-accent text-accent-fg"
            aria-hidden
          >
            <span className="text-2xs">◆</span>
          </span>
          <span className="text-sm font-semibold tracking-[-0.01em] text-text">
            {t('auth.title')}
          </span>
        </div>
        <Card>{children}</Card>
      </div>
    </div>
  )
}

function SetPasswordPage() {
  const t = useT()
  const navigate = useNavigate()
  const linkState = useAuthLink()

  // The link flow just ended (password set, or the user is escaping the expired
  // screen): the store cleared `linkState` and a navigation is already in flight.
  // Render nothing rather than flashing the raw set-password form for a frame.
  if (linkState.kind === 'none') return null

  if (linkState.kind === 'error') {
    return (
      <Shell>
        <CardHeader>
          <h1 className="text-lg font-semibold tracking-[-0.01em] text-text">
            {t('auth.link.expiredTitle')}
          </h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">{t('auth.link.expiredDesc')}</p>
          <Button asChild variant="outline" className="w-full">
            {/* Clear the terminal error state before navigating so the root guard
                does not immediately bounce us back here (dead-end). */}
            <Link to="/login" onClick={() => authStore.clearLinkState()}>
              {t('auth.link.backToLogin')}
            </Link>
          </Button>
        </CardContent>
      </Shell>
    )
  }

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
