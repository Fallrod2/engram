import type { QueueNewCards } from '@engram/shared'

/**
 * Reading the server's daily new-card budget (`GET /api/review/queue` →
 * `newCards`) into what the screen has to SAY.
 *
 * The bug this exists to prevent: the session used to branch on `total === 0`
 * alone and congratulate the user — "Rien à réviser, tout est à jour" — in a
 * case where that is simply false. Someone who spends their 20 new cards on one
 * subject, then opens a session filtered on another subject holding only
 * never-seen cards, gets a total of 0 with cards silently waiting behind the
 * budget. Congratulating someone for a queue that is empty by policy is the same
 * class of defect as congratulating them for a failure.
 *
 * Pure and separate from the components on purpose: this is the part that has to
 * be right, and it is asserted directly rather than through a rendered tree.
 */

/** Why the session queue came back empty. */
export type EmptyReason =
  /** Genuinely nothing: no due card and no new card waiting. The congratulation is earned. */
  | { kind: 'nothing' }
  /** The user set the limit to 0 — new cards are deliberately paused, not exhausted. */
  | { kind: 'paused'; withheld: number }
  /** The daily budget is spent; `withheld` cards are held for tomorrow. */
  | { kind: 'limit'; withheld: number; limit: number; introduced: number }

/**
 * Why an EMPTY queue is empty.
 *
 * `newCards` is optional in the contract (an older serverless function during a
 * deploy rollout does not send it), and `undefined` degrades to `nothing`: with
 * no budget information there is nothing truthful to add, and inventing a
 * withheld count would be worse than the old copy.
 *
 * `limit === 0` is split out because it is a DIFFERENT statement. "You have run
 * out for today" is wrong when the user deliberately paused new cards; the two
 * need different wording and only one of them is about a limit being reached.
 */
export function emptyReason(newCards: QueueNewCards | undefined): EmptyReason {
  if (!newCards || newCards.withheld <= 0) return { kind: 'nothing' }
  if (newCards.limit === 0) return { kind: 'paused', withheld: newCards.withheld }
  return {
    kind: 'limit',
    withheld: newCards.withheld,
    limit: newCards.limit,
    introduced: newCards.introduced,
  }
}

/**
 * The end-of-session note, for the MIXED case: the lot was not empty, yet cards
 * were still held back — so the user who has just finished deserves to know why
 * the session stopped where it did rather than assuming they are done.
 *
 * Returns `null` whenever there is nothing to say, which is the common case: the
 * summary must not grow a permanent line that reads "0 cards held back". A
 * `null` here means the caller renders nothing at all.
 */
export function withheldNote(
  newCards: QueueNewCards | undefined,
): { withheld: number; limit: number; paused: boolean } | null {
  if (!newCards || newCards.withheld <= 0) return null
  return { withheld: newCards.withheld, limit: newCards.limit, paused: newCards.limit === 0 }
}
