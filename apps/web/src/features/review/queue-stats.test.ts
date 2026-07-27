import { describe, expect, it } from 'vitest'
import type { FsrsState } from '@engram/shared'
import { remainingByState, type QueueStatsCard } from './queue-stats'

function card(state: FsrsState): QueueStatsCard {
  return {
    fsrs: {
      due: '2026-07-12T10:00:00.000Z',
      stability: 1.5,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state,
      lastReview: null,
    },
  }
}

/** new · relearning · review · learning · new · review — the four states mixed. */
const QUEUE: QueueStatsCard[] = [card(0), card(3), card(2), card(1), card(0), card(2)]

describe('remainingByState — cards left from `index` to the end', () => {
  it('counts the whole queue at index 0', () => {
    expect(remainingByState(QUEUE, 0)).toEqual({ new: 2, learning: 1, review: 2, relearning: 1 })
  })

  it('drops the consumed cards mid-queue', () => {
    // Cards 0..2 are behind us; only learning, new, review remain.
    expect(remainingByState(QUEUE, 3)).toEqual({ new: 1, learning: 1, review: 1, relearning: 0 })
  })

  it('counts the current card as remaining (index is inclusive)', () => {
    // Index 5 is the last card (review) and is still on screen.
    expect(remainingByState(QUEUE, 5)).toEqual({ new: 0, learning: 0, review: 1, relearning: 0 })
  })

  it('is all zeros once every card is consumed (index === length)', () => {
    expect(remainingByState(QUEUE, QUEUE.length)).toEqual({
      new: 0,
      learning: 0,
      review: 0,
      relearning: 0,
    })
  })

  it('is all zeros on an empty queue', () => {
    expect(remainingByState([], 0)).toEqual({ new: 0, learning: 0, review: 0, relearning: 0 })
  })
})
