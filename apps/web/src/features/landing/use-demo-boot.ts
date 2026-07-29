import { useCallback, useEffect, useRef, useState } from 'react'
import type { DemoSeedState, DemoSessionResponse, MeResponse } from '@engram/shared'
import { createDemoSession, fetchDemoSeedStatus, primeDemoAccount } from '@/lib/api'
import { supabase } from '@/lib/supabase'

/**
 * The demo entry sequence behind the landing's "Try the demo" CTA, and the
 * policy that decides whether a waiting window is shown at all.
 *
 * ─────────────────────────────────────────────────────────────── WHAT IT RUNS
 *
 * Three steps, in order, each one a real thing that happens and each one able to
 * fail on its own:
 *
 *  1. `session` — `POST /api/demo/session`. The public route signs in with the
 *     server's own credentials and hands back a token pair. Nothing is sent, and
 *     nothing is installed yet: at this point we merely HOLD a token.
 *  2. `prepare` — `GET /api/me`, carrying that token explicitly. This is NOT a
 *     probe: the demo middleware seeds the account on the first authenticated
 *     request that is not `GET /api/demo/status`, and it AWAITS the seeding
 *     transaction before the router sees the request. So this call resolving is
 *     the authoritative "the dataset is committed" signal — it IS the wait, not
 *     a proxy for it.
 *  3. `install` — `supabase.auth.setSession(...)`. Only now does the browser
 *     actually become signed in.
 *
 * ────────────────────────────────────────────── WHY `install` COMES LAST
 *
 * Two reasons, one structural and one about honesty.
 *
 *  - STRUCTURAL, and it is not negotiable: `routes/index.tsx` renders the
 *    landing for an unauthenticated visitor and the DASHBOARD for an
 *    authenticated one. Installing the session mid-sequence therefore unmounts
 *    the landing — and this window with it — the instant `setSession` resolves.
 *    Measured: with the install in the middle, the window could never reach its
 *    own third step on `/`. Ordering it last keeps the page (and the window)
 *    alive for the whole wait.
 *  - HONEST: the visitor is never signed into an account whose data is not
 *    there. Everything before the install is fully reversible — a failure leaves
 *    no session at all, which is the strongest reading of "a failure stays a
 *    clean failure, never a half-login".
 *
 * The token is usable before it is installed because `primeDemoAccount` and
 * `fetchDemoSeedStatus` take it explicitly (see `lib/api.ts`), so nothing here
 * depends on the ambient auth store having caught up.
 *
 * While step 2 is in flight we poll `GET /api/demo/status` for something honest
 * to display: `pending` (nothing started — we are paying the cold start or the
 * network), `seeding` (the server holds the seed's advisory lock RIGHT NOW,
 * observed in `pg_locks`, not guessed), `ready`. The poll only ever decides
 * success in the one case where it legitimately can: it reports `ready`, meaning
 * the marker for OUR session is committed.
 *
 * ─────────────────────────────────────────────── WHY THERE IS A WINDOW AT ALL
 *
 * Measured in production: 0.18 s for a reference authenticated call with no
 * seeding, 0.90 s for the real thing on a warm lambda, 2.84 s cold. The function
 * runs in Paris (it must — the database is there), so a distant visitor pays a
 * transatlantic round trip on top, on every one of those calls. The window
 * exists for that visitor.
 *
 * ──────────────────────────────────────────── AND WHY IT OFTEN NEVER APPEARS
 *
 * Nobody is ever made to wait for the window itself. There is no minimum
 * duration, no scripted sequence, no fake progress: it is scheduled, and if the
 * boot finishes first it is cancelled before it ever mounts.
 */

/**
 * How long the boot may run before the window is shown. The window is a cost —
 * it dims the page and takes focus — so it must only be paid by someone who is
 * actually waiting.
 *
 * 500 ms, because:
 *  - the CTA itself already went disabled with a pending label on click, so
 *    nothing is unexplained during this half-second;
 *  - it is ~2.8× the measured no-seed reference call (0.18 s), so a boot that
 *    somehow lands near the floor never even schedules a mount;
 *  - it is under the ~1 s at which a wait stops feeling like a click and starts
 *    feeling like a stall, so the visitor who does wait meets the window before
 *    wondering;
 *  - and it is short enough that the measured real cases (0.9 s warm, 2.84 s
 *    cold, plus the session round trip) all cross it — the window shows up for
 *    the people it was built for, and only for them.
 */
