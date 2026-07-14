import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from '@tanstack/react-router'
import { useT, type TFunction } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AUTH_INPUT_CLASS, PasswordInput } from '@/components/ui/password-input'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

/** Minimum password length (matches the onboarding set-password rule). */
export const SIGNUP_PASSWORD_MIN_LENGTH = 8

/** Schema with i18n messages, rebuilt when the language changes. */
function makeSchema(t: TFunction) {
  return z
    .object({
      email: z.string().email(t('auth.invalidEmail')),
      password: z.string().min(SIGNUP_PASSWORD_MIN_LENGTH, t('auth.signup.tooShort')),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, {
      path: ['confirm'],
      message: t('auth.signup.mismatch'),
    })
}

type Values = { email: string; password: string; confirm: string }

/**
 * Sign-up machine (spec BYOK §2): validates email + password (min 8) +
 * confirmation, calls `useAuth().signUp`, and on success invokes `onSent` so the
 * page shows the "check your email" state. With email confirmation ON, GoTrue
 * does NOT reveal whether the address already exists (anti-enumeration) — so a
 * clean result always means "check your email"; only 422 (weak password) and 429
 * (rate limit) surface actionable errors (amendment §10).
 */
export function SignupForm({ onSent }: { onSent: () => void }) {
  const t = useT()
  const { signUp } = useAuth()
  const schema = useMemo(() => makeSchema(t), [t])
  const [error, setError] = useState<string | null>(null)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', confirm: '' },
  })
  const submitting = form.formState.isSubmitting

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null)
    const result = await signUp(email, password)
    if (result.error) {
      if (result.status === 422) setError(t('auth.signup.error.weakPassword'))
      else if (result.status === 429) setError(t('auth.signup.error.rateLimit'))
      else setError(t('auth.signup.error.generic'))
      return
    }
    onSent()
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.email')}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  disabled={submitting}
                  className={AUTH_INPUT_CLASS}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.password')}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" disabled={submitting} {...field} />
              </FormControl>
              {/* Length rule stated up-front, before any error (audit POLISH). */}
              <FormDescription>{t('auth.passwordMinHint')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.signup.confirm')}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" disabled={submitting} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? t('auth.signup.submitting') : t('auth.signup.submit')}
        </Button>
        <p className="text-center text-xs text-text-muted">
          {t('auth.signup.haveAccount')}{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            {t('auth.signup.signInLink')}
          </Link>
        </p>
      </form>
    </Form>
  )
}
