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
 * Was this checkbox ticked with `Shift` held?
 *
 * A checkbox's `change` is ALWAYS derived from a click — the browser flips
 * `checked` as the click's activation behaviour and React's own change plugin
 * reads the click for checkboxes — so the modifiers of the gesture are still on
 * the native event. A toggle driven from the keyboard produces a synthetic
 * click with no modifiers, and correctly falls through to a plain toggle.
 */
function isShiftClick(event: React.ChangeEvent<HTMLInputElement>): boolean {
  const native: Event = event.nativeEvent
  return native instanceof MouseEvent && native.shiftKey
}

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
 * `Shift`+click does the same with the mouse, ANYWHERE on the row — the
 * checkbox included, which is the target a hand actually aims at for a
 * multi-select and which used to degrade the gesture into a plain toggle.
 * `Escape` releases everything.
 */
export function SearchResultsTable({
  hits,
  selection,
  onToggle,
  onExtend,
  onTogglePage,
  onOpen,
  onClearSelection,
  /** Dimmed while a newer request is in flight — see `isFreshFor`. */
  stale,
}: {
  hits: CardSearchHit[]
  selection: Selection
  onToggle: (cardId: string) => void
  onExtend: (cardId: string) => void
  onTogglePage: () => void
  onOpen: (hit: CardSearchHit) => void
  onClearSelection: () => void
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
      /**
       * Escape releases the selection — HANDLED HERE, on the list, and not as a
       * window-level hotkey. A window listener cannot tell "Escape while
       * browsing the list" from "Escape cancelling the delete dialog": Radix
       * closes the dialog on the same key and React has already flushed that
       * close by the time a window listener runs, so any "is a modal open?"
       * check reads false and the selection the user just refused to delete is
       * thrown away with it. Scoping the key to the list removes the ambiguity
       * by construction — a dialog traps focus, so the table never sees it.
       */
      if (key === 'Escape') {
        onClearSelection()
        return
      }
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
    [active, focusIndex, onClearSelection, onExtend, onToggle, pageIds, roving],
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
                /* A selected row must read as selected in BOTH themes. The
                   table's own `data-[active]` (the roving cursor) already
                   paints `surface-2`, so selection needs a different channel
                   entirely, not a paler version of the same one: an accent
                   tint AND a 2px accent edge. At 40% opacity the tint alone
                   was invisible on the light background. */
                className={cn(
                  'relative cursor-pointer',
                  selected &&
                    'bg-accent-subtle data-[active]:bg-accent-subtle hover:bg-accent-subtle',
                )}
              >
                {/* The cell keeps swallowing the click UNCONDITIONALLY, and the
                    Shift test is duplicated on the checkbox instead of being
                    delegated to the row. Letting a Shift+click bubble would run
                    BOTH handlers: ticking a native checkbox flips it and emits
                    its change event no matter what an ancestor does with the
                    click (the flip is the click's activation behaviour, decided
                    before dispatch), so the row would extend the range while the
                    box toggled the same card back out of it. One gesture, one
                    decision — and it can only be taken where the change lands. */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {selected && (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-accent"
                    />
                  )}
                  <Checkbox
                    checked={selected}
                    onCheckedChange={(_checked, e) => {
                      if (isShiftClick(e)) onExtend(hit.card.id)
                      else onToggle(hit.card.id)
                    }}
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
