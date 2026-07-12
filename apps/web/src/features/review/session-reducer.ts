import type { Card, FsrsGrade } from '@engram/shared'

/**
 * Pure state machine for a review session (spec §11). No React, no effects, no
 * navigation — every transition is a total function of `(state, action)` so it
 * can be exhaustively unit-tested (spec §16.1). The hook `use-review-session`
 * owns all effects (fetch, prefetch, mutation, timers, keyboard, navigation)
 * and only ever *dispatches* the actions declared here.
 */

/** A rating produced by a session: 1 Again · 2 Hard · 3 Good · 4 Easy. */
export type Grade = FsrsGrade

export type Phase = 'LOADING' | 'ERROR' | 'EMPTY' | 'ASKING' | 'REVEALED' | 'SUBMITTING' | 'SUMMARY'

/** One graded card, the raw material of the end-of-session summary (spec §10.1). */
export interface RatingResult {
  cardId: string
  grade: Grade
  durationMs: number
}

export interface SessionState {
  phase: Phase
  cards: Card[]
  /** Server-reported total (may exceed `cards.length` for a >500 queue). */
  total: number
  /** Index of the current card; equals `cards.length` once the session ends. */
  index: number
  results: RatingResult[]
  /** Frozen `now` of the queue — a session works on one deterministic lot. */
  sessionNow: string
  /** Overlay B — tab hidden (spec §8.3). Orthogonal to `phase`. */
  paused: boolean
  /** Exit-confirm dialog open (spec §3.6). Orthogonal to `phase`. */
  confirmingExit: boolean
  /** Terminal flag — the hook navigates to the origin when this flips true. */
  exited: boolean
  /** A transient review POST failed; the card stays revealed for a retry. */
  submitError: boolean
  /** Grade + duration captured on RATE, applied on RATE_OK. */
  pendingGrade: Grade | null
  pendingDurationMs: number
}

export type Action =
  | { type: 'QUEUE_LOADED'; cards: Card[]; total: number }
  | { type: 'QUEUE_FAILED' }
  | { type: 'RETRY' }
  | { type: 'REVEAL' }
  | { type: 'RATE'; grade: Grade; durationMs: number }
  | { type: 'RATE_OK' }
  | { type: 'RATE_FAIL' }
  | { type: 'RATE_SKIP' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'REQUEST_EXIT' }
  | { type: 'CONFIRM_EXIT' }
  | { type: 'CANCEL_EXIT' }
  | { type: 'REVIEW_AGAIN'; sessionNow: string }

/** A fresh session state at `LOADING` for the given frozen `now`. */
export function initialState(sessionNow: string): SessionState {
  return {
    phase: 'LOADING',
    cards: [],
    total: 0,
    index: 0,
    results: [],
    sessionNow,
    paused: false,
    confirmingExit: false,
    exited: false,
    submitError: false,
    pendingGrade: null,
    pendingDurationMs: 0,
  }
}

/** Number of cards already graded (drives the exit-confirm guard, spec §3.6). */
export function reviewedCount(state: SessionState): number {
  return state.results.length
}

/** Advance past the current card; SUMMARY once every card is consumed. */
function advance(state: SessionState, results: RatingResult[]): SessionState {
  const index = state.index + 1
  return {
    ...state,
    results,
    index,
    pendingGrade: null,
    pendingDurationMs: 0,
    submitError: false,
    phase: index >= state.cards.length ? 'SUMMARY' : 'ASKING',
  }
}

export function sessionReducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'QUEUE_LOADED':
      if (state.phase !== 'LOADING') return state
      if (action.total === 0 || action.cards.length === 0) {
        return { ...state, phase: 'EMPTY', cards: [], total: action.total }
      }
      return { ...state, phase: 'ASKING', cards: action.cards, total: action.total, index: 0 }

    case 'QUEUE_FAILED':
      if (state.phase !== 'LOADING') return state
      return { ...state, phase: 'ERROR' }

    case 'RETRY':
      if (state.phase !== 'ERROR') return state
      return { ...state, phase: 'LOADING' }

    case 'REVEAL':
      // Space/Enter only reveals from ASKING; a no-op in every other phase.
      if (state.phase !== 'ASKING') return state
      return { ...state, phase: 'REVEALED' }

    case 'RATE':
      // Invariant (finding #9): RATE is accepted ONLY from REVEALED. Once in
      // SUBMITTING every further RATE is ignored — a single review in flight
      // per card, the guard that makes "await the ack" safe on a non-idempotent
      // endpoint.
      if (state.phase !== 'REVEALED') return state
      return {
        ...state,
        phase: 'SUBMITTING',
        pendingGrade: action.grade,
        pendingDurationMs: action.durationMs,
        submitError: false,
      }

    case 'RATE_OK': {
      if (state.phase !== 'SUBMITTING') return state
      const current = state.cards[state.index]
      if (!current || state.pendingGrade === null) return state
      const results = [
        ...state.results,
        { cardId: current.id, grade: state.pendingGrade, durationMs: state.pendingDurationMs },
      ]
      return advance(state, results)
    }

    case 'RATE_SKIP':
      // 404 — the card vanished (finding #8). Advance WITHOUT recording a
      // result: a deleted card is never counted in the summary.
      if (state.phase !== 'SUBMITTING') return state
      return advance(state, state.results)

    case 'RATE_FAIL':
      // Transient failure — stay on the card, re-enable the buttons for a retry.
      if (state.phase !== 'SUBMITTING') return state
      return { ...state, phase: 'REVEALED', submitError: true, pendingGrade: null }

    case 'PAUSE':
      return { ...state, paused: true }

    case 'RESUME':
      return { ...state, paused: false }

    case 'REQUEST_EXIT':
      // Precedence paused > confirmingExit (§11.4): while paused, a resume
      // consumes input, so REQUEST_EXIT is ignored (defensive guard).
      if (state.paused) return state
      if (reviewedCount(state) > 0) return { ...state, confirmingExit: true }
      return { ...state, exited: true }

    case 'CONFIRM_EXIT':
      return { ...state, exited: true }

    case 'CANCEL_EXIT':
      return { ...state, confirmingExit: false }

    case 'REVIEW_AGAIN':
      // Fresh lot, same scope (scope is a hook concern, not held here).
      if (state.phase !== 'SUMMARY') return state
      return initialState(action.sessionNow)

    default:
      return state
  }
}
