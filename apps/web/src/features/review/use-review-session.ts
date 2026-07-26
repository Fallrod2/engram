import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import type { Card, ReviewPreview, ReviewQueueResponse } from '@engram/shared'
import { ApiError, postReview, updateCard, type ReviewScope } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { isEditableTarget, isModalSurfaceOpen } from '@/lib/use-hotkeys'
import {
  initialState,
  sessionReducer,
  type Grade,
  type Phase,
  type SessionState,
} from './session-reducer'
import { useT } from '@/lib/i18n'
import { createCardTimer, IDLE_MS, type CardTimer } from './session-timer'
import { againProbeOptions, previewOptions, queueOptions } from './queries'
import { computeSummary, type SessionSummary } from './summary'
import { remainingByState, type RemainingByState } from './queue-stats'

export interface SessionApi {
  phase: Phase
  scope: ReviewScope
  current: Card | undefined
  /** True while the verso is shown (REVEALED or SUBMITTING). */
  revealed: boolean
  submitting: boolean
  submitError: boolean
  preview: ReviewPreview | undefined
  progress: { done: number; total: number }
  counts: Record<Grade, number>
  /** FSRS breakdown of the cards still ahead (current card included). */
  remaining: RemainingByState
  paused: boolean
  confirmingExit: boolean
  /** Card-edit dialog open (E) — the card clock is frozen while it is. */
  editing: boolean
  flashGrade: Grade | null
  summary: SessionSummary | undefined
  canReviewAgain: boolean
  reduce: boolean
  reveal: () => void
  rate: (grade: Grade) => void
  /** Drop the current card without rating it (client-side, session-scoped). */
  skip: () => void
  /** Open the card-edit dialog on the current card (E). */
  openEdit: () => void
  /** Close the card-edit dialog without saving. */
  closeEdit: () => void
  /** Persist an edit of the current card's content (never its FSRS state). */
  submitEdit: (values: { front: string; back: string }) => void
  requestExit: () => void
  confirmExit: () => void
  cancelExit: () => void
  resume: () => void
  retryQueue: () => void
  reviewAgain: () => void
}

function isFlowPhase(p: Phase): boolean {
  return p === 'ASKING' || p === 'REVEALED' || p === 'SUBMITTING'
}

/**
 * The session engine (spec §11.3). Owns the reducer plus every effect — queue
 * fetch, interval prefetch, review mutation, per-card timer, idle/visibility
 * pause, global keyboard, end-of-session invalidations and navigation — and
 * only ever dispatches the pure actions of `session-reducer`.
 */
