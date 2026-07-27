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

describe('sessionReducer — answering a QCM (SELECT_CHOICE)', () => {
  /** A graded card behind us, its undo POSTed and not yet acked. */
  function undoInFlight(phase: 'ASKING' | 'REVEALED'): SessionState {
    return {
      ...asking(3, 1),
      phase,
      results: [{ cardId: 'c0', grade: 3, durationMs: 100 }],
      lastReview: { cardId: 'c0', logId: 'log-0', grade: 3, index: 0 },
      undoing: true,
    }
  }

  it('a fresh session has nothing selected', () => {
    expect(initialState(NOW).selectedChoice).toBeNull()
    expect(asking(3, 0).selectedChoice).toBeNull()
  })

  it('from ASKING → REVEALED, with the picked index recorded', () => {
    const chosen = sessionReducer(asking(3, 0), { type: 'SELECT_CHOICE', index: 2 })
    // Picking IS revealing: one keystroke, both effects.
    expect(chosen.phase).toBe('REVEALED')
    expect(chosen.selectedChoice).toBe(2)
    // …and nothing else moved: no grade, no cursor.
    expect(chosen.index).toBe(0)
    expect(chosen.results).toEqual([])
    expect(chosen.pendingGrade).toBeNull()
  })

  it('is ignored outside ASKING — a question is answered once', () => {
    const revealed = sessionReducer(asking(3, 0), { type: 'REVEAL' })
    expect(sessionReducer(revealed, { type: 'SELECT_CHOICE', index: 1 })).toBe(revealed)

    const submitting = sessionReducer(revealed, { type: 'RATE', grade: 3, durationMs: 100 })
    expect(submitting.phase).toBe('SUBMITTING')
    expect(sessionReducer(submitting, { type: 'SELECT_CHOICE', index: 1 })).toBe(submitting)

    const summary: SessionState = { ...asking(2, 2), phase: 'SUMMARY' }
    expect(sessionReducer(summary, { type: 'SELECT_CHOICE', index: 0 })).toBe(summary)

    const loading = initialState(NOW)
    expect(sessionReducer(loading, { type: 'SELECT_CHOICE', index: 0 })).toBe(loading)
  })

  it('is accepted while an undo is in flight — it reveals, it does not advance', () => {
    // Deliberate asymmetry with RATE / SKIP_CARD / OPEN_EDIT / REVIEW_AGAIN,
    // pinned here so it is not "fixed" into a guard: what `undoing` protects is
    // the session cursor and its content target, and a selection touches
    // neither — no more than REVEAL, which is not guarded either.
    const inFlight = undoInFlight('ASKING')
    const chosen = sessionReducer(inFlight, { type: 'SELECT_CHOICE', index: 1 })
    expect(chosen.phase).toBe('REVEALED')
    expect(chosen.selectedChoice).toBe(1)
    expect(chosen.index).toBe(1)
    expect(chosen.results).toEqual(inFlight.results)
    expect(chosen.lastReview).toBe(inFlight.lastReview)
    expect(chosen.undoing).toBe(true)
  })

  it('REVEAL leaves nothing selected — seeing the answer is not answering', () => {
    const revealed = sessionReducer(asking(3, 0), { type: 'REVEAL' })
    expect(revealed.phase).toBe('REVEALED')
    expect(revealed.selectedChoice).toBeNull()
  })

  it('advancing clears the selection — RATE_OK', () => {
    const chosen = sessionReducer(asking(3, 0), { type: 'SELECT_CHOICE', index: 1 })
    const submitting = sessionReducer(chosen, { type: 'RATE', grade: 3, durationMs: 100 })
    const ok = sessionReducer(submitting, { type: 'RATE_OK', logId: 'log-0' })
    expect(ok.index).toBe(1)
    expect(ok.selectedChoice).toBeNull()
  })

  it('advancing clears the selection — SKIP_CARD', () => {
    const chosen = sessionReducer(asking(3, 0), { type: 'SELECT_CHOICE', index: 2 })
    const skipped = sessionReducer(chosen, { type: 'SKIP_CARD' })
    expect(skipped.index).toBe(1)
    expect(skipped.selectedChoice).toBeNull()
  })

  it('UNDO_OK clears the selection — it lands on ANOTHER card', () => {
    const inFlight: SessionState = { ...undoInFlight('REVEALED'), selectedChoice: 0 }
    const undone = sessionReducer(inFlight, { type: 'UNDO_OK' })
    expect(undone.index).toBe(0) // rewound onto c0…
    expect(undone.selectedChoice).toBeNull() // …so c1's answer is dropped
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
    const ok = sessionReducer(submitting, { type: 'RATE_OK', logId: 'log-1' })
    expect(ok.phase).toBe('ASKING')
    expect(ok.index).toBe(1)
    expect(ok.results).toEqual([{ cardId: 'c0', grade: 3, durationMs: 4200 }])
  })

  it('RATE_OK on the last card → SUMMARY', () => {
    const submitting = submit(asking(2, 1), 4, 1000)
    const ok = sessionReducer(submitting, { type: 'RATE_OK', logId: 'log-1' })
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

describe('sessionReducer — user skip (SKIP_CARD)', () => {
  it('from ASKING → next card, no result recorded, total untouched', () => {
    const base = asking(3, 0)
    const skipped = sessionReducer(base, { type: 'SKIP_CARD' })
    expect(skipped.phase).toBe('ASKING')
    expect(skipped.index).toBe(1)
    expect(skipped.results).toEqual([])
    expect(skipped.total).toBe(base.total)
  })

  it('from REVEALED → next card, no result recorded', () => {
    const revealed = sessionReducer(asking(3, 0), { type: 'REVEAL' })
    const skipped = sessionReducer(revealed, { type: 'SKIP_CARD' })
    expect(skipped.phase).toBe('ASKING')
    expect(skipped.index).toBe(1)
    expect(skipped.results).toEqual([])
  })

  it('leaves already-graded results strictly unchanged', () => {
    const results = [
      { cardId: 'c0', grade: 3 as const, durationMs: 100 },
      { cardId: 'c1', grade: 1 as const, durationMs: 250 },
    ]
    const withResults: SessionState = { ...asking(4, 2), results, total: 4 }
    const skipped = sessionReducer(withResults, { type: 'SKIP_CARD' })
    expect(skipped.results).toEqual(results)
    expect(skipped.total).toBe(4)
    expect(reviewedCount(skipped)).toBe(2)
  })

  it('on the last card → SUMMARY', () => {
    const skipped = sessionReducer(asking(2, 1), { type: 'SKIP_CARD' })
    expect(skipped.phase).toBe('SUMMARY')
    expect(skipped.index).toBe(2)
    expect(skipped.results).toEqual([])
  })

  it('is ignored from SUBMITTING — a review is already in flight', () => {
    const submitting = sessionReducer(sessionReducer(asking(3, 0), { type: 'REVEAL' }), {
      type: 'RATE',
      grade: 3,
      durationMs: 400,
    })
    expect(submitting.phase).toBe('SUBMITTING')
    expect(sessionReducer(submitting, { type: 'SKIP_CARD' })).toBe(submitting)
  })

  it('is ignored from SUMMARY and LOADING', () => {
    const summary: SessionState = { ...asking(2, 2), phase: 'SUMMARY' }
    expect(sessionReducer(summary, { type: 'SKIP_CARD' })).toBe(summary)
    const loading = initialState(NOW)
    expect(sessionReducer(loading, { type: 'SKIP_CARD' })).toBe(loading)
  })

  it('drops the undo target — U must not reach back OVER a skip', () => {
    const withTarget: SessionState = {
      ...asking(4, 1),
      results: [{ cardId: 'c0', grade: 3, durationMs: 100 }],
      lastReview: { cardId: 'c0', logId: 'log-0', grade: 3, index: 0 },
    }
    const skipped = sessionReducer(withTarget, { type: 'SKIP_CARD' })
    expect(skipped.index).toBe(2)
    expect(skipped.results).toEqual(withTarget.results) // nothing recorded…
    expect(skipped.lastReview).toBeNull() // …and nothing left to undo
    expect(sessionReducer(skipped, { type: 'UNDO' }).undoing).toBe(false)
  })
})

describe('sessionReducer — card edit (OPEN_EDIT / CLOSE_EDIT)', () => {
  it('OPEN_EDIT from ASKING and from REVEALED opens without moving the phase', () => {
    const fromAsking = sessionReducer(asking(2), { type: 'OPEN_EDIT' })
    expect(fromAsking.editing).toBe(true)
    expect(fromAsking.phase).toBe('ASKING')
    expect(fromAsking.index).toBe(0)

    const revealed = sessionReducer(asking(2), { type: 'REVEAL' })
    const fromRevealed = sessionReducer(revealed, { type: 'OPEN_EDIT' })
    expect(fromRevealed.editing).toBe(true)
    expect(fromRevealed.phase).toBe('REVEALED')
  })

  it('OPEN_EDIT is ignored from SUBMITTING, SUMMARY, LOADING and EMPTY', () => {
    const submitting = sessionReducer(sessionReducer(asking(2), { type: 'REVEAL' }), {
      type: 'RATE',
      grade: 3,
      durationMs: 400,
    })
    expect(sessionReducer(submitting, { type: 'OPEN_EDIT' })).toBe(submitting)

    const summary: SessionState = { ...asking(2, 2), phase: 'SUMMARY' }
    expect(sessionReducer(summary, { type: 'OPEN_EDIT' })).toBe(summary)

    const loading = initialState(NOW)
    expect(sessionReducer(loading, { type: 'OPEN_EDIT' })).toBe(loading)

    const empty: SessionState = { ...initialState(NOW), phase: 'EMPTY' }
    expect(sessionReducer(empty, { type: 'OPEN_EDIT' })).toBe(empty)
  })

  it('CLOSE_EDIT closes; it is a no-op when nothing is open', () => {
    const open = sessionReducer(asking(2), { type: 'OPEN_EDIT' })
    const closed = sessionReducer(open, { type: 'CLOSE_EDIT' })
    expect(closed.editing).toBe(false)
    expect(closed.phase).toBe('ASKING')
    const base = asking(2)
    expect(sessionReducer(base, { type: 'CLOSE_EDIT' })).toBe(base)
  })
})

describe('sessionReducer — CARD_EDITED', () => {
  it('patches front/back of the targeted card only', () => {
    const base = asking(3, 1)
    const edited = sessionReducer(base, {
      type: 'CARD_EDITED',
      cardId: 'c1',
      front: 'nouveau recto',
      back: 'nouveau verso',
    })
    expect(edited.cards[1]?.front).toBe('nouveau recto')
    expect(edited.cards[1]?.back).toBe('nouveau verso')
    // Neighbours untouched, down to object identity.
    expect(edited.cards[0]).toBe(base.cards[0])
    expect(edited.cards[2]).toBe(base.cards[2])
    // No phase/index/result side effect.
    expect(edited.phase).toBe('ASKING')
    expect(edited.index).toBe(1)
    expect(edited.results).toEqual([])
  })

  it('never touches the FSRS state of the edited card', () => {
    const base = asking(2, 0)
    const before = base.cards[0]?.fsrs
    const edited = sessionReducer(base, {
      type: 'CARD_EDITED',
      cardId: 'c0',
      front: 'f',
      back: 'b',
    })
    // Deep equality: not a single scheduling field moved…
    expect(edited.cards[0]?.fsrs).toEqual(before)
    // …and referential identity: the object was carried over, not rebuilt.
    expect(edited.cards[0]?.fsrs).toBe(before)
    expect(edited.cards[0]?.id).toBe('c0')
    expect(edited.cards[0]?.deckId).toBe('deck-1')
  })

  it('is a no-op for a cardId absent from the lot', () => {
    const base = asking(2)
    const edited = sessionReducer(base, {
      type: 'CARD_EDITED',
      cardId: 'ghost',
      front: 'f',
      back: 'b',
    })
    expect(edited).toBe(base)
  })

  it('applies while the dialog is open and leaves `editing` alone', () => {
    const open = sessionReducer(asking(2), { type: 'OPEN_EDIT' })
    const edited = sessionReducer(open, {
      type: 'CARD_EDITED',
      cardId: 'c0',
      front: 'f',
      back: 'b',
    })
    expect(edited.editing).toBe(true)
    expect(edited.cards[0]?.front).toBe('f')
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

describe('sessionReducer — undo the last rating (U, step 10)', () => {
  /** REVEAL + RATE + RATE_OK: one full graded card, undo target armed. */
  function rate(
    state: SessionState,
    grade: 1 | 2 | 3 | 4,
    durationMs: number,
    logId: string,
  ): SessionState {
    const submitting = sessionReducer(sessionReducer(state, { type: 'REVEAL' }), {
      type: 'RATE',
      grade,
      durationMs,
    })
    return sessionReducer(submitting, { type: 'RATE_OK', logId })
  }

  it('a fresh session has nothing to undo', () => {
    expect(initialState(NOW).lastReview).toBeNull()
    expect(initialState(NOW).undoing).toBe(false)
  })

  it('RATE_OK arms the target with the index of the card JUST RATED, not the next', () => {
    const ok = rate(asking(3, 1), 2, 700, 'log-42')
    // The cursor moved on…
    expect(ok.index).toBe(2)
    // …but the target still points at the card that was graded.
    expect(ok.lastReview).toEqual({ cardId: 'c1', logId: 'log-42', grade: 2, index: 1 })
  })

  it('RATE_OK on the LAST card arms the target too (undo from SUMMARY)', () => {
    const ok = rate(asking(2, 1), 4, 900, 'log-last')
    expect(ok.phase).toBe('SUMMARY')
    expect(ok.lastReview).toEqual({ cardId: 'c1', logId: 'log-last', grade: 4, index: 1 })
  })

  it('UNDO is ignored when there is no target', () => {
    const base = asking(3, 0)
    expect(sessionReducer(base, { type: 'UNDO' })).toBe(base)
    const summary: SessionState = { ...asking(2, 2), phase: 'SUMMARY' }
    expect(sessionReducer(summary, { type: 'UNDO' })).toBe(summary)
  })

  it('UNDO is refused while SUBMITTING — a review is already in flight', () => {
    const graded = rate(asking(3, 0), 3, 400, 'log-0')
    const submitting = sessionReducer(sessionReducer(graded, { type: 'REVEAL' }), {
      type: 'RATE',
      grade: 1,
      durationMs: 50,
    })
    expect(submitting.phase).toBe('SUBMITTING')
    expect(submitting.lastReview).not.toBeNull() // a target DOES exist…
    expect(sessionReducer(submitting, { type: 'UNDO' })).toBe(submitting) // …still refused
  })

  it('UNDO is ignored while an undo is already in flight', () => {
    const graded = rate(asking(3, 0), 3, 400, 'log-0')
    const undoing = sessionReducer(graded, { type: 'UNDO' })
    expect(undoing.undoing).toBe(true)
    expect(sessionReducer(undoing, { type: 'UNDO' })).toBe(undoing)
  })

  it('UNDO_OK rewinds index + results and lands on REVEALED (from ASKING)', () => {
    const graded = rate(asking(3, 0), 3, 4200, 'log-0')
    expect(graded.phase).toBe('ASKING')
    expect(graded.results).toHaveLength(1)
    const undone = sessionReducer(sessionReducer(graded, { type: 'UNDO' }), { type: 'UNDO_OK' })
    // Back on the rated card, answer already shown: re-rate, don't re-guess.
    expect(undone.phase).toBe('REVEALED')
    expect(undone.index).toBe(0)
    expect(undone.results).toEqual([])
    expect(undone.lastReview).toBeNull()
    expect(undone.undoing).toBe(false)
    expect(undone.submitError).toBe(false)
    expect(undone.pendingGrade).toBeNull()
  })

  it('UNDO_OK from SUMMARY resurrects the session on the last card', () => {
    const first = rate(asking(2, 0), 3, 100, 'log-0')
    const graded = rate(first, 1, 200, 'log-1')
    expect(graded.phase).toBe('SUMMARY')
    expect(graded.results).toHaveLength(2)
    const undone = sessionReducer(sessionReducer(graded, { type: 'UNDO' }), { type: 'UNDO_OK' })
    expect(undone.phase).toBe('REVEALED')
    expect(undone.index).toBe(1)
    // Only the LAST result is dropped — the first card stays graded.
    expect(undone.results).toEqual([{ cardId: 'c0', grade: 3, durationMs: 100 }])
    expect(undone.lastReview).toBeNull()
  })

  it('UNDO_OK is a no-op without a target', () => {
    const base = asking(3, 1)
    expect(sessionReducer(base, { type: 'UNDO_OK' })).toBe(base)
  })

  it('UNDO_FAIL clears both the flag and the target — a 409 is definitive', () => {
    const graded = rate(asking(3, 0), 3, 400, 'log-0')
    const undoing = sessionReducer(graded, { type: 'UNDO' })
    const failed = sessionReducer(undoing, { type: 'UNDO_FAIL' })
    expect(failed.undoing).toBe(false)
    expect(failed.lastReview).toBeNull()
    // Nothing was rewound: the rating stands.
    expect(failed.phase).toBe('ASKING')
    expect(failed.index).toBe(1)
    expect(failed.results).toHaveLength(1)
    // And it is never offered again.
    expect(sessionReducer(failed, { type: 'UNDO' })).toBe(failed)
  })

  it('nothing consumes the cursor while an undo is in flight (T-008)', () => {
    /** A graded card behind us, its undo POSTed and not yet acked. */
    function inFlight(phase: 'ASKING' | 'REVEALED'): SessionState {
      return {
        ...asking(3, 1),
        phase,
        results: [{ cardId: 'c0', grade: 3, durationMs: 100 }],
        lastReview: { cardId: 'c0', logId: 'log-0', grade: 3, index: 0 },
        undoing: true,
      }
    }

    // RATE would re-arm `lastReview` on c1 and desynchronise the pending UNDO_OK.
    const revealed = inFlight('REVEALED')
    expect(sessionReducer(revealed, { type: 'RATE', grade: 3, durationMs: 400 })).toBe(revealed)

    // SKIP_CARD would clear `lastReview` and make the pending UNDO_OK a no-op.
    const asking1 = inFlight('ASKING')
    expect(sessionReducer(asking1, { type: 'SKIP_CARD' })).toBe(asking1)
    expect(sessionReducer(revealed, { type: 'SKIP_CARD' })).toBe(revealed)

    // Control: the SAME states with the flag down still move — the guard reads
    // `undoing`, not the mere presence of an undo target.
    const settled: SessionState = { ...revealed, undoing: false }
    expect(sessionReducer(settled, { type: 'RATE', grade: 3, durationMs: 400 }).phase).toBe(
      'SUBMITTING',
    )
    expect(sessionReducer(settled, { type: 'SKIP_CARD' }).index).toBe(2)
    expect(sessionReducer({ ...asking1, undoing: false }, { type: 'SKIP_CARD' }).index).toBe(2)
  })

  it('neither the editor nor a restart opens while an undo is in flight (T-011)', () => {
    /** Same fixture as T-008: c0 graded, its undo POSTed and not yet acked. */
    function inFlight(phase: 'ASKING' | 'REVEALED'): SessionState {
      return {
        ...asking(3, 1),
        phase,
        results: [{ cardId: 'c0', grade: 3, durationMs: 100 }],
        lastReview: { cardId: 'c0', logId: 'log-0', grade: 3, index: 0 },
        undoing: true,
      }
    }

    // OPEN_EDIT: the pending UNDO_OK rewinds `index` WITHOUT closing the dialog,
    // which follows `cards[index]` and re-seeds its fields on the rewound card —
    // the typing in progress is lost and a save lands on the wrong card.
    const asking1 = inFlight('ASKING')
    expect(sessionReducer(asking1, { type: 'OPEN_EDIT' })).toBe(asking1)
    const revealed = inFlight('REVEALED')
    expect(sessionReducer(revealed, { type: 'OPEN_EDIT' })).toBe(revealed)

    // REVIEW_AGAIN: a restart drops `lastReview`, so the ack the server is about
    // to send would have nothing left to consume.
    const summary: SessionState = { ...inFlight('ASKING'), phase: 'SUMMARY', index: 3 }
    expect(sessionReducer(summary, { type: 'REVIEW_AGAIN', sessionNow: NOW })).toBe(summary)

    // Control: the SAME states with the flag down still act — the guard reads
    // `undoing`, not the mere presence of an undo target.
    expect(sessionReducer({ ...revealed, undoing: false }, { type: 'OPEN_EDIT' }).editing).toBe(
      true,
    )
    expect(
      sessionReducer({ ...summary, undoing: false }, { type: 'REVIEW_AGAIN', sessionNow: NOW })
        .phase,
    ).toBe('LOADING')
  })

  it('REVIEW_AGAIN clears the target — the previous lot is gone', () => {
    const graded = rate(asking(1, 0), 3, 100, 'log-0')
    expect(graded.phase).toBe('SUMMARY')
    const restarted = sessionReducer(graded, { type: 'REVIEW_AGAIN', sessionNow: NOW })
    expect(restarted.lastReview).toBeNull()
    expect(restarted.undoing).toBe(false)
  })
})
