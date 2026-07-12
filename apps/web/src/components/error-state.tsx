import type { ReactNode } from 'react'
import { Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT, type TKey } from '@/lib/i18n'

/**
 * Inline query-error state (spec §1.5). Centered in the content area, never a
 * full-screen red page, never a spinner. A 404 on a detail passes a typed
 * `back` link (built by the caller) instead of a retry.
 *
 * Each `kind` maps to a dict key so the message follows the UI language (§9.4);
 * `satisfies` proves every value is a real key at build time.
 */
const MESSAGE_KEYS = {
  subjects: 'errorState.subjects',
  subject: 'errorState.subject',
  decks: 'errorState.decks',
  deck: 'errorState.deck',
  cards: 'errorState.cards',
  notes: 'errorState.notes',
  note: 'errorState.note',
  generation: 'errorState.generation',
  planning: 'errorState.planning',
} as const satisfies Record<string, TKey>

export function ErrorState({
  kind,
  onRetry,
  back,
}: {
  kind: keyof typeof MESSAGE_KEYS
  onRetry?: () => void
  /** A pre-built typed Link, shown instead of retry (e.g. for a 404). */
  back?: ReactNode
}) {
  const t = useT()
  return (
    <div className="flex min-h-[52vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-faint">
        <Unplug className="size-5" strokeWidth={1.75} />
      </span>
      <p className="text-base text-text-muted">{t(MESSAGE_KEYS[kind])}</p>
      {back ? (
        <Button asChild variant="secondary">
          {back}
        </Button>
      ) : (
        onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )
      )}
    </div>
  )
}
