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

/**
 * 404 wording (T-028). "Impossible de charger cette matière" describes an
 * incident; a 404 is not one — the server answered, and the answer is that the
 * entity is gone. Only the kinds addressable by id get a variant; the list
 * screens keep the load-failure wording (they cannot 404).
 */
const MISSING_KEYS = {
  subject: 'errorState.missing.subject',
  deck: 'errorState.missing.deck',
  note: 'errorState.missing.note',
  generation: 'errorState.missing.generation',
} as const satisfies Partial<Record<keyof typeof MESSAGE_KEYS, TKey>>

function messageKey(kind: keyof typeof MESSAGE_KEYS, notFound: boolean): TKey {
  if (notFound && kind in MISSING_KEYS) return MISSING_KEYS[kind as keyof typeof MISSING_KEYS]
  return MESSAGE_KEYS[kind]
}

export function ErrorState({
  kind,
  notFound = false,
  onRetry,
  back,
}: {
  kind: keyof typeof MESSAGE_KEYS
  /** The request came back 404 — say "gone", not "could not load". */
  notFound?: boolean
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
      <p className="text-base text-text-muted">{t(messageKey(kind, notFound))}</p>
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
