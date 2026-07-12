import type { GenerationItem, GenerationItemStatus } from '@engram/shared'

/**
 * Local review state (spec §4.4) — the accept/edit/reject/undo decisions live
 * entirely on the client until the final grouped `resolve`; nothing is persisted
 * before insertion, which makes undo trivial and total. This module is pure
 * (no React) so the state machine is unit-tested in isolation.
 *
 * An item is FROZEN once the server has inserted it (it carries a `cardId`):
 * frozen items ignore every decision (their FSRS history must never be touched).
 */

/** A snapshot pushed onto the per-item undo stack before each mutation. */
interface Snapshot {
  front: string
  back: string
  status: GenerationItemStatus
}

export interface ReviewItem {
  id: string
  front: string
  back: string
  status: GenerationItemStatus
  frozen: boolean
  cardId: string | undefined
  /** Per-item undo stack (most recent last). */
  history: Snapshot[]
}

export interface ReviewCounts {
  accepted: number
  edited: number
  rejected: number
  pending: number
  /** Total the "Insérer" button will send (accepted + edited, not yet inserted). */
  toInsert: number
}

export type ReviewAction =
  | { type: 'accept'; id: string }
  | { type: 'reject'; id: string }
  | { type: 'edit'; id: string; front: string; back: string }
  | { type: 'undo'; id: string }
  | { type: 'acceptAllPending' }

/** Build the local review buffer from the server items. */
export function initReviewItems(items: GenerationItem[]): ReviewItem[] {
  return items.map((it) => ({
    id: it.id,
    front: it.front,
    back: it.back,
    status: it.status,
    frozen: it.cardId !== undefined,
    cardId: it.cardId,
    history: [],
  }))
}

function snapshot(it: ReviewItem): Snapshot {
  return { front: it.front, back: it.back, status: it.status }
}

/** Apply a mutation to one non-frozen item, pushing an undo snapshot. */
function mutateOne(
  items: ReviewItem[],
  id: string,
  fn: (it: ReviewItem) => ReviewItem,
): ReviewItem[] {
  return items.map((it) => {
    if (it.id !== id || it.frozen) return it
    return { ...fn(it), history: [...it.history, snapshot(it)] }
  })
}

export function reviewReducer(items: ReviewItem[], action: ReviewAction): ReviewItem[] {
  switch (action.type) {
    case 'accept':
      return mutateOne(items, action.id, (it) => ({ ...it, status: 'accepted' }))
    case 'reject':
      return mutateOne(items, action.id, (it) => ({ ...it, status: 'rejected' }))
    case 'edit':
      return mutateOne(items, action.id, (it) => ({
        ...it,
        status: 'edited',
        front: action.front,
        back: action.back,
      }))
    case 'undo':
      return items.map((it) => {
        if (it.id !== action.id || it.frozen || it.history.length === 0) return it
        const prev = it.history[it.history.length - 1] as Snapshot
        return {
          ...it,
          front: prev.front,
          back: prev.back,
          status: prev.status,
          history: it.history.slice(0, -1),
        }
      })
    case 'acceptAllPending':
      return items.map((it) => {
        if (it.frozen || it.status !== 'pending') return it
        return { ...it, status: 'accepted', history: [...it.history, snapshot(it)] }
      })
    default:
      return items
  }
}

/** Live counters for the footer (spec §4.5). */
export function countReview(items: ReviewItem[]): ReviewCounts {
  let accepted = 0
  let edited = 0
  let rejected = 0
  let pending = 0
  let toInsert = 0
  for (const it of items) {
    if (it.status === 'accepted') accepted++
    else if (it.status === 'edited') edited++
    else if (it.status === 'rejected') rejected++
    else pending++
    if (!it.frozen && (it.status === 'accepted' || it.status === 'edited')) toInsert++
  }
  return { accepted, edited, rejected, pending, toInsert }
}

/** Whether an item can still be undone (has a prior state and isn't frozen). */
export function canUndo(it: ReviewItem): boolean {
  return !it.frozen && it.history.length > 0
}

/**
 * The `resolve` payload (spec §4.5): every item, with its current status and
 * (possibly edited) content. The server merges by id and freezes inserts.
 */
export function toResolvePayload(items: ReviewItem[]): GenerationItem[] {
  return items.map((it) => ({
    id: it.id,
    front: it.front,
    back: it.back,
    status: it.status,
    ...(it.cardId !== undefined ? { cardId: it.cardId } : {}),
  }))
}
