import { Link } from '@tanstack/react-router'
import { TriangleAlert, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Missing-Anthropic-key banner (spec §1.5.bis-3, §5). The single justified use
 * of a semantic hue (`warning-subtle`) in these screens — a configuration
 * warning, not a card rating, visually isolated from the triage flow. Never
 * offers a naive "Réessayer" (it would fail identically) and never leaks the key.
 */
export function ApiKeyMissingBanner() {
  return (
    <div className="rounded-md border border-warning/30 bg-warning-subtle px-4 py-3">
      <div className="flex items-start gap-3">
        <TriangleAlert
          className="mt-0.5 size-4 shrink-0 text-warning"
          strokeWidth={2}
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text">Clé API Anthropic manquante</p>
          <p className="text-xs leading-relaxed text-text-muted">
            Ajoutez{' '}
            <code className="rounded-xs bg-surface-3 px-1 py-0.5 font-mono text-2xs text-text">
              ANTHROPIC_API_KEY
            </code>{' '}
            dans{' '}
            <code className="rounded-xs bg-surface-3 px-1 py-0.5 font-mono text-2xs text-text">
              apps/server/.env
            </code>{' '}
            (voir{' '}
            <code className="rounded-xs bg-surface-3 px-1 py-0.5 font-mono text-2xs text-text">
              .env.example
            </code>
            ) puis relancez le serveur.
          </p>
          <div className="mt-1">
            <Button asChild variant="secondary" size="sm">
              <Link to="/settings">Réglages</Link>
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
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-faint">
        <Unplug className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <p className="text-lg font-semibold tracking-[-0.01em] text-text">La génération a échoué</p>
        {error && <p className="font-mono text-xs leading-relaxed text-text-muted">{error}</p>}
      </div>
      <Button onClick={onRetry} disabled={retrying}>
        Relancer la génération
      </Button>
    </div>
  )
}
