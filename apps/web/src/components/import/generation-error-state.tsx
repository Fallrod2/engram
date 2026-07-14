import { Link } from '@tanstack/react-router'
import { TriangleAlert, Unplug } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

/**
 * "No AI provider configured" banner (spec §6.4). Multi-provider: the config
 * now lives in Settings → Intelligence artificielle (no more `.env` mention).
 * The single justified use of a semantic hue (`warning-subtle`) in these
 * screens — a configuration warning, visually isolated from the triage flow.
 * Never offers a naive "Réessayer" (it would fail identically) and never leaks
 * a key. Kept named `ApiKeyMissingBanner` (its call sites are unchanged).
 */
export function ApiKeyMissingBanner() {
  const t = useT()
  return (
    <div className="rounded-md border border-warning/30 bg-warning-subtle px-4 py-3">
      <div className="flex items-start gap-3">
        <TriangleAlert
          className="mt-0.5 size-4 shrink-0 text-warning"
          strokeWidth={2}
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text">{t('generation.noProviderTitle')}</p>
          <p className="text-xs leading-relaxed text-text-muted">
            {t('generation.noProviderBody')}
          </p>
          <div className="mt-1">
            <Button asChild variant="secondary" size="sm">
              <Link to="/settings">{t('generation.noProviderCta')}</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Failed-generation state (spec §1.5.bis-2). */
export function GenerationErrorState({
  error,
  onRetry,
  retrying = false,
}: {
  error: string | null
  onRetry: () => void
  retrying?: boolean
}) {
  const t = useT()
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-faint">
        <Unplug className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <p className="text-lg font-semibold tracking-[-0.01em] text-text">
          {t('generation.failedTitle')}
        </p>
        {error && <p className="font-mono text-xs leading-relaxed text-text-muted">{error}</p>}
      </div>
      <Button onClick={onRetry} disabled={retrying}>
        {t('generation.relaunchFull')}
      </Button>
    </div>
  )
}