export function useReviewSession(scope: ReviewScope): SessionApi {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const reduce = !!useReducedMotion()
  const t = useT()

  const [initialNow] = useState(() => new Date().toISOString())
  const [state, dispatch] = useReducer(sessionReducer, initialNow, initialState)

  // Always-current snapshot so stable callbacks read fresh state (keyboard,
  // toast retry, visibility) without re-subscribing every render.
  const stateRef = useRef(state)
  stateRef.current = state

  const timerRef = useRef<CardTimer | null>(null)
  const mutateRef = useRef<(vars: { cardId: string; grade: Grade; durationMs: number }) => void>(
    () => {},
  )
  const lastRateRef = useRef<{ cardId: string; grade: Grade } | null>(null)
  // Synchronous in-flight guard (finding #9 at the wired-up level): set inside
  // `rate()` before it returns and cleared only when the mutation settles, so
  // several rating keydowns dispatched in the SAME tick — before React re-runs
  // render and refreshes `stateRef` — can never fire more than one POST for the
  // card. The reducer's SUBMITTING guard alone can't stop this: the network
  // call is not gated by post-dispatch state, so it would escape the safeguard.
  const inFlightRef = useRef(false)
  const invalidatedRef = useRef(false)
  const flashTimeoutRef = useRef<number | null>(null)

  const [flashGrade, setFlashGrade] = useState<Grade | null>(null)
  // Per-card `now` for the preview (default sessionNow); bumped for the current
  // card on resume from a long pause (finding #6).
  const [previewNowByCard, setPreviewNowByCard] = useState<Record<string, string>>({})

  const current = state.cards[state.index]

  // --- Queue (frozen) ------------------------------------------------------
  const queue = useQuery(queueOptions(scope, state.sessionNow))

  useEffect(() => {
    if (state.phase !== 'LOADING' || queue.isFetching) return
    if (queue.isSuccess) {
      dispatch({ type: 'QUEUE_LOADED', cards: queue.data.cards, total: queue.data.total })
    } else if (queue.isError) {
      dispatch({ type: 'QUEUE_FAILED' })
    }
  }, [state.phase, queue.isFetching, queue.isSuccess, queue.isError, queue.data])

  // --- Preview (current + prefetch of i and i+1) ---------------------------
  const currentPreviewNow = current
    ? (previewNowByCard[current.id] ?? state.sessionNow)
    : state.sessionNow

  const previewQuery = useQuery({
    ...previewOptions(current?.id ?? '__none__', currentPreviewNow),
    enabled: !!current && isFlowPhase(state.phase),
  })

  useEffect(() => {
    if (state.phase !== 'ASKING' && state.phase !== 'REVEALED') return
    for (const c of [state.cards[state.index], state.cards[state.index + 1]]) {
      if (!c) continue
      const now = previewNowByCard[c.id] ?? state.sessionNow
      void queryClient.prefetchQuery(previewOptions(c.id, now))
    }
  }, [state.phase, state.index, state.cards, state.sessionNow, previewNowByCard, queryClient])

  const bumpCurrentPreview = useCallback(() => {
    const s = stateRef.current
    const c = s.cards[s.index]
    if (!c) return
    setPreviewNowByCard((m) => ({ ...m, [c.id]: new Date().toISOString() }))
  }, [])

  // --- Per-card active-time timer ------------------------------------------
  // A fresh timer per card, seeded from the machine's CURRENT pause (finding
  // #10): a card entered while the tab is hidden starts paused.
  useEffect(() => {
    if (state.phase !== 'ASKING') return
    timerRef.current = createCardTimer(state.paused)
  }, [state.phase, state.index])

  // Two independent reasons to freeze the card clock, one effect so a pause
  // always wins over a resume: the tab being hidden, and the edit dialog being
  // open — time spent fixing a typo is not recall time. Closing the dialog on a
  // hidden tab therefore does NOT restart the clock.
  useEffect(() => {
    const t = timerRef.current
    if (!t) return
    if (state.paused || state.editing) t.pause()
    else t.resume()
  }, [state.paused, state.editing])

  // --- Idle (mechanism A): silent stop, no overlay, auto-resume ------------
  // Disarmed while editing: the dialog owns the keyboard, so its keystrokes are
  // not presence signals for the *card* — and a `resume()` from here would
  // undo the freeze the edit dialog just installed.
  useEffect(() => {
    if (!isFlowPhase(state.phase) || state.paused || state.editing) return
    let idlePaused = false
    let timeout = window.setTimeout(onIdle, IDLE_MS)
    function onIdle() {
      idlePaused = true
      timerRef.current?.pauseIdle()
    }
    function onActivity() {
      if (idlePaused) {
        idlePaused = false
        timerRef.current?.resume()
        bumpCurrentPreview()
      }
      window.clearTimeout(timeout)
      timeout = window.setTimeout(onIdle, IDLE_MS)
    }
    const events = ['keydown', 'pointermove', 'pointerdown', 'wheel', 'scroll'] as const
    for (const e of events) window.addEventListener(e, onActivity, { passive: true })
    return () => {
      window.clearTimeout(timeout)
      for (const e of events) window.removeEventListener(e, onActivity)
    }
  }, [state.phase, state.index, state.paused, state.editing, bumpCurrentPreview])

  // --- Visibility (mechanism B): explicit pause + overlay ------------------
  useEffect(() => {
    function onVis() {
      const s = stateRef.current
      if (document.hidden && isFlowPhase(s.phase) && !s.paused) dispatch({ type: 'PAUSE' })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // --- Review mutation (await the ack before advancing, §6.3) --------------
  const reviewMut = useMutation({
    mutationFn: (vars: { cardId: string; grade: Grade; durationMs: number }) =>
      postReview(vars.cardId, { grade: vars.grade, durationMs: vars.durationMs }),
    onSuccess: () => dispatch({ type: 'RATE_OK' }),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 404) {
        // The card vanished (deleted in parallel) — skip without counting.
        toast(t('toasts.cardGone'))
        dispatch({ type: 'RATE_SKIP' })
        return
      }
      dispatch({ type: 'RATE_FAIL' })
      toast.error(t('toasts.reviewSaveError'), {
        action: { label: t('common.retry'), onClick: () => retryRef.current() },
      })
    },
    onSettled: () => {
      // Mutation resolved (ok/skip/fail) — the card is no longer in flight, so
      // the next rating (or a retry after a transient failure) may submit.
      inFlightRef.current = false
    },
  })
  mutateRef.current = reviewMut.mutate

  // --- Commands ------------------------------------------------------------
  const reveal = useCallback(() => {
    if (stateRef.current.phase === 'ASKING') dispatch({ type: 'REVEAL' })
  }, [])

  const rate = useCallback((grade: Grade) => {
    const s = stateRef.current
    if (s.phase !== 'REVEALED') return
    // `stateRef` only refreshes on render; two same-tick rate() calls both read
    // `phase: REVEALED`, so the phase check alone can't stop a double submit.
    // This synchronous ref does — it flips to true before the first call ever
    // returns and is only cleared when the mutation settles (see onSettled).
    if (inFlightRef.current) return
    const card = s.cards[s.index]
    if (!card) return
    inFlightRef.current = true
    const durationMs = timerRef.current?.read() ?? 0
    lastRateRef.current = { cardId: card.id, grade }
    setFlashGrade(grade)
    if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = window.setTimeout(() => setFlashGrade(null), 160)
    dispatch({ type: 'RATE', grade, durationMs })
    mutateRef.current({ cardId: card.id, grade, durationMs })
  }, [])

  const skip = useCallback(() => {
    const s = stateRef.current
    if (s.phase !== 'ASKING' && s.phase !== 'REVEALED') return
    // No POST, no `inFlightRef`, nothing read off the timer: a skipped card
    // produces no `RatingResult`, so its duration is never needed. The next
    // card gets a fresh `createCardTimer` from the same effect that serves a
    // rating — it is keyed on `[state.phase, state.index]`, and SKIP_CARD
    // always lands on ASKING at `index + 1` (or on SUMMARY, where there is no
    // card left to time).
    dispatch({ type: 'SKIP_CARD' })
  }, [])

  // --- Card edit (E) -------------------------------------------------------
  /**
   * Second half of the double write: the frozen queue in the cache. Its entry
   * is never refetched (`staleTime: Infinity`, `gcTime: 0`), so without this a
   * REVIEW_AGAIN — a new `sessionNow`, hence a new key seeded from the server —
   * or a remount would resurrect the stale text. Only `front`/`back` of the one
   * card move; `now`, `total` and every other card are carried over untouched.
   */
  const patchQueueCache = useCallback(
    (cardId: string, front: string, back: string) => {
      const key = qk.review.queue({ ...scope, now: stateRef.current.sessionNow })
      queryClient.setQueryData<ReviewQueueResponse>(key, (old) =>
        old
          ? {
              ...old,
              cards: old.cards.map((c) => (c.id === cardId ? { ...c, front, back } : c)),
            }
          : old,
      )
    },
    [queryClient, scope],
  )

  const editMut = useMutation({
    mutationFn: (vars: {
      cardId: string
      deckId: string
      front: string
      back: string
      prevFront: string
      prevBack: string
    }) => updateCard(vars.cardId, { front: vars.front, back: vars.back }),
    // The pre-edit text travels as the mutation's context — the only copy left
    // once the optimistic write has overwritten both the reducer and the cache.
    onMutate: (vars) => ({ front: vars.prevFront, back: vars.prevBack }),
    onError: (_err, vars, ctx) => {
      if (ctx) {
        dispatch({ type: 'CARD_EDITED', cardId: vars.cardId, front: ctx.front, back: ctx.back })
        patchQueueCache(vars.cardId, ctx.front, ctx.back)
      }
      toast.error(t('toasts.cardUpdateError'))
    },
    onSettled: (_data, _err, vars) => {
      // The deck's card list holds the same rows; `cards.all` covers every other
      // reader (detail, counts) without enumerating them.
      void queryClient.invalidateQueries({ queryKey: qk.cards.listByDeck(vars.deckId) })
      void queryClient.invalidateQueries({ queryKey: qk.cards.all })
    },
  })
  const editMutateRef = useRef(editMut.mutate)
  editMutateRef.current = editMut.mutate

  const openEdit = useCallback(() => dispatch({ type: 'OPEN_EDIT' }), [])
  const closeEdit = useCallback(() => dispatch({ type: 'CLOSE_EDIT' }), [])

  const submitEdit = useCallback(
    (values: { front: string; back: string }) => {
      const s = stateRef.current
      const card = s.cards[s.index]
      if (!card) return
      const front = values.front.trim()
      const back = values.back.trim()
      if (front === card.front && back === card.back) return
      // Optimistic, in the order that matters: the rendered array first (that is
      // what the user sees), then the frozen queue behind it.
      dispatch({ type: 'CARD_EDITED', cardId: card.id, front, back })
      patchQueueCache(card.id, front, back)
      editMutateRef.current({
        cardId: card.id,
        deckId: card.deckId,
        front,
        back,
        prevFront: card.front,
        prevBack: card.back,
      })
    },
    [patchQueueCache],
  )

  const retryRef = useRef<() => void>(() => {})
  retryRef.current = () => {
    const last = lastRateRef.current
    const s = stateRef.current
    if (last && s.phase === 'REVEALED' && s.cards[s.index]?.id === last.cardId) rate(last.grade)
  }

  const requestExit = useCallback(() => {
    if (stateRef.current.paused) return
    dispatch({ type: 'REQUEST_EXIT' })
  }, [])
  const confirmExit = useCallback(() => dispatch({ type: 'CONFIRM_EXIT' }), [])
  const cancelExit = useCallback(() => dispatch({ type: 'CANCEL_EXIT' }), [])

  const resume = useCallback(() => {
    if (!stateRef.current.paused) return
    dispatch({ type: 'RESUME' })
    bumpCurrentPreview() // realign the current interval at the real resume `now`
  }, [bumpCurrentPreview])

  const retryQueue = useCallback(() => {
    dispatch({ type: 'RETRY' })
    void queue.refetch()
  }, [queue])

  const reviewAgain = useCallback(() => {
    invalidatedRef.current = false
    setPreviewNowByCard({})
    dispatch({ type: 'REVIEW_AGAIN', sessionNow: new Date().toISOString() })
  }, [])

  // --- End-of-session invalidations (batch once, §13.3) --------------------
  const endSession = useCallback(() => {
    if (invalidatedRef.current) return
    if (stateRef.current.results.length === 0) return
    invalidatedRef.current = true
    void queryClient.invalidateQueries({ queryKey: qk.dueCounts.all })
    void queryClient.invalidateQueries({ queryKey: qk.subjects.all })
    void queryClient.invalidateQueries({ queryKey: qk.decks.all })
    void queryClient.invalidateQueries({ queryKey: qk.cards.all })
    // Graded cards shift their `due` → the study-plan load and "today" suggestion
    // rebalance in real time (Phase 4 §1.4).
    void queryClient.invalidateQueries({ queryKey: qk.planning.all })
    // Each review is a row in `review_log` — the raw material of every analytic.
    // A finished session refreshes tiles + heatmap + graphs (Phase 5 §1.6).
    void queryClient.invalidateQueries({ queryKey: qk.analytics.all })
  }, [queryClient])

  useEffect(() => {
    if (state.phase === 'SUMMARY') endSession()
  }, [state.phase, endSession])

  // Whether the session was entered from an in-app navigation (there is an
  // internal parent to return to). Captured ONCE at mount (spec §3.6, "on
  // mémorise l'origine au montage"). We use TanStack Router's OWN history
  // index — `canGoBack()` is `state.__TSR_index !== 0`, and a fresh/direct
  // entry (bookmark, shared link, new tab) initializes `__TSR_index: 0`. This
  // is reliable where `window.history.length` is not: the latter also counts
  // browser entries that precede the SPA load, so a direct entry into /review
  // could report length > 1 and wrongly `back()` out of the app entirely.
  const [enteredFromApp] = useState(() => router.history.canGoBack())

  const goToOrigin = useCallback(() => {
    if (enteredFromApp) router.history.back()
    else void navigate({ to: '/' })
  }, [enteredFromApp, router, navigate])

  useEffect(() => {
    if (!state.exited) return
    endSession()
    goToOrigin()
  }, [state.exited, endSession, goToOrigin])

  // --- Global keyboard router (spec §3.8, §11.4) ---------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Precedence 0: a text field or an open Radix modal surface owns the
      // keyboard. Without this, typing "3" in the edit dialog's textarea would
      // rate the card behind it. Returning early also leaves Escape untouched,
      // so Radix keeps closing its own dialog.
      if (isEditableTarget(e.target) || isModalSurfaceOpen()) return
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
      const s = stateRef.current

      // Precedence 1: pause overlay consumes every key → resume.
      if (s.paused) {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        e.preventDefault()
        resume()
        return
      }
      // Precedence 2: exit-confirm dialog.
      if (s.confirmingExit) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault()
          cancelExit()
        } else if (e.key.toLowerCase() === 'q') {
          e.preventDefault()
          confirmExit()
        }
        return
      }

      switch (s.phase) {
        case 'ASKING':
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            reveal()
          } else if (e.key.toLowerCase() === 's') {
            e.preventDefault()
            skip()
          } else if (e.key.toLowerCase() === 'e') {
            e.preventDefault()
            openEdit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            requestExit()
          }
          break
        case 'REVEALED':
          if (e.key >= '1' && e.key <= '4') {
            e.preventDefault()
            rate(Number(e.key) as Grade)
          } else if (e.key.toLowerCase() === 's') {
            e.preventDefault()
            skip()
          } else if (e.key.toLowerCase() === 'e') {
            e.preventDefault()
            openEdit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            requestExit()
          }
          break
        case 'SUBMITTING':
          if (e.key === 'Escape') {
            e.preventDefault()
            requestExit()
          }
          break
        case 'SUMMARY':
          if (e.key === 'Escape' || e.key === 'Enter') {
            e.preventDefault()
            confirmExit()
          } else if (e.key.toLowerCase() === 'r') {
            e.preventDefault()
            reviewAgain()
          }
          break
        case 'LOADING':
        case 'EMPTY':
        case 'ERROR':
          if (e.key === 'Escape') {
            e.preventDefault()
            requestExit()
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reveal, rate, skip, openEdit, requestExit, confirmExit, cancelExit, resume, reviewAgain])

  // Clear the pending flash timeout on unmount.
  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current)
    }
  }, [])

  // --- "Review again" probe (fired on entering SUMMARY) --------------------
  const [probeNow, setProbeNow] = useState<string | null>(null)
  useEffect(() => {
    setProbeNow(state.phase === 'SUMMARY' ? new Date().toISOString() : null)
  }, [state.phase])
  const probe = useQuery({
    ...againProbeOptions(scope, probeNow ?? '__none__'),
    enabled: state.phase === 'SUMMARY' && probeNow !== null,
  })
  const canReviewAgain = state.phase === 'SUMMARY' && probe.isSuccess && probe.data.total >= 1

  // --- Derived view state --------------------------------------------------
  const counts = useMemo<Record<Grade, number>>(() => {
    const c: Record<Grade, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
    for (const r of state.results) c[r.grade] += 1
    return c
  }, [state.results])

  const remaining = useMemo(
    () => remainingByState(state.cards, state.index),
    [state.cards, state.index],
  )

  const summary = useMemo(
    () => (state.phase === 'SUMMARY' ? computeSummary(state.results) : undefined),
    [state.phase, state.results],
  )

  return {
    phase: state.phase,
    scope,
    current,
    revealed: state.phase === 'REVEALED' || state.phase === 'SUBMITTING',
    submitting: state.phase === 'SUBMITTING',
    submitError: state.submitError,
    preview: previewQuery.data,
    progress: { done: state.index, total: state.cards.length },
    counts,
    remaining,
    paused: state.paused,
    confirmingExit: state.confirmingExit,
    editing: state.editing,
    flashGrade,
    summary,
    canReviewAgain,
    reduce,
    reveal,
    rate,
    skip,
    openEdit,
    closeEdit,
    submitEdit,
    requestExit,
    confirmExit,
    cancelExit,
    resume,
    retryQueue,
    reviewAgain,
  }
}

export type { SessionState }
