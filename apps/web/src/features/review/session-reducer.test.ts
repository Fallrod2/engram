import { describe, expect, it } from 'vitest'
import type { Card } from '@engram/shared'
import { initialState, reviewedCount, sessionReducer, type SessionState } from './session-reducer'

function makeCard(id: string): Card {
  return {
    id,
    deckId: 'deck-1',
    front: `front ${id}`,
    back: `back ${id}`,
    fsrs: {
      due: '2026-07-12T00:00:00.000Z',
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReview: null,
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

const NOW = '2026-07-12T10:00:00.000Z'

/** A state parked in ASKING with `n` cards at `index`. */
function asking(n: number, index = 0): SessionState {
  const cards = Array.from({ length: n }, (_, i) => makeCard(`c${i}`))
  return { ...initialState(NOW), phase: 'ASKING', cards, total: n, index }
}

describe('sessionReducer — loading (§16.1 item 1)', () => {
  it('QUEUE_LOADED with total 0 → EMPTY', () => {
    const s = sessionReducer(initialState(NOW), { type: 'QUEUE_LOADED', cards: [], total: 0 })
    expect(s.phase).toBe('EMPTY')
  })

  it('QUEUE_LOADED with cards → ASKING(0)', () => {
    const s = sessionReducer(initialState(NOW), {
      type: 'QUEUE_LOADED',
      cards: [makeCard('a'), makeCard('b')],
      total: 2,
    })
    expect(s.phase).toBe('ASKING')
    expect(s.index).toBe(0)
    expect(s.cards).toHaveLength(2)
  })

  it('QUEUE_FAILED → ERROR, and RETRY → LOADING', () => {
    const err = sessionReducer(initialState(NOW), { type: 'QUEUE_FAILED' })
    expect(err.phase).toBe('ERROR')
    expect(sessionReducer(err, { type: 'RETRY' }).phase).toBe('LOADING')
  })
})

describe('sessionReducer — reveal & rate guards (§16.1 items 2, 2bis)', () => {
  it('REVEAL only transitions from ASKING', () => {
    expect(sessionReducer(asking(2), { type: 'REVEAL' }).phase).toBe('REVEALED')
    // No-op from SUMMARY / LOADING.
    const summary = { ...asking(1), phase: 'SUMMARY' as const }
    expect(sessionReducer(summary, { type: 'REVEAL' }).phase).toBe('SUMMARY')
    expect(sessionReducer(initialState(NOW), { type: 'REVEAL' }).phase).toBe('LOADING')
  })

  it('RATE only accepted from REVEALED', () => {
    // From ASKING → ignored (must reveal first).
    expect(sessionReducer(asking(2), { type: 'RATE', grade: 3, durationMs: 100 }).phase).toBe(
      'ASKING',
    )
    const revealed = sessionReducer(asking(2), { type: 'REVEAL' })
    expect(sessionReducer(revealed, { type: 'RATE', grade: 3, durationMs: 100 }).phase).toBe(
      'SUBMITTING',
    )
  })

  it('RATE is ignored while SUBMITTING — anti double-submit (finding #9)', () => {
    const revealed = sessionReducer(asking(2), { type: 'REVEAL' })
    const submitting = sessionReducer(revealed, { type: 'RATE', grade: 3, durationMs: 100 })
    expect(submitting.phase).toBe('SUBMITTING')
    // A second RATE (re-press / concurrent click) does nothing.
    const again = sessionReducer(submitting, { type: 'RATE', grade: 1, durationMs: 999 })
    expect(again).toBe(submitting)
    expect(again.pendingGrade).toBe(3)
    expect(again.pendingDurationMs).toBe(100)
  })
})

describe('sessionReducer — rating outcomes (§16.1 items 3, 4, 4bis)', () => {
  function submit(state: SessionState, grade: 1 | 2 | 3 | 4, durationMs: number): SessionState {
    return sessionReducer(sessionReducer(state, { type: 'REVEAL' }), {
      type: 'RATE',
      grade,
      durationMs,
    })
  }

  it('RATE_OK before the last card → ASKING(i+1), result accumulated', () => {
    const submitting = submit(asking(3, 0), 3, 4200)
    const ok = sessionReducer(submitting, { type: 'RATE_OK' })
    expect(ok.phase).toBe('ASKING')
    expect(ok.index).toBe(1)
    expect(ok.results).toEqual([{ cardId: 'c0', grade: 3, durationMs: 4200 }])
  })

  it('RATE_OK on the last card → SUMMARY', () => {
    const submitting = submit(asking(2, 1), 4, 1000)
    const ok = sessionReducer(submitting, { type: 'RATE_OK' })
    expect(ok.phase).toBe('SUMMARY')
    expect(ok.index).toBe(2)
    expect(ok.results).toEqual([{ cardId: 'c1', grade: 4, durationMs: 1000 }])
  })

  it('RATE_FAIL → back to REVEALED(i), submitError, no advance, no result', () => {
    const submitting = submit(asking(3, 0), 2, 500)
    const failed = sessionReducer(submitting, { type: 'RATE_FAIL' })
    expect(failed.phase).toBe('REVEALED')
    expect(failed.index).toBe(0)
    expect(failed.submitError).toBe(true)
    expect(failed.results).toHaveLength(0)
  })

  it('RATE_SKIP (404) advances WITHOUT recording a result (finding #8)', () => {
    const submitting = submit(asking(3, 0), 1, 800)
    const skipped = sessionReducer(submitting, { type: 'RATE_SKIP' })
    expect(skipped.phase).toBe('ASKING')
    expect(skipped.index).toBe(1)
    expect(skipped.results).toHaveLength(0)
  })

  it('RATE_SKIP on the last card → SUMMARY, still no result', () => {
    const submitting = submit(asking(2, 1), 1, 800)
    const skipped = sessionReducer(submitting, { type: 'RATE_SKIP' })
    expect(skipped.phase).toBe('SUMMARY')
    expect(skipped.results).toHaveLength(0)
  })
})

describe('sessionReducer — exit (§16.1 item 5)', () => {
  it('REQUEST_EXIT with 0 reviews → exits directly', () => {
    const s = sessionReducer(asking(2), { type: 'REQUEST_EXIT' })
    expect(s.exited).toBe(true)
    expect(s.confirmingExit).toBe(false)
  })

  it('REQUEST_EXIT with ≥1 review → opens confirm, CANCEL_EXIT restores', () => {
    const withReview: SessionState = {
      ...asking(3, 1),
      results: [{ cardId: 'c0', grade: 3, durationMs: 100 }],
    }
    expect(reviewedCount(withReview)).toBe(1)
    const confirming = sessionReducer(withReview, { type: 'REQUEST_EXIT' })
    expect(confirming.confirmingExit).toBe(true)
    expect(confirming.exited).toBe(false)
    const cancelled = sessionReducer(confirming, { type: 'CANCEL_EXIT' })
    expect(cancelled.confirmingExit).toBe(false)
    expect(cancelled.exited).toBe(false)
  })

  it('CONFIRM_EXIT exits', () => {
    const withReview: SessionState = {
      ...asking(3, 1),
      confirmingExit: true,
      results: [{ cardId: 'c0', grade: 3, durationMs: 100 }],
    }
    expect(sessionReducer(withReview, { type: 'CONFIRM_EXIT' }).exited).toBe(true)
  })
})

describe('sessionReducer — pause & composite precedence (§16.1 items 6, 6bis)', () => {
  it('PAUSE / RESUME toggle paused without touching phase or index', () => {
    const base = asking(3, 1)
    const paused = sessionReducer(base, { type: 'PAUSE' })
    expect(paused.paused).toBe(true)
    expect(paused.phase).toBe('ASKING')
    expect(paused.index).toBe(1)
    const resumed = sessionReducer(paused, { type: 'RESUME' })
    expect(resumed.paused).toBe(false)
    expect(resumed.phase).toBe('ASKING')
    expect(resumed.index).toBe(1)
  })

  it('PAUSE then REQUEST_EXIT → REQUEST_EXIT ignored while paused (§11.4)', () => {
    const withReview: SessionState = {
      ...asking(3, 1),
      results: [{ cardId: 'c0', grade: 3, durationMs: 100 }],
    }
    const paused = sessionReducer(withReview, { type: 'PAUSE' })
    const stillPaused = sessionReducer(paused, { type: 'REQUEST_EXIT' })
    expect(stillPaused.paused).toBe(true)
    expect(stillPaused.confirmingExit).toBe(false) // unchanged — ignored
    const resumed = sessionReducer(stillPaused, { type: 'RESUME' })
    expect(resumed.paused).toBe(false)
    expect(resumed.confirmingExit).toBe(false)
  })

  it('REQUEST_EXIT then PAUSE → both true, RESUME restores the dialog', () => {
    const withReview: SessionState = {
      ...asking(3, 1),
      results: [{ cardId: 'c0', grade: 3, durationMs: 100 }],
    }
    const confirming = sessionReducer(withReview, { type: 'REQUEST_EXIT' })
    expect(confirming.confirmingExit).toBe(true)
    const paused = sessionReducer(confirming, { type: 'PAUSE' })
    expect(paused.paused).toBe(true)
    expect(paused.confirmingExit).toBe(true) // preserved behind the pause
    const resumed = sessionReducer(paused, { type: 'RESUME' })
    expect(resumed.paused).toBe(false)
    expect(resumed.confirmingExit).toBe(true) // dialog comes back
  })
})

describe('sessionReducer — review again (§16.1 item 6ter)', () => {
  it('REVIEW_AGAIN from SUMMARY → LOADING with a new sessionNow, results reset', () => {
    const summary: SessionState = {
      ...asking(2, 2),
      phase: 'SUMMARY',
      results: [
        { cardId: 'c0', grade: 3, durationMs: 100 },
        { cardId: 'c1', grade: 4, durationMs: 200 },
      ],
    }
    const nextNow = '2026-07-12T10:05:00.000Z'
    const restarted = sessionReducer(summary, { type: 'REVIEW_AGAIN', sessionNow: nextNow })
    expect(restarted.phase).toBe('LOADING')
    expect(restarted.sessionNow).toBe(nextNow)
    expect(restarted.sessionNow).not.toBe(summary.sessionNow)
    expect(restarted.results).toHaveLength(0)
    expect(restarted.index).toBe(0)
    expect(restarted.cards).toHaveLength(0)
  })

  it('REVIEW_AGAIN is a no-op outside SUMMARY', () => {
    const base = asking(2)
    expect(sessionReducer(base, { type: 'REVIEW_AGAIN', sessionNow: NOW }).phase).toBe('ASKING')
  })
})
