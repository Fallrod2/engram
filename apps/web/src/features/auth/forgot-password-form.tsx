import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from '@tanstack/react-router'
import { useT, type TFunction } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AUTH_INPUT_CLASS } from '@/components/ui/password-input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

/** Schema with i18n messages, rebuilt when the language changes. */
function makeSchema(t: TFunction) {
  return z.object({ email: z.string().email(t('auth.invalidEmail')) })
}
type Values = { email: string }

/**
 * "Forgot password" request form: validates the email, calls
 * `useAuth().resetPassword` (→ `supabase.auth.resetPasswordForEmail`), then
 * invokes `onSent`. It ALWAYS advances to the neutral "email sent" screen once
 * the call completes — success or failure — so the form never reveals whether an
 * account exists for the address (anti-enumeration), mirroring `/signup`.
 */
export function ForgotPasswordForm({ onSent }: { onSent: () => void }) {
  const t = useT()
  const { resetPassword } = useAuth()
  const schema = useMemo(() => makeSchema(t), [t])

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })
  const submitting = form.formState.isSubmitting

  const onSubmit = form.handleSubmit(async ({ email }) => {
    // Fire-and-forget the reset request. Any transport/rate-limit error is
    // deliberately swallowed: the confirmation screen is identical either way.
    await resetPassword(email)
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
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? t('auth.forgot.submitting') : t('auth.forgot.submit')}
        </Button>
        <p className="text-center text-xs text-text-muted">
          <Link to="/login" className="font-medium text-accent hover:underline">
            {t('auth.forgot.backToLogin')}
          </Link>
        </p>
      </form>
    </Form>
  )
}
