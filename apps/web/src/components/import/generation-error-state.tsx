import { Link } from '@tanstack/react-router'
import { Info, TriangleAlert, Unplug } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * "The demo never spends" notice (T-058), shown INSTEAD of
 * `ApiKeyMissingBanner` when the caller is the demo account.
 *
 * Both sentences are true of a demo visitor: no provider is configured, AND the
 * demo would be refused even if one were (`requireNotDemoSpend`). Only one of
 * them is useful. "Aucun provider IA configuré" sends the reader to Réglages to
 * fix something that is not theirs to fix, on an account whose AI config is
 * read-only — a dead end dressed as an action. The real answer is the
 * pre-recorded generation the demo already ships (`origin: 'prerecorded'`).
 *
 * So this is `info` and `role="note"`, matching `PrerecordedNotice` and NOT the
 * `warning` hue these screens reserve for "something is misconfigured". Nothing
 * is broken here; a rule is being stated, and the way forward named.
 */
export function DemoNoSpendNotice({
  scope = 'generation',
  className,
}: {
  /** Which spending route was refused — the two name different ways forward. */
  scope?: 'generation' | 'ocr'
  className?: string
}) {
  const t = useT()
  const keys =
    scope === 'ocr'
      ? ({
          title: 'ocr.provider.demoNoSpend.title',
          body: 'ocr.provider.demoNoSpend.body',
        } as const)
      : ({ title: 'generation.demoNoSpendTitle', body: 'generation.demoNoSpendBody' } as const)
  return (
    <div
      role="note"
      className={cn(
        'flex items-start gap-3 rounded-md border border-info/30 bg-info-subtle px-4 py-3',
        className,
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-info" strokeWidth={2} aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium text-text">{t(keys.title)}</p>
        <p className="text-xs leading-relaxed text-text-muted">{t(keys.body)}</p>
      </div>
    </div>
  )
}

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
