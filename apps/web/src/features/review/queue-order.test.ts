import { describe, expect, it } from 'vitest'
import type { Card } from '@engram/shared'
import { orderQueue } from './queue-order'

/** The slice of the queue DTO the draw reads — derived from `Card`, never redeclared. */
type OrderCard = Pick<Card, 'id' | 'fsrs'>

function card(id: string, difficulty: number): OrderCard {
  return {
    id,
    fsrs: {
      due: '2026-07-12T10:00:00.000Z',
      stability: 1.5,
      difficulty,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: 2,
      lastReview: null,
    },
  }
}

/**
 * A seeded LCG (Numerical Recipes constants) standing in for `Math.random`: the
 * draw is only reproducible under test because the randomness is injected, and
 * a home-made generator keeps that free of any dependency.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/**
 * Mean 0-indexed position of each card id over `runs` independent draws.
 *
 * All the statistical assertions below run on the same LCG seed, so they are
 * deterministic: a red test means the weights moved, never bad luck.
 */
function meanPositions(cards: readonly OrderCard[], runs: number, seed: number) {
  const random = lcg(seed)
  const totals = new Map<string, number>()
  for (let run = 0; run < runs; run++) {
    const ordered = orderQueue(cards, random)
    ordered.forEach((c, index) => totals.set(c.id, (totals.get(c.id) ?? 0) + index))
  }
  const means = new Map<string, number>()
  for (const [id, sum] of totals) means.set(id, sum / runs)
  return (id: string): number => means.get(id) ?? Number.NaN
}

const RUNS = 2000

describe('orderQueue — purity and permutation', () => {
  const lot = [card('a', 1), card('b', 5), card('c', 10), card('d', 0)]

  it('is deterministic: same input and same random sequence give the same order', () => {
    const first = orderQueue(lot, lcg(42)).map((c) => c.id)
    const second = orderQueue(lot, lcg(42)).map((c) => c.id)
    expect(second).toEqual(first)
  })

  it('returns a permutation: same length, same elements, no loss, no duplicate', () => {
    const random = lcg(7)
    for (let run = 0; run < 50; run++) {
      const ordered = orderQueue(lot, random)
      expect(ordered).toHaveLength(lot.length)
      expect(new Set(ordered.map((c) => c.id)).size).toBe(lot.length)
      expect([...ordered].sort((x, y) => x.id.localeCompare(y.id))).toEqual(
        [...lot].sort((x, y) => x.id.localeCompare(y.id)),
      )
    }
  })

  it('does not mutate the input array', () => {
    const input = [card('a', 1), card('b', 10), card('c', 0)]
    const before = input.map((c) => c.id)
    const snapshot = [...input]
    orderQueue(input, lcg(3))
    expect(input.map((c) => c.id)).toEqual(before)
    expect(input).toEqual(snapshot)
  })

  it('returns a new array rather than the one it was given', () => {
    expect(orderQueue(lot, lcg(1))).not.toBe(lot)
  })

  it('handles the degenerate lots: empty and single-card', () => {
    expect(orderQueue([], lcg(1))).toEqual([])
    const one = [card('only', 10)]
    expect(orderQueue(one, lcg(1)).map((c) => c.id)).toEqual(['only'])
  })
})

/**
 * The reference lot for every statistical assertion: one easy card (weight 1),
 * one never-reviewed card (weight 2) and one hard card (weight 3), total 6.
 *
 * Weighted sampling without replacement on three cards is small enough to solve
 * exactly, which is what makes the thresholds below defensible instead of
 * hand-tuned. Expected mean 0-indexed positions:
 *
 *   hard   E[pos] = 0.650   (P(first) = 3/6)
 *   unseen E[pos] = 0.933   (P(first) = 2/6)
 *   easy   E[pos] = 1.417   (P(first) = 1/6)
 *
 * They sum to 3 = 0 + 1 + 2, as any set of mean positions must. Over 2000 draws
 * the standard error on each mean is about 0.02, so the ±0.1 tolerances used
 * below sit roughly five standard errors away from the truth — loose enough to
 * survive an unrelated change of seed, tight enough to catch a wrong weight.
 */
const MIXED_LOT = [card('easy', 1), card('unseen', 0), card('hard', 10)]

describe('orderQueue — the bias exists and points the right way', () => {
  it('draws a hard card markedly earlier than an easy one', () => {
    const mean = meanPositions(MIXED_LOT, RUNS, 20260726)
    // Expected gap is 1.417 - 0.650 = 0.767; asserting half of it leaves a wide
    // margin while still failing outright if the weights were flat or inverted.
    expect(mean('hard')).toBeLessThan(mean('easy') - 0.4)
  })

  it('matches the analytic means of the 1 / 2 / 3 weight scale', () => {
    const mean = meanPositions(MIXED_LOT, RUNS, 20260726)
    expect(Math.abs(mean('hard') - 0.65)).toBeLessThan(0.1)
    expect(Math.abs(mean('unseen') - 0.933)).toBeLessThan(0.1)
    expect(Math.abs(mean('easy') - 1.417)).toBeLessThan(0.1)
  })

  it('treats a never-reviewed card (difficulty 0) as median, not as the easiest', () => {
    const mean = meanPositions(MIXED_LOT, RUNS, 20260726)
    // The trap: `difficulty` defaults to 0 until the first review, so clamping
    // it into the 1-10 scale would give a new card the MINIMUM weight and bury
    // it at the end of every session. Its mean position must sit strictly
    // between the hard card's and the easy card's.
    expect(mean('unseen')).toBeGreaterThan(mean('hard') + 0.15)
    expect(mean('unseen')).toBeLessThan(mean('easy') - 0.15)
  })
})

describe('orderQueue — out-of-range difficulties are clamped, not trusted', () => {
  it('never breaks the permutation on aberrant values', () => {
    const lot = [card('over', 42), card('under', -3), card('nan', Number.NaN), card('sane', 5)]
    const ordered = orderQueue(lot, lcg(11))
    expect(ordered).toHaveLength(4)
    expect(new Set(ordered.map((c) => c.id)).size).toBe(4)
  })

  // The three probes below run the aberrant lot and its in-scale control on the
  // SAME seed and the same lot size, so both consume the LCG identically: the
  // comparison is paired and any surviving gap is a real difference of weight.
  it('bounds a difficulty above the scale to the weight of difficulty 10', () => {
    const overshoot = meanPositions([card('easy', 1), card('probe', 42)], RUNS, 5)
    const control = meanPositions([card('easy', 1), card('probe', 10)], RUNS, 5)
    expect(Math.abs(overshoot('probe') - control('probe'))).toBeLessThan(0.05)
  })

  it('bounds a negative difficulty to the weight of difficulty 1', () => {
    const undershoot = meanPositions([card('hard', 10), card('probe', -3)], RUNS, 5)
    const control = meanPositions([card('hard', 10), card('probe', 1)], RUNS, 5)
    expect(Math.abs(undershoot('probe') - control('probe'))).toBeLessThan(0.05)
  })

  it('gives a non-finite difficulty the median weight, like a never-reviewed card', () => {
    const broken = meanPositions([card('easy', 1), card('probe', Number.NaN)], RUNS, 5)
    const control = meanPositions([card('easy', 1), card('probe', 0)], RUNS, 5)
    expect(Math.abs(broken('probe') - control('probe'))).toBeLessThan(0.05)
  })
})
