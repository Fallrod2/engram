import type { Card, FsrsState } from '@engram/shared'

/**
 * FSRS breakdown of a session queue. One key per state of the v1 `State` enum,
 * in the order they are read on screen.
 */
export interface RemainingByState {
  new: number
  learning: number
  review: number
  relearning: number
}

/** Reading order of the four states — shared by the counters and the tests. */
export const REMAINING_STATES = [0, 1, 2, 3] as const satisfies readonly FsrsState[]

/** State → counter key, so the display never re-derives its own mapping. */
export const REMAINING_KEY_BY_STATE: Record<FsrsState, keyof RemainingByState> = {
  0: 'new',
  1: 'learning',
  2: 'review',
  3: 'relearning',
}

/**
 * The only part of a queue a card needs to be counted: its FSRS state. Derived
 * from the shared `Card` DTO so the shape can never drift from the API.
 */
export type QueueStatsCard = Pick<Card, 'fsrs'>

/**
 * Count the cards NOT yet consumed — from `index` (inclusive, the card on
 * screen) to the end of the frozen queue.
 *
 * Deliberately the *remaining* cards and not the totals of the lot: totals are
 * fixed for the whole session, so they say nothing once it has started. What
 * informs mid-session is the counter that goes down — how much of each kind of
 * effort is still ahead ("3 new left" is a decision, "12 new in total" is not).
 */
export function remainingByState(
  cards: ReadonlyArray<QueueStatsCard>,
  index: number,
): RemainingByState {
  const out: RemainingByState = { new: 0, learning: 0, review: 0, relearning: 0 }
  for (let i = Math.max(0, index); i < cards.length; i++) {
    const card = cards[i]
    if (!card) continue
    out[REMAINING_KEY_BY_STATE[card.fsrs.state]] += 1
  }
  return out
}
