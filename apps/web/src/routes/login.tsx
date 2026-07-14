import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { useT } from '@/lib/i18n'
import { sanitizeRedirect } from '@/lib/auth-store'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { AuthBrand } from '@/features/auth/auth-brand'
import { LoginForm } from '@/features/auth/login-form'

/**
 * Login screen (spec §3.4) — rendered OUTSIDE the app shell (RootLayout shows a
 * bare `<Outlet/>` when unauthenticated). Sobre / Precision-Linear, dark by
 * default. `beforeLoad` bounces an already-signed-in user to their target.
 */
export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ context, search }) => {
    await context.auth.ready
    if (context.auth.getState().status === 'authenticated') {
      // Sanitize first: `href` is clamped to a same-origin relative path, so this
      // can never navigate to an attacker-supplied cross-origin URL (CWE-601).
      throw redirect({ href: sanitizeRedirect(search.redirect) })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const t = useT()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <AuthBrand />
        <Card>
          <CardHeader>
            <h1 className="text-lg font-semibold tracking-[-0.01em] text-text">
              {t('auth.subtitle')}
            </h1>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
