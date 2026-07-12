import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { subjectDetailOptions } from '@/features/subjects/queries'
import { deckDetailOptions } from '@/features/decks/queries'
import type { ReviewScope } from '@/lib/api'

/** Resolve the scope label from the (already-warm) cache; never blocking. */
function useScopeLabel(scope: ReviewScope): string {
  const subject = useQuery({
    ...subjectDetailOptions(scope.subjectId ?? ''),
    enabled: !!scope.subjectId,
  })
  const deck = useQuery({
    ...deckDetailOptions(scope.deckId ?? ''),
    enabled: !!scope.deckId,
  })
  if (scope.deckId) return deck.data?.name ?? 'Deck'
  if (scope.subjectId) return subject.data?.name ?? 'Matière'
  return 'Toutes les cartes'
}

/**
 * Session header (spec §4.2): 48px, scope label (muted, left) · mono `done / total`
 * counter · close ✕. This is session chrome, not app chrome — the only
 * instrumentation the full-screen session keeps (finding #7).
 */
export function SessionHeader({
  scope,
  current,
  total,
  onExit,
}: {
  scope: ReviewScope
  /** 1-based position of the current card. */
  current: number
  total: number
  onExit: () => void
}) {
  const label = useScopeLabel(scope)
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-4">
      <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{label}</span>
      <span className="font-mono text-base tabular-nums text-text">
        {current}
        <span className="mx-0.5 text-text-faint">/</span>
        <span className="text-text-faint">{total}</span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={onExit}
        aria-label="Quitter la session (Échap)"
        className="text-text-muted"
      >
        <X className="size-4" />
      </Button>
    </header>
  )
}