export const DEMO_BOOT_WINDOW_DELAY_MS = 500

/**
 * Once the window IS on screen, keep it for at least this long.
 *
 * This is the one place we add waiting, so it has to be argued. Opening and
 * closing a modal inside ~200 ms does not read as information, it reads as a
 * glitch — and the open animation (180 ms) would not even have finished, so the
 * visitor would watch a half-faded card vanish. 300 ms buys a complete open, a
 * readable "everything is done" final frame, and a clean close.
 *
 * The cost is bounded to a narrow band and is zero everywhere else: it can only
 * ever apply when the boot finishes between 500 ms and 800 ms. Under 500 ms the
 * window never appeared; over 800 ms the hold has already elapsed on its own.
 */
export const DEMO_BOOT_MIN_VISIBLE_MS = 300

/**
 * Hard deadline for the whole boot, from the click. Past it the window stops
 * pretending and says so.
 *
 * 20 s is deliberately far above anything healthy — ~7× the measured cold start
 * — because a deadline that can fire on a merely slow-but-working connection
 * would turn a working demo into an error message. It is also the point past
 * which a waiting visitor has certainly concluded the thing is broken, so it
 * must not be longer either. It exists so that no failure mode can leave this
 * window spinning forever: whatever happens, it resolves.
 */
export const DEMO_BOOT_DEADLINE_MS = 20_000

/**
 * Gap between two `GET /api/demo/status` reads. The seed itself costs ~0.7 s, so
 * this catches it in flight without turning a progress display into traffic; for
 * a distant visitor each poll is another round trip, which is why it is not
 * tighter.
 */
export const DEMO_BOOT_POLL_MS = 700

/** The three steps, in the order they run — also their display order. */
export const DEMO_BOOT_STEPS = ['session', 'prepare', 'install'] as const
export type DemoBootStep = (typeof DEMO_BOOT_STEPS)[number]

/** Which step a failure is attributed to, plus the deadline as its own kind. */
export type DemoBootFailure = DemoBootStep | 'timeout'

export type DemoBootState =
  | { phase: 'idle' }
  | {
      phase: 'working'
      step: DemoBootStep
      server: DemoSeedState | null
      /**
       * A step we deliberately did NOT complete — only ever `prepare`, and only
       * after the visitor pressed "enter anyway". Without it the window would
       * paint that step green on its way out, which is precisely the kind of
       * comfortable lie this whole surface refuses to tell.
       */
      skipped?: DemoBootStep | undefined
    }
  /** Everything done; we are holding the final frame before navigating. */
  | { phase: 'ready'; skipped?: DemoBootStep | undefined }
  | {
      phase: 'failed'
      failure: DemoBootFailure
      /** The step that was running when it went wrong. */
      step: DemoBootStep
      /**
       * True iff we still hold a usable token pair — i.e. the demo session was
       * granted and only the data (or the install) is missing. It decides
       * whether "enter anyway" is a real option or an empty promise.
       */
      resumable: boolean
      /** Same meaning as on `working` — a step we chose not to wait for. */
      skipped?: DemoBootStep | undefined
    }

/** Per-step display state. `todo` is "not started yet", `skipped` is "given up on". */
export type DemoBootStepStatus = 'done' | 'active' | 'todo' | 'failed' | 'skipped'

/**
 * Status of one step given the whole state. Pure, and exported so the display
 * cannot drift from the machine (and so it can be tested without React).
 */
export function demoBootStepStatus(state: DemoBootState, step: DemoBootStep): DemoBootStepStatus {
  const index = DEMO_BOOT_STEPS.indexOf(step)
  // Checked FIRST: a skipped step is never "done", whatever came after it.
  if (state.phase !== 'idle' && state.skipped === step) return 'skipped'
  if (state.phase === 'ready') return 'done'
  if (state.phase === 'idle') return 'todo'
  const current = DEMO_BOOT_STEPS.indexOf(state.step)
  if (index < current) return 'done'
  if (index > current) return 'todo'
  return state.phase === 'failed' ? 'failed' : 'active'
}

/** Resolve after `ms`, or as soon as `signal` aborts. Never rejects. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const id = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(id)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

export interface UseDemoBoot {
  state: DemoBootState
  /** Whether the waiting window is mounted. False for a boot that never waited. */
  windowOpen: boolean
  /** Run the sequence from the top. */
  start: () => void
  /** Re-run from the earliest step that still needs doing. */
  retry: () => void
  /** Give up: close the window and let the landing show the failure inline. */
  dismiss: () => void
  /** Sign in and go, without waiting for the server to confirm the data. */
  enterAnyway: () => void
}

