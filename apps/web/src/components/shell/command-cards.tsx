import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import type { CardSearchHit } from '@engram/shared'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CommandGroup, CommandItem } from '@/components/ui/command'
import { SubjectDot } from '@/components/subject-dot'
import { flattenMarkdown } from '@/lib/markdown'
import { usePlural, useT } from '@/lib/i18n'
import { PALETTE_LIMIT, cardSearchOptions } from '@/features/search/queries'
import { isFreshFor } from '@/features/search/results'
import { cardItemValue } from './command-filter'

/**
 * Card results inside the ⌘K palette (T-030).
 *
 * The palette is a SHORTCUT, not the search screen: eight rows, one line each,
 * and a way out to `/search` for the rest. Everything here exists to keep the
 * rest of the palette exactly as fast as it was before card search existed.
 */

/** Long enough that a fast typist fires one request, short enough to feel live. */
const DEBOUNCE_MS = 200

export interface CardPaletteResults {
  /** Trimmed needle the displayed rows answer. */
  needle: string
  hits: CardSearchHit[]
  /** Size of the full match set — drives the "see all" row. */
  total: number
  /**
   * A request for what is CURRENTLY typed has not landed. While this is true
   * the palette must not render "No results": the app would be claiming it
   * looked and found nothing, in the exact moment it is still looking.
   *
   * True during the debounce window too, and that is the point — the gap
   * between the last keystroke and the request going out is the longest part.
   */
  pending: boolean
}

export function useCardPaletteResults(rawSearch: string, enabled: boolean): CardPaletteResults {
  const trimmed = rawSearch.trim()
  const [needle, setNeedle] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setNeedle(trimmed), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [trimmed])

  const wanted = enabled && trimmed.length > 0
  const query = useQuery({
    ...cardSearchOptions({ q: needle, limit: PALETTE_LIMIT, offset: 0 }),
    enabled: enabled && needle.length > 0,
  })

  // Two independent staleness guards, and both are needed. `needle === trimmed`
  // rejects the answer to what the user WAS typing; `isFreshFor` rejects a
  // response whose echoed query is not the one we asked for at all — the case
  // the server's `query` field exists for, and the one a cache lookup alone
  // cannot rule out.
  const settled = wanted && needle === trimmed && isFreshFor(needle, query.data)

  return {
    needle,
    hits: settled ? (query.data?.hits ?? []) : [],
    total: settled ? (query.data?.total ?? 0) : 0,
    pending: wanted && !settled,
  }
}

/**
 * The "Cards" group. Rendered only when there is something to render — cmdk
 * hides an empty group, but mounting one still registers it and makes the
 * palette re-sort for nothing.
 */
export function CardResultsGroup({
  results,
  onSelectCard,
  onSeeAll,
}: {
  results: CardPaletteResults
  onSelectCard: (hit: CardSearchHit) => void
  onSeeAll: () => void
}) {
  const t = useT()
  const plural = usePlural()
  if (results.hits.length === 0) return null

  return (
    <CommandGroup heading={t('cmd.groups.cards')}>
      {results.hits.map((hit) => (
        <CommandItem
          key={hit.card.id}
          value={cardItemValue(hit.card.id)}
          onSelect={() => onSelectCard(hit)}
        >
          <SubjectDot color={hit.subject.color} muted={hit.subject.archived} />
          {/* One line, always. A two-line row would give the results corridor a
              different rhythm from the actions above it, and the palette would
              visibly change shape as answers arrive. */}
          <span className="min-w-0 flex-1 truncate" title={hit.card.front}>
            {flattenMarkdown(hit.card.front)}
          </span>
          {hit.subject.archived && (
            <Badge variant="neutral" className="shrink-0">
              {t('cmd.cards.archived')}
            </Badge>
          )}
          {/* The deck is the subtitle the user report asked for: without it two
              cards with the same front are indistinguishable. Trailing and muted
              so it reads as secondary and costs no vertical space. */}
          <span className="max-w-[38%] shrink-0 truncate font-mono text-2xs text-text-faint">
            {hit.deck.name}
          </span>
        </CommandItem>
      ))}
      {results.total > results.hits.length && (
        <CommandItem value={cardItemValue('see-all')} onSelect={onSeeAll}>
          <ArrowRight />
          {t(`cmd.cards.seeAll_${plural(results.total)}`, { count: results.total })}
        </CommandItem>
      )}
    </CommandGroup>
  )
}

/**
 * Placeholder rows for a search in flight. A skeleton and not a spinner (house
 * rule), and NOT a cmdk group: an unregistered block is always visible, so it
 * cannot be filtered away by the very search it is announcing.
 */
export function CardResultsSkeleton() {
  const t = useT()
  return (
    <div className="p-1" role="status" aria-busy="true" aria-label={t('cmd.cards.searching')}>
      <p className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
        {t('cmd.groups.cards')}
      </p>
      {['w-2/5', 'w-1/2', 'w-1/3'].map((w) => (
        <div key={w} className="flex h-8 items-center gap-2 px-2">
          <Skeleton className="size-2 shrink-0 rounded-full" />
          <Skeleton className={`h-3 ${w}`} />
          <Skeleton className="ml-auto h-2.5 w-14" />
        </div>
      ))}
    </div>
  )
}
