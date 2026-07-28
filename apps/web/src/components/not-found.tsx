import { Link, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { NotFoundIllustration } from '@/components/illustrations'
import { useT } from '@/lib/i18n'
import { useDocumentTitle } from '@/lib/use-document-title'

/**
 * Unmatched URL (T-028 b). Replaces TanStack Router's bare, untranslated
 * "Not Found" string: an illustrated screen in the app's own language, with the
 * two exits a lost visitor needs (home, and back to where they came from) and a
 * document title that says what happened instead of the marketing one baked
 * into `index.html`.
 *
 * Mounted as the ROOT `notFoundComponent`, so it renders inside the app shell
 * for a signed-in user and bare for a signed-out one — hence the self-contained
 * vertical centring rather than a shell-dependent layout.
 */
export function NotFoundScreen() {
  const t = useT()
  const router = useRouter()
  useDocumentTitle(t('notFound.meta'))

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="text-text-faint">
        <NotFoundIllustration />
      </span>
      <div className="flex flex-col items-center gap-1.5">
        <p className="font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-text-faint">
          {t('notFound.code')}
        </p>
        <h1 className="text-lg font-semibold tracking-[-0.01em] text-text">
          {t('notFound.title')}
        </h1>
        <p className="max-w-[42ch] text-sm text-text-muted">{t('notFound.body')}</p>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link to="/">{t('common.backToDashboard')}</Link>
        </Button>
        <Button variant="ghost" onClick={() => router.history.back()}>
          {t('notFound.goBack')}
        </Button>
      </div>
    </div>
  )
}