export function useDemoBoot(opts: {
  /** Called once the browser is signed in and the demo is usable. */
  onEnter: () => void
  /** True while the landing should show its inline demo failure message. */
  onFailedChange: (failed: boolean) => void
  /** The `/api/me` payload the prepare step already paid for, to seed the cache. */
  onPrimed?: (me: MeResponse) => void
}): UseDemoBoot {
  const { onEnter, onFailedChange, onPrimed } = opts
  const [state, setState] = useState<DemoBootState>({ phase: 'idle' })
  const [windowOpen, setWindowOpen] = useState(false)

  // Everything below is a ref because the async runner must read the CURRENT
  // value, not the one captured when a render happened.
  const runIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  /** The granted-but-not-yet-installed token pair; null = nothing to resume. */
  const tokensRef = useRef<DemoSessionResponse | null>(null)
  /** When the window actually mounted, for the minimum-visible hold. */
  const shownAtRef = useRef<number | null>(null)
  /** The step running right now, readable from a timer callback (the deadline). */
  const stepRef = useRef<DemoBootStep>('session')
  /** Set when the visitor chose not to wait for `prepare`; cleared on any restart. */
  const skippedRef = useRef<DemoBootStep | undefined>(undefined)
  // Latest callbacks, so the runner never closes over a stale render's props.
  const cbRef = useRef({ onEnter, onFailedChange, onPrimed })
  cbRef.current = { onEnter, onFailedChange, onPrimed }

  /**
   * End the current attempt: invalidate every continuation still in flight
   * (`runIdRef` is the generation counter every async branch re-checks), abort
   * the requests, drop the timers. Called before starting, on every terminal
   * transition, and on unmount — so nothing can outlive its attempt.
   */
  const stopRun = useCallback(() => {
    runIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    for (const id of timersRef.current) clearTimeout(id)
    timersRef.current = []
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms))
  }, [])

  const begin = useCallback(
    (from: DemoBootStep) => {
      stopRun()
      const run = runIdRef.current
      const ac = new AbortController()
      abortRef.current = ac
      const alive = () => runIdRef.current === run
      cbRef.current.onFailedChange(false)

      /** Advance the visible step; `stepRef` mirrors it for the timer callbacks. */
      function working(step: DemoBootStep) {
        stepRef.current = step
        setState({ phase: 'working', step, server: null, skipped: skippedRef.current })
      }
      working(from)

      // Schedule the window unless it is already up (a retry keeps it, and must
      // not restart the "has it been visible long enough" clock).
      if (shownAtRef.current === null) {
        later(() => {
          if (!alive()) return
          shownAtRef.current = Date.now()
          setWindowOpen(true)
        }, DEMO_BOOT_WINDOW_DELAY_MS)
      }
      later(() => {
        if (alive()) fail('timeout', stepRef.current)
      }, DEMO_BOOT_DEADLINE_MS)

      /**
       * Terminal failure. If the window was never shown, we do NOT open one to
       * announce the failure: a fast, clean error belongs inline under the CTA
       * (where it already lived), not behind a modal the visitor never asked for.
       */
      function fail(failure: DemoBootFailure, step: DemoBootStep) {
        stopRun()
        setState({
          phase: 'failed',
          failure,
          step,
          resumable: tokensRef.current !== null,
          skipped: skippedRef.current,
        })
        if (shownAtRef.current === null) cbRef.current.onFailedChange(true)
      }

      /** Terminal success: hold the finished frame if the window is up, then go. */
      function succeed() {
        stopRun()
        setState({ phase: 'ready', skipped: skippedRef.current })
        const shownAt = shownAtRef.current
        const hold =
          shownAt === null ? 0 : Math.max(0, DEMO_BOOT_MIN_VISIBLE_MS - (Date.now() - shownAt))
        later(() => cbRef.current.onEnter(), hold)
      }

      /**
       * The two ways out of `prepare` — the priming call returning, or the probe
       * reporting `ready` — race, and whichever wins moves on exactly once.
       */
      let prepareSettled = false
      async function completePrepare() {
        if (prepareSettled || !alive()) return
        prepareSettled = true
        if (await install()) {
          if (alive()) succeed()
        }
      }

      /**
       * Mostly informational: it feeds the window the server's real state. A
       * failed read is NOT a failed boot — poll errors are swallowed and the last
       * known state stays on screen. It CAN finish the wait, in the one case
       * where it legitimately knows: `ready` means the marker for our own session
       * is committed, so there is nothing left to wait for even if the priming
       * call is still hanging.
       */
      async function poll(token: string) {
        while (alive() && !ac.signal.aborted && !prepareSettled) {
          try {
            const status = await fetchDemoSeedStatus(token, ac.signal)
            if (!alive()) return
            setState((prev) =>
              prev.phase === 'working' ? { ...prev, server: status.state } : prev,
            )
            if (status.state === 'ready') {
              void completePrepare()
              return
            }
          } catch {
            // keep waiting; the priming call and the deadline decide the outcome
          }
          await sleep(DEMO_BOOT_POLL_MS, ac.signal)
        }
      }

      /** Last step: the browser actually becomes signed in. */
      async function install(): Promise<boolean> {
        working('install')
        try {
          // The CTA only renders when a Supabase client exists; narrow for TS.
          if (!supabase) throw new Error('no supabase client')
          const { error } = await supabase.auth.setSession({
            access_token: tokensRef.current!.accessToken,
            refresh_token: tokensRef.current!.refreshToken,
          })
          if (error) throw error
          return true
        } catch {
          if (alive()) fail('install', 'install')
          return false
        }
      }

      async function prepare(token: string) {
        working('prepare')
        void poll(token)
        try {
          const me = await primeDemoAccount(token, ac.signal)
          if (!alive()) return
          cbRef.current.onPrimed?.(me)
        } catch {
          // An abort is our own doing (deadline, retry, dismiss, or the probe
          // having already won) — `alive()`/`prepareSettled` cover those, so only
          // a genuine failure reaches `fail`.
          if (alive() && !prepareSettled) fail('prepare', 'prepare')
          return
        }
        await completePrepare()
      }

      async function openSession() {
        try {
          tokensRef.current = await createDemoSession()
        } catch {
          if (alive()) fail('session', 'session')
          return
        }
        if (!alive()) return
        await prepare(tokensRef.current.accessToken)
      }

      if (from === 'install' && tokensRef.current) {
        void install().then((ok) => {
          if (ok && alive()) succeed()
        })
      } else if (from === 'prepare' && tokensRef.current) {
        void prepare(tokensRef.current.accessToken)
      } else {
        void openSession()
      }
    },
    [later, stopRun],
  )

  const start = useCallback(() => {
    tokensRef.current = null
    shownAtRef.current = null
    skippedRef.current = undefined
    begin('session')
  }, [begin])

  /**
   * Retry from the earliest step that is still owed. With a token pair already
   * granted there is nothing to re-open — a second `POST /demo/session` would
   * burn a rate-limit slot AND reset the account's seed marker, restarting the
   * very work we are waiting on — so a retry after `prepare` failed retries
   * exactly `prepare`.
   */
  const retry = useCallback(() => {
    if (!tokensRef.current) {
      skippedRef.current = undefined
      begin('session')
    } else if (stepRef.current === 'install') {
      begin('install')
    } else {
      // Retrying `prepare` means we are waiting for it again after all.
      skippedRef.current = undefined
      begin('prepare')
    }
  }, [begin])

  const dismiss = useCallback(() => {
    stopRun()
    setWindowOpen(false)
    shownAtRef.current = null
    skippedRef.current = undefined
    setState({ phase: 'idle' })
    // Nothing was installed (the install is the last step), so there is no
    // half-open session to explain — one honest "it did not work".
    cbRef.current.onFailedChange(true)
  }, [stopRun])

  /**
   * Skip the wait: install the session we were granted and go in. The account
   * may still be seeding — the app's own first request will queue behind it and
   * show its skeletons — which is exactly what the button says.
   */
  const enterAnyway = useCallback(() => {
    if (!tokensRef.current) return
    // Record what we are giving up on, so the last frame the visitor sees says
    // "not waited for" rather than quietly ticking a box that was never ticked.
    skippedRef.current = 'prepare'
    begin('install')
  }, [begin])

  useEffect(() => stopRun, [stopRun])

  return { state, windowOpen, start, retry, dismiss, enterAnyway }
}
