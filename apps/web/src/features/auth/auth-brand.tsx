import { Link } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'

/**
 * Brand mark for the public auth screens (login / signup / forgot-password /
 * set-password). The logo + wordmark link back to the landing page (`/`),
 * honouring the convention that a product logo is always a way home (audit
 * POLISH). Shared so the markup — and the link target — stay identical.
 */
export function AuthBrand() {
  const t = useT()
  return (
    <div className="mb-6 flex items-center justify-center">
      <Link to="/" aria-label={t('auth.title')} className="flex items-center gap-2 rounded-sm">
        <span
          className="flex size-6 items-center justify-center rounded-sm bg-accent text-accent-fg"
          aria-hidden
        >
          <span className="text-2xs">◆</span>
        </span>
        <span className="text-sm font-semibold tracking-[-0.01em] text-text">
          {t('auth.title')}
        </span>
      </Link>
    </div>
  )
}
