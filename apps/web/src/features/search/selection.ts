import { CARD_BULK_MAX } from '@engram/shared'

/**
 * The multi-selection of the search screen.
 *
 * WHAT IT IS NOT: a filter. There is deliberately no "select everything that
 * matches" — the bulk contract takes a list of ids, and a delete driven by a
 * predicate would let one mistyped filter destroy a corpus nobody looked at.
 * The selection only ever accumulates rows the user actually had on screen.
 *
 * It DOES survive paging, because "delete these forty cards" is a job that
 * spans pages. That is also why the cap is enforced here rather than left to
 * the server's 400: the user must be told they hit the ceiling at the moment
 * they hit it, not after clicking Delete.
 */

/** Ceiling on one batch — the server's, mirrored so the UI refuses first. */
export const SELECTION_MAX = CARD_BULK_MAX

export interface Selection {
  /** Insertion-ordered, no duplicates. Order is what makes the cap predictable. */
  readonly ids: readonly string[]
  /** Last row toggled on its own — the fixed end of a Shift range. */
  readonly anchor: string | null
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null }

export interface SelectionResult {
  selection: Selection
  /** Ids the cap refused. Non-zero ⇒ the caller must SAY so. */
  rejected: number
}

function keep(selection: Selection, rejected = 0): SelectionResult {
  return { selection, rejected }
}

/** Add ids in order, stopping at the cap; reports how many were refused. */
function add(sel: Selection, ids: readonly string[], anchor: string | null): SelectionResult {
  const next = [...sel.ids]
  const seen = new Set(next)
  let rejected = 0
  for (const id of ids) {
    if (seen.has(id)) continue
    if (next.length >= SELECTION_MAX) {
      rejected++
      continue
    }
    next.push(id)
    seen.add(id)
  }
  return keep({ ids: next, anchor }, rejected)
}

export function isSelected(sel: Selection, id: string): boolean {
  return sel.ids.includes(id)
}

/**
 * Click / Space on one row. Toggling ALWAYS moves the anchor — including when
 * it deselects, so a Shift range started right after a deselect runs from the
 * row the user last touched, which is the row they are looking at.
 */
export function toggleOne(sel: Selection, id: string): SelectionResult {
  if (isSelected(sel, id)) {
    return keep({ ids: sel.ids.filter((x) => x !== id), anchor: id })
  }
  return add(sel, [id], id)
}

/**
 * Shift+click / Shift+Arrow: everything between the anchor and `id`, inclusive.
 *
 * ADDITIVE, never a replacement: two ranges picked in two different decks are a
 * normal way to build a batch, and a range that wiped the earlier one would
 * make the second pick silently undo the first. The anchor STAYS put, so
 * extending the same range by one more row keeps growing it from the same end
 * instead of collapsing to a two-row range.
 *
 * With no anchor (or an anchor that is not on this page — it was selected
 * before the user paged) this degrades to a plain toggle, which is the only
 * honest reading: there is no visible interval to span.
 */
export function extendTo(sel: Selection, pageIds: readonly string[], id: string): SelectionResult {
  const to = pageIds.indexOf(id)
  const from = sel.anchor === null ? -1 : pageIds.indexOf(sel.anchor)
  if (to === -1) return keep(sel)
  if (from === -1) return toggleOne(sel, id)
  const [lo, hi] = from <= to ? [from, to] : [to, from]
  return add(sel, pageIds.slice(lo, hi + 1), sel.anchor)
}

/**
 * The header checkbox: select every row of THIS page, or — when the page is
 * already fully selected — release exactly those rows and nothing else. Rows
 * picked on other pages are untouched either way.
 */
export function togglePage(sel: Selection, pageIds: readonly string[]): SelectionResult {
  if (pageIds.length === 0) return keep(sel)
  if (isPageFullySelected(sel, pageIds)) {
    const drop = new Set(pageIds)
    return keep({ ids: sel.ids.filter((id) => !drop.has(id)), anchor: null })
  }
  return add(sel, pageIds, sel.anchor)
}

export function isPageFullySelected(sel: Selection, pageIds: readonly string[]): boolean {
  return pageIds.length > 0 && pageIds.every((id) => isSelected(sel, id))
}

export function isPagePartiallySelected(sel: Selection, pageIds: readonly string[]): boolean {
  return pageIds.some((id) => isSelected(sel, id)) && !isPageFullySelected(sel, pageIds)
}

/** Drop ids that no longer exist (after a bulk delete, or a card edited away). */
export function forget(sel: Selection, gone: readonly string[]): Selection {
  const drop = new Set(gone)
  return {
    ids: sel.ids.filter((id) => !drop.has(id)),
    anchor: sel.anchor !== null && drop.has(sel.anchor) ? null : sel.anchor,
  }
}
