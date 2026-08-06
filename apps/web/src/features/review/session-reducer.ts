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

/**
 * The single rating `U` can still unwind. Captured on RATE_OK and dropped by any
 * action that moves past a card without grading it, so undo only ever reverses
 * the action IMMEDIATELY preceding it.
 */
export interface UndoTarget {
  cardId: string
  /** `review_log.id` of the graded review — the server's idempotency handle. */
  logId: string
  grade: Grade
  /** Index of the RATED card (pre-`advance`) — where UNDO_OK rewinds to. */
  index: number
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
  /** Card-edit dialog open (E). Orthogonal to `phase`; freezes the card clock. */
  editing: boolean
  /**
   * Quick-add dialog open (N) — the card the user realises is MISSING while
   * revising (T-032). Orthogonal to `phase` and to `editing`: it writes a new
   * card in some deck and never touches the card on screen, so the session state
   * underneath it is left exactly as it was. Freezes the card clock for the same
   * reason `editing` does — time spent writing a card is not recall time.
   */
  quickAdding: boolean
  /**
   * Index, into the CURRENT card's QCM options, of the one the user picked —
   * `null` when the card is not a multiple-choice question, or when nothing has
   * been picked on it yet (revealing with Space answers nothing).
   */
  selectedChoice: number | null
  /** Terminal flag — the hook navigates to the origin when this flips true. */
  exited: boolean
  /** A transient review POST failed; the card stays revealed for a retry. */
  submitError: boolean
  /** Grade + duration captured on RATE, applied on RATE_OK. */
  pendingGrade: Grade | null
  pendingDurationMs: number
  /** The one rating still undoable (`U`), or null when there is nothing to undo. */
  lastReview: UndoTarget | null
  /** An undo POST is in flight — the affordance is disabled until it settles. */
  undoing: boolean
}

export type Action =
  | { type: 'QUEUE_LOADED'; cards: Card[]; total: number }
  | { type: 'QUEUE_FAILED' }
  | { type: 'RETRY' }
  | { type: 'REVEAL' }
  | { type: 'SELECT_CHOICE'; index: number }
  | { type: 'RATE'; grade: Grade; durationMs: number }
  | { type: 'RATE_OK'; logId: string }
  | { type: 'RATE_FAIL' }
  | { type: 'RATE_SKIP' }
  | { type: 'SKIP_CARD' }
  | { type: 'UNDO' }
  | { type: 'UNDO_OK' }
  | { type: 'UNDO_FAIL' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'REQUEST_EXIT' }
  | { type: 'CONFIRM_EXIT' }
  | { type: 'CANCEL_EXIT' }
  | { type: 'REVIEW_AGAIN'; sessionNow: string }
  | { type: 'OPEN_EDIT' }
  | { type: 'CLOSE_EDIT' }
  | { type: 'OPEN_QUICK_ADD' }
  | { type: 'CLOSE_QUICK_ADD' }
  | { type: 'CARD_EDITED'; cardId: string; front: string; back: string }

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
    editing: false,
    quickAdding: false,
    selectedChoice: null,
    exited: false,
    submitError: false,
    pendingGrade: null,
    pendingDurationMs: 0,
    lastReview: null,
    undoing: false,
  }
}

/** Number of cards already graded (drives the exit-confirm guard, spec §3.6). */
export function reviewedCount(state: SessionState): number {
  return state.results.length
}

/**
 * Advance past the current card; SUMMARY once every card is consumed.
 *
 * `lastReview` is CLEARED here: moving on is itself an action, and `U` may only
 * reverse the one immediately before it — undoing a rating "through" a skip
 * would silently rewind the session two cards back. RATE_OK, the only transition
 * that produces an undo target, re-arms it right after this call.
 */
