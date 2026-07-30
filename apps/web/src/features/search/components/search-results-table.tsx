import { useCallback } from 'react'
import type { CardSearchHit } from '@engram/shared'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { SubjectDot } from '@/components/subject-dot'
import { FsrsStateGlyph } from '@/components/fsrs-state-glyph'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useRovingList } from '@/lib/use-roving'
import { flattenMarkdown } from '@/lib/markdown'
import { formatDateTime, formatDue } from '@/lib/format'
import {
  isPageFullySelected,
  isPagePartiallySelected,
  isSelected,
  type Selection,
} from '../selection'

/**
 * The result list.
 *
 * KEYBOARD IS THE POINT, not a retrofit. `useRovingList` already owns the
 * cursor (`j/k`, arrows, Home/End, Enter to open); this adds the two things a
 * multi-select needs and it does not have:
 *   - `Space` toggles the row under the cursor;
 *   - `Shift`+arrow/`j`/`k` MOVES the cursor and extends the range in one go,
 *     the way every file manager behaves — so a run of forty cards is one held
 *     key, not forty deliberate presses.
 * `Shift`+click does the same with the mouse. Escape (owned by the screen)
 * empties the selection.
 */
export function SearchResultsTable({
  hits,
  selection,
  onToggle,
  onExtend,
  onTogglePage,
  onOpen,
  /** Dimmed while a newer request is in flight — see `isFreshFor`. */
  stale,
}: {
  hits: CardSearchHit[]
  selection: Selection
  onToggle: (cardId: string) => void
  onExtend: (cardId: string) => void
  onTogglePage: () => void
  onOpen: (hit: CardSearchHit) => void
  stale: boolean
}) {
  const t = useT()
  const pageIds = hits.map((h) => h.card.id)

  const roving = useRovingList<HTMLTableRowElement>(hits.length, (i) => {
    const hit = hits[i]
    if (hit) onOpen(hit)
  })
  const { focusIndex, active } = roving

  /**
   * Runs BEFORE the roving handler and only claims the keys roving does not
   * own. A Shift+arrow is handled here in full (move + extend) and never
   * forwarded, otherwise the cursor would move twice.
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key
      if (key === ' ' || key === 'Spacebar') {
        const id = pageIds[active]
        if (id) {
          e.preventDefault()
          onToggle(id)
        }
        return
      }
      const down = key === 'ArrowDown' || key === 'j'
      const up = key === 'ArrowUp' || key === 'k'
      if (e.shiftKey && (down || up)) {
        const next = down ? Math.min(pageIds.length - 1, active + 1) : Math.max(0, active - 1)
        const id = pageIds[next]
        if (id) {
          e.preventDefault()
          focusIndex(next)
          onExtend(id)
        }
        return
      }
      roving.onKeyDown(e)
    },
    [active, focusIndex, onExtend, onToggle, pageIds, roving],
  )

  const allSelected = isPageFullySelected(selection, pageIds)
  const someSelected = isPagePartiallySelected(selection, pageIds)

  return (
    <div
      className={cn(
        'overflow-x-auto transition-opacity duration-base',
        stale && 'pointer-events-none opacity-50',
      )}
      aria-busy={stale}
    >
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={onTogglePage}
                aria-label={t('search.selectPage')}
              />
            </TableHead>
            <TableHead className="w-8" />
            <TableHead>{t('search.colFront')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('search.colBack')}</TableHead>
            <TableHead className="hidden w-48 md:table-cell">{t('search.colDeck')}</TableHead>
            <TableHead className="w-24">{t('search.colDue')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody onKeyDown={onKeyDown}>
          {hits.map((hit, i) => {
            const selected = isSelected(selection, hit.card.id)
            return (
              <TableRow
                key={hit.card.id}
                {...roving.getItemProps(i)}
                aria-selected={selected}
                onClick={(e) => {
                  // Shift+click extends from the anchor; a plain click opens.
                  if (e.shiftKey) {
                    e.preventDefault()
                    onExtend(hit.card.id)
                    return
                  }
                  onOpen(hit)
                }}
                className={cn('cursor-pointer', selected && 'bg-accent-subtle/40')}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => onToggle(hit.card.id)}
                    aria-label={t('search.selectRow')}
                  />
                </TableCell>
                <TableCell>
                  <FsrsStateGlyph fsrs={hit.card.fsrs} />
                </TableCell>
                <TableCell className="max-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="block truncate text-text" title={hit.card.front}>
                      {flattenMarkdown(hit.card.front)}
                    </span>
                    {hit.subject.archived && (
                      <Badge variant="neutral" className="shrink-0">
                        {t('search.archivedBadge')}
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-0 lg:table-cell">
                  <span className="block truncate text-xs text-text-muted" title={hit.card.back}>
                    {flattenMarkdown(hit.card.back)}
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-0 md:table-cell">
                  {/* Subject + deck together: a deck name alone ("Chapitre 2")
                      is ambiguous across subjects, and the report's complaint
                      was precisely not knowing where a card lives. */}
                  <span className="flex min-w-0 items-center gap-1.5">
                    <SubjectDot color={hit.subject.color} muted={hit.subject.archived} />
                    <span className="truncate text-xs text-text-muted">{hit.deck.name}</span>
                  </span>
                </TableCell>
                <TableCell>
                  <span
                    className="font-mono text-xs tabular-nums text-text-muted"
                    title={formatDateTime(hit.card.fsrs.due)}
                  >
                    {formatDue(hit.card.fsrs.due)}
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
