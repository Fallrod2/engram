import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useSearch, Link } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'
import { sanitizeRedirect } from '@/lib/auth-store'
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

/**
 * Login machine (spec §3.4): `idle → submitting → error`. On success the
 * `onAuthStateChange` flips the store to `authenticated`; we then navigate to the
 * captured `redirect` (or `/`). The error is deliberately generic — GoTrue does
 * not distinguish an unknown email from a wrong password.
 */
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
type Values = z.infer<typeof schema>

export function LoginForm() {
  const t = useT()
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const search = useSearch({ from: '/login' })
  const [error, setError] = useState<string | null>(null)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })
  const submitting = form.formState.isSubmitting

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null)
    const result = await signIn(email, password)
    if (result.error) {
      setError(t('auth.error.invalid'))
      return
    }
    // Sanitize the attacker-controllable search param to a same-origin relative
    // path before navigating post-login (CWE-601 open-redirect defense).
    void navigate({ href: sanitizeRedirect(search.redirect) })
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
                <Input
                  type="password"
                  autoComplete="current-password"
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
          {submitting ? t('auth.submitting') : t('auth.submit')}
        </Button>
        <p className="text-center text-xs text-text-muted">
          {t('auth.login.noAccount')}{' '}
          <Link to="/signup" className="font-medium text-accent hover:underline">
            {t('auth.login.signUpLink')}
          </Link>
        </p>
      </form>
    </Form>
  )
}
