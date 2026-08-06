import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { Skeleton } from '@/components/ui/skeleton'
import { DemoCta, useDemoAvailability } from '@/features/landing/demo-cta'

/**
 * The way out of `/login` for someone who has no account (T-034).
 *
 * Settings → Sign out lands here, and here used to be a dead end: an email field,
 * a password field, and a link to create an account. A visitor who arrived
 * through the landing's demo CTA — the one person guaranteed not to have
 * credentials — had no way back in short of pressing Back twice.
 *
 * The condition is `demoLoginEnabled` from `GET /api/health`, read through the
 * SAME hook the landing CTA uses (`useDemoAvailability`), on the same shared
 * query. Two entrances to one door: they turn on and off together, or the fix is
 * only half done.
 *
 * The separator is part of the answer, not decoration: it is what makes the demo
 * read as an alternative to signing in rather than another field of the form. So
 * it is gated on the same availability, and held with a skeleton while the probe
 * is in flight — a separator appearing over nothing is worse than no demo at all.
 */
export function LoginDemoEntry() {
  const t = useT()
  const availability = useDemoAvailability()
  const [failed, setFailed] = useState(false)

  if (availability === 'unavailable') return null

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono text-2xs uppercase tracking-[0.12em] text-text-faint">
          {t('auth.login.orSeparator')}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {availability === 'probing' ? (
        <Skeleton
          role="status"
          aria-label={t('landing.hero.demoCtaLoading')}
          className="h-9 w-full rounded-sm"
        />
      ) : (
        <div className="flex flex-col gap-2">
          <DemoCta onFailedChange={setFailed} size="default" className="w-full" />
          <p className="text-center text-xs text-text-muted">{t('auth.login.demoNote')}</p>
          {failed && (
            <p role="alert" className="text-center text-xs text-danger">
              {t('landing.hero.demoError')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
