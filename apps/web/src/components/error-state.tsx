import type { ReactNode } from 'react'
import { Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Inline query-error state (spec §1.5). Centered in the content area, never a
 * full-screen red page, never a spinner. A 404 on a detail passes a typed
 * `back` link (built by the caller) instead of a retry.
 */
const MESSAGES = {
  subjects: 'Impossible de charger les matières.',
  subject: 'Impossible de charger cette matière.',
  decks: 'Impossible de charger les decks.',
  deck: 'Impossible de charger ce deck.',
  cards: 'Impossible de charger les cartes.',
  notes: 'Impossible de charger les notes.',
  note: 'Impossible de charger cette note.',
  generation: 'Impossible de charger cette génération.',
  planning: 'Impossible de charger le planning.',
} as const

export function ErrorState({
  kind,
  onRetry,
  back,
}: {
  kind: keyof typeof MESSAGES
  onRetry?: () => void
  /** A pre-built typed Link, shown instead of retry (e.g. for a 404). */
  back?: ReactNode
}) {
  return (
    <div className="flex min-h-[52vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-faint">
        <Unplug className="size-5" strokeWidth={1.75} />
      </span>
      <p className="text-base text-text-muted">{MESSAGES[kind]}</p>
      {back ? (
        <Button asChild variant="secondary">
          {back}
        </Button>
      ) : (
        onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Réessayer
          </Button>
        )
      )}
    </div>
  )
}
