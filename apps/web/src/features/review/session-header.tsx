import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import type { FsrsCardState } from '@engram/shared'
import { Button } from '@/components/ui/button'
import { FsrsStateGlyph } from '@/components/fsrs-state-glyph'
import { useT } from '@/lib/i18n'
import { subjectDetailOptions } from '@/features/subjects/queries'
import { deckDetailOptions } from '@/features/decks/queries'
import type { ReviewScope } from '@/lib/api'

/** Resolve the scope label from the (already-warm) cache; never blocking. */
function useScopeLabel(scope: ReviewScope): string {
  const t = useT()
  const subject = useQuery({
    ...subjectDetailOptions(scope.subjectId ?? ''),
    enabled: !!scope.subjectId,
  })
  const deck = useQuery({
    ...deckDetailOptions(scope.deckId ?? ''),
    enabled: !!scope.deckId,
  })
  if (scope.deckId) return deck.data?.name ?? t('session.scopeDeck')
  if (scope.subjectId) return subject.data?.name ?? t('session.scopeSubject')
  return t('session.scopeAll')
}

/**
 * Session header (spec §4.2): 48px, scope label (muted, left) · FSRS glyph of the
 * current card · mono `done / total` counter · close ✕. This is session chrome,
 * not app chrome — the only instrumentation the full-screen session keeps
 * (finding #7). The glyph is 8px and speaks through its tooltip, so it states
 * what kind of card is on screen without touching the reading surface.
 */
export function SessionHeader({
  scope,
  current,
  total,
  fsrs,
  onExit,
}: {
  scope: ReviewScope
  /** 1-based position of the current card. */
  current: number
  total: number
  /** FSRS state of the card on screen; absent while there is none. */
  fsrs?: FsrsCardState | undefined
  onExit: () => void
}) {
  const label = useScopeLabel(scope)
  const t = useT()
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-4">
      <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{label}</span>
      {fsrs && <FsrsStateGlyph fsrs={fsrs} />}
      <span className="font-mono text-base tabular-nums text-text">
        {current}
        <span className="mx-0.5 text-text-faint">/</span>
        <span className="text-text-faint">{total}</span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={onExit}
        aria-label={t('session.exitAria')}
        className="text-text-muted"
      >
        <X className="size-4" />
      </Button>
    </header>
  )
}
