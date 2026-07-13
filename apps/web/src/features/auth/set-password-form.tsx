import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useT, type TFunction } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

/** Minimum password length (spec §3.4 login validated `min(1)`; onboarding is stricter). */
export const PASSWORD_MIN_LENGTH = 8

/** Schema with i18n messages, rebuilt when the language changes. */
function makeSchema(t: TFunction) {
  return z
    .object({
      password: z.string().min(PASSWORD_MIN_LENGTH, t('auth.setPassword.tooShort')),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, {
      path: ['confirm'],
      message: t('auth.setPassword.mismatch'),
    })
}

type Values = { password: string; confirm: string }

/**
 * Shared "set a password" machine (spec: invite/recovery onboarding + Settings
 * change-password). Validates length + confirmation (zod), calls
 * `supabase.auth.updateUser({password})` via `useAuth().setPassword`, then invokes
 * `onSuccess`. The caller decides what success means (navigate into the app for
 * onboarding, close the dialog + toast for a change).
 */
export function SetPasswordForm({
  onSuccess,
  submitLabel,
}: {
  onSuccess: () => void
  /** Optional override for the submit button label; defaults to `auth.setPassword.submit`. */
  submitLabel?: string
}) {
  const t = useT()
  const { setPassword } = useAuth()
  const schema = useMemo(() => makeSchema(t), [t])
  const [error, setError] = useState<string | null>(null)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  })
  const submitting = form.formState.isSubmitting

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null)
    const result = await setPassword(password)
    if (result.error) {
      setError(t('auth.setPassword.error'))
      return
    }
    onSuccess()
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.setPassword.newPassword')}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  disabled={submitting}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.setPassword.confirm')}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  disabled={submitting}
                  {...field}
                />
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
          {submitting
            ? t('auth.setPassword.submitting')
            : (submitLabel ?? t('auth.setPassword.submit'))}
        </Button>
      </form>
    </Form>
  )
}
