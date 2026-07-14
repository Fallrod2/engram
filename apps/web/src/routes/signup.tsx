import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { useT } from '@/lib/i18n'
import { sanitizeRedirect } from '@/lib/auth-store'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { SignupForm } from '@/features/auth/signup-form'

/**
 * Sign-up screen (spec BYOK §2) — calqued on `/login`: rendered OUTSIDE the app
 * shell, sobre / Precision-Linear, dark by default. `beforeLoad` bounces an
 * already-signed-in user to their target. After a successful submit the page
 * switches to the "check your email" confirmation state (email confirmation is
 * ON, so no immediate session).
 */
export const Route = createFileRoute('/signup')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ context, search }) => {
    await context.auth.ready
    if (context.auth.getState().status === 'authenticated') {
      throw redirect({ href: sanitizeRedirect(search.redirect) })
    }
  },
  component: SignupPage,
})

function SignupPage() {
  const t = useT()
  const [sent, setSent] = useState(false)

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
        <Card>
          {sent ? (
            <>
              <CardHeader>
                <h1 className="text-lg font-semibold tracking-[-0.01em] text-text">
                  {t('auth.signup.checkEmailTitle')}
                </h1>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-text-muted">{t('auth.signup.checkEmailDesc')}</p>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <h1 className="text-lg font-semibold tracking-[-0.01em] text-text">
                  {t('auth.signup.title')}
                </h1>
                <p className="mt-1 text-sm text-text-muted">{t('auth.signup.subtitle')}</p>
              </CardHeader>
              <CardContent>
                <SignupForm onSent={() => setSent(true)} />
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
