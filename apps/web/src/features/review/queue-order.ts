/**
 * Draw order of a session queue, biased towards the cards the user gets wrong.
 *
 * WHY NOT THE SERVER ORDER. `/api/review/queue` returns the lot sorted by
 * `due ASC, createdAt ASC`, so cards created together are always presented
 * together and two sessions over the same lot run in the exact same order. That
 * is predictable in the bad way: the answer starts being recalled from the
 * position in the deck rather than from the card itself.
 *
 * WHERE THE DIFFICULTY COMES FROM. `card.fsrs.difficulty` is the FSRS-owned
 * value already persisted by ts-fsrs and already carried by the queue DTO
 * (`fsrsCardStateSchema`). It is not a second scoring system: it is the one the
 * scheduler itself maintains, on a 1 (easy) to 10 (hard) scale. Nothing here
 * writes it, nothing here needs a migration.
 *
 * WHY A DRAW AND NOT A SORT. Sorting by difficulty would rebuild the very thing
 * we are trying to remove — a fixed order, just a different one — and would
 * always open the session on the hardest card. So the queue is *sampled*:
 * cards are drawn one at a time, each with a probability proportional to its
 * weight, without replacement. A mastered card can perfectly well come out
 * first; it simply does so less often.
 */

/** Weight of the easiest card (`difficulty = 1`). */
const MIN_WEIGHT = 1
/** Weight of the hardest card (`difficulty = 10`) — three draws for one. */
const MAX_WEIGHT = 3
/**
 * Weight of a never-reviewed card. Deliberately the midpoint of the scale and
 * NOT `MIN_WEIGHT`: see `weightFor`.
 */
const UNSEEN_WEIGHT = (MIN_WEIGHT + MAX_WEIGHT) / 2

const MIN_DIFFICULTY = 1
const MAX_DIFFICULTY = 10

/** The only part of a card this module reads. */
interface DifficultyBearing {
  fsrs: { difficulty: number }
}

/**
 * Map an FSRS difficulty onto a draw weight: `1` at difficulty 1, `3` at
 * difficulty 10, linear in between (`1 + 2 * (d - 1) / 9`). A card that keeps
 * being failed therefore lands early roughly three times as often as one that
 * is mastered — a real bias, but far from a sort.
 *
 * THE TRAP THIS MODULE EXISTS TO AVOID: the `difficulty` column defaults to `0`
 * and ts-fsrs only writes a real value on the first review, so a brand-new card
 * arrives here with `difficulty === 0` — outside the 1-10 scale. Clamping it
 * would read as "easiest possible card" and bury every new card at the end of
 * the session, which is the opposite of the truth: a card that has never been
 * answered is *unknown*, not easy. It gets the median weight instead.
 *
 * Any other out-of-range value (a corrupted row, a future scale change) is
 * clamped rather than trusted, so a single aberrant number cannot swallow the
 * whole draw.
 */
function weightFor(difficulty: number): number {
  if (difficulty === 0 || !Number.isFinite(difficulty)) return UNSEEN_WEIGHT
  const clamped = Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, difficulty))
  return (
    MIN_WEIGHT +
    ((MAX_WEIGHT - MIN_WEIGHT) * (clamped - MIN_DIFFICULTY)) / (MAX_DIFFICULTY - MIN_DIFFICULTY)
  )
}

/**
 * Order a session queue by weighted sampling without replacement.
 *
 * Pure: the input array is never touched and the output holds exactly the same
 * elements, in a new array of the same length.
 *
 * `random` is injected — a `() => number` in `[0, 1)`, `Math.random` in the app
 * — so the draw is reproducible under test. This module never reaches for
 * `Math.random` itself.
 */
export function orderQueue<T extends DifficultyBearing>(
  cards: readonly T[],
  random: () => number,
): T[] {
  const pool = cards.map((card) => ({ card, weight: weightFor(card.fsrs.difficulty) }))
  let total = pool.reduce((sum, entry) => sum + entry.weight, 0)

  const ordered: T[] = []
  while (pool.length > 0) {
    let target = random() * total
    // Fallback on the last entry: floating-point drift over the sweep (or a
    // `random()` that hands back exactly 1) can leave `target` non-negative
    // after the final subtraction, and the draw still has to yield a card.
    let picked = pool.length - 1
    let index = 0
    for (const entry of pool) {
      target -= entry.weight
      if (target < 0) {
        picked = index
        break
      }
      index += 1
    }
    // `picked` is always a live index of a non-empty pool, hence never a hole.
    const chosen = pool[picked]!
    ordered.push(chosen.card)
    total -= chosen.weight
    pool.splice(picked, 1)
  }
  return ordered
}