function advance(state: SessionState, results: RatingResult[]): SessionState {
  const index = state.index + 1
  return {
    ...state,
    results,
    index,
    pendingGrade: null,
    pendingDurationMs: 0,
    submitError: false,
    lastReview: null,
    // Another card comes up: an answer picked on the previous one would
    // otherwise light up an option of the new question.
    selectedChoice: null,
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
      // Space answers nothing: `selectedChoice` stays null, so the UI marks no
      // option as wrong when the user only wanted to see the answer.
      return { ...state, phase: 'REVEALED' }

    case 'SELECT_CHOICE':
      // Picking an option IS answering the question, and one answers only once:
      // accepted from ASKING, a no-op from every other phase (in particular
      // REVEALED, where the correct answer is already on screen).
      if (state.phase !== 'ASKING') return state
      // NOT guarded on `state.undoing`, deliberately — do not "fix" this
      // asymmetry with RATE / SKIP_CARD / OPEN_EDIT / REVIEW_AGAIN. What those
      // guards protect is the invariant "while an undo is in flight, nothing
      // moves the session cursor nor its content target". A selection moves
      // neither: it reveals the current card in place, exactly like REVEAL —
      // which is not guarded either. And UNDO_OK clears `selectedChoice`, so a
      // pick made in that window cannot survive onto the rewound card.
      // The selection is the revelation: one keystroke, both effects.
      return { ...state, selectedChoice: action.index, phase: 'REVEALED' }

    case 'RATE':
      // Invariant (finding #9): RATE is accepted ONLY from REVEALED. Once in
      // SUBMITTING every further RATE is ignored — a single review in flight
      // per card, the guard that makes "await the ack" safe on a non-idempotent
      // endpoint.
      if (state.phase !== 'REVEALED') return state
      // Refused while an undo is in flight, the mirror of the `inFlightRef` test
      // `undo()` already makes: a pending UNDO_OK is going to rewind the cursor
      // to `lastReview.index` and drop the LAST entry of `results`. Consuming the
      // current card meanwhile re-arms `lastReview` on it (RATE_OK), so the undo
      // would rewind onto the wrong card and unwind the wrong result — while the
      // server has unwound the original one.
      if (state.undoing) return state
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
      const grade = state.pendingGrade
      const results = [
        ...state.results,
        { cardId: current.id, grade, durationMs: state.pendingDurationMs },
      ]
      // The undo target is captured BEFORE `advance` moves the cursor: `index`
      // is the position of the card just rated, i.e. exactly where UNDO_OK has
      // to put the session back. Re-armed after `advance`, which clears it.
      const lastReview: UndoTarget = {
        cardId: current.id,
        logId: action.logId,
        grade,
        index: state.index,
      }
      return { ...advance(state, results), lastReview }
    }

    case 'RATE_SKIP':
      // 404 — the card vanished (finding #8). Advance WITHOUT recording a
      // result: a deleted card is never counted in the summary.
      if (state.phase !== 'SUBMITTING') return state
      return advance(state, state.results)

    case 'SKIP_CARD':
      // The user drops the current card (S / the "Passer" button). Client-side
      // only, session-scoped: nothing is written anywhere — no review is POSTed,
      // so the card keeps its past `due`, still counts in the due counts and
      // comes back in the next session. Deliberately NOT a server-side bury
      // (`due = now + 1d`): that would make a second writer of the FSRS columns
      // outside the scheduler, the very invariant the API protects.
      // It shares `advance(state, state.results)` with RATE_SKIP, which already
      // means exactly "move on WITHOUT recording a result": `total` is untouched
      // and the summary only ever counts graded cards.
      // Accepted from ASKING and REVEALED only — never from SUBMITTING, where a
      // review is already in flight for this card and its ack must land first.
      // Skipping also DROPS the undo target (see `advance`): after an S, `U`
      // must not reach back over it to unwind the rating before the skip.
      if (state.phase !== 'ASKING' && state.phase !== 'REVEALED') return state
      // Refused while an undo is in flight, same exclusion as RATE: both consume
      // the cursor through `advance`, which CLEARS `lastReview`. A skip slipped in
      // before the ack would turn the pending UNDO_OK into a silent no-op even
      // though the server really did unwind the review — the result stays in
      // `results` and the summary over-counts.
      if (state.undoing) return state
      return advance(state, state.results)

    case 'UNDO':
      // Accepted mid-session (ASKING / REVEALED) and from SUMMARY — a rating
      // that ended the session is exactly the one most worth taking back.
      // Refused from SUBMITTING: a review is already in flight, and undoing the
      // PREVIOUS one while the next is being written would race two mutations of
      // the same FSRS row. `undoing` makes a second U a no-op.
      if (state.phase !== 'ASKING' && state.phase !== 'REVEALED' && state.phase !== 'SUMMARY') {
        return state
      }
      if (!state.lastReview || state.undoing) return state
      return { ...state, undoing: true }

    case 'UNDO_OK': {
      // The server unwound the log: rewind to the rated card and drop its result.
      // We land on REVEALED, not ASKING — the user has already seen the answer,
      // so asking them to "guess again" would be theatre; what they came back
      // for is to RE-RATE (Anki's behaviour).
      const target = state.lastReview
      if (!target) return state
      return {
        ...state,
        phase: 'REVEALED',
        index: target.index,
        results: state.results.slice(0, -1),
        lastReview: null,
        undoing: false,
        submitError: false,
        pendingGrade: null,
        pendingDurationMs: 0,
        // This transition MOVES `index`: a selection kept here would belong to
        // the card the session was on, not to the one it rewinds to, and the UI
        // would mark an option of a different question as the user's answer.
        selectedChoice: null,
      }
    }

    case 'UNDO_FAIL':
      // The server refused (409 — stale log, already undone, outside its
      // window). That is DEFINITIVE, never transient: the target is dropped so
      // the affordance disappears instead of inviting a retry that cannot work.
      return { ...state, undoing: false, lastReview: null }

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
      // Refused while an undo is in flight, third face of the same invariant as
      // RATE and SKIP_CARD: a restart throws the whole state away, `lastReview`
      // included, so the pending ack lands on a session that no longer holds the
      // target it was fired for — UNDO_OK degrades to a silent no-op while the
      // server really did unwind the review, and the mutation's `onSuccess`
      // reseeds the card clock of the card the NEW lot has just started.
      if (state.undoing) return state
      return initialState(action.sessionNow)

    case 'OPEN_EDIT':
      // Only where a card is actually on screen and no review is in flight —
      // same window as SKIP_CARD (ASKING / REVEALED), never from SUBMITTING.
      if (state.phase !== 'ASKING' && state.phase !== 'REVEALED') return state
      // Refused while an undo is in flight: UNDO_OK moves `index` back to
      // `lastReview.index` and deliberately does NOT touch `editing`, so an
      // already-open dialog would follow the cursor — it renders `cards[index]`
      // and re-seeds its fields on every card identity change. The undo would
      // overwrite the text being typed with the rewound card's content, and a
      // save would then write onto THAT card (`submitEdit` re-reads
      // `cards[index]` at submit time), not the one being corrected.
      if (state.undoing) return state
      // Symmetric to the test OPEN_QUICK_ADD makes on `editing`: one dialog at a
      // time, so the card clock has exactly one freeze to lift.
      if (state.quickAdding) return state
      return { ...state, editing: true }

    case 'CLOSE_EDIT':
      if (!state.editing) return state
      return { ...state, editing: false }

    case 'OPEN_QUICK_ADD':
      // Same window as OPEN_EDIT — ASKING / REVEALED — and for a reason that has
      // nothing to do with the card being edited (this dialog edits none): the
      // per-card clock is re-created by an effect keyed on `[phase, index]`,
      // which seeds itself from `paused` ALONE. A dialog left open across a
      // phase change would therefore get a brand-new timer running while the
      // user is typing, and the freeze this dialog installs would be lost. The
      // two transitions that can move the cursor under an open dialog are
      // RATE_OK (only from SUBMITTING) and UNDO_OK (only while `undoing`), so
      // refusing those two states is exactly what makes the freeze hold.
      if (state.phase !== 'ASKING' && state.phase !== 'REVEALED') return state
      if (state.undoing) return state
      // Never on top of the pause overlay: while paused ANY key resumes, so a
      // dialog opened here would sit behind an overlay that has already eaten
      // its keystrokes.
      if (state.paused) return state
      // One dialog at a time. Unreachable through the UI (Radix makes the
      // surface behind it inert, and the key router returns early while a modal
      // is open), stated anyway so the invariant does not depend on Radix.
      if (state.editing) return state
      return { ...state, quickAdding: true }

    case 'CLOSE_QUICK_ADD':
      if (!state.quickAdding) return state
      return { ...state, quickAdding: false }

    case 'CARD_EDITED': {
      // Patch the array the session actually RENDERS. The queue is frozen
      // (`staleTime: Infinity`), so no refetch will ever bring the new text in:
      // this write is what refreshes the screen. Only `front`/`back` move — the
      // spread carries `fsrs` over BY REFERENCE, so an edit can never be
      // mistaken for a scheduling event.
      if (!state.cards.some((c) => c.id === action.cardId)) return state
      const cards = state.cards.map((c) =>
        c.id === action.cardId ? { ...c, front: action.front, back: action.back } : c,
      )
      // Editing the card ON SCREEN rewrites the very question that was answered:
      // `selectedChoice` is a raw index, bound to no option identity, so a pick
      // kept across the edit would mark "your answer" on an option the user
      // never saw — an edit is allowed from REVEALED, and may turn the card into
      // an entirely different question. Editing ANOTHER card of the lot leaves
      // the displayed one alone, so the selection still belongs to it.
      const selectedChoice =
        action.cardId === state.cards[state.index]?.id ? null : state.selectedChoice
      return { ...state, cards, selectedChoice }
    }

    default:
      return state
  }
}
