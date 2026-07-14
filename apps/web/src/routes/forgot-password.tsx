import { useState } from 'react'
import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { useDocumentTitle } from '@/lib/use-document-title'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { AuthBrand } from '@/features/auth/auth-brand'
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form'

/**
 * "Forgot password" screen — the escape hatch out of the account dead-end (audit
 * MAJOR): reachable from `/login` and from the expired-link screen. Rendered
 * OUTSIDE the app shell, same visual family as `/login`. `beforeLoad` bounces an
 * already-signed-in user home. After submit it switches to the neutral "email
 * sent" state (anti-enumeration).
 */
export const Route = createFileRoute('/forgot-password')({
  beforeLoad: async ({ context }) => {
    await context.auth.ready
    if (context.auth.getState().status === 'authenticated') {
      throw redirect({ to: '/' })
    }
  },
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const t = useT()
  useDocumentTitle(t('auth.meta.forgot'))
  const [sent, setSent] = useState(false)

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <AuthBrand />
        <Card>
          {sent ? (
            <>
              <CardHeader>
                <h1 className="text-lg font-semibold tracking-[-0.01em] text-text">
                  {t('auth.forgot.sentTitle')}
                </h1>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-text-muted">{t('auth.forgot.sentDesc')}</p>
                <p className="text-center text-xs text-text-muted">
                  <Link to="/login" className="font-medium text-accent hover:underline">
                    {t('auth.forgot.backToLogin')}
                  </Link>
                </p>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <h1 className="text-lg font-semibold tracking-[-0.01em] text-text">
                  {t('auth.forgot.title')}
                </h1>
                <p className="mt-1 text-sm text-text-muted">{t('auth.forgot.subtitle')}</p>
              </CardHeader>
              <CardContent>
                <ForgotPasswordForm onSent={() => setSent(true)} />
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
