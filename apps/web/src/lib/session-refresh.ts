import { isAuthRefreshDiscardedError, isAuthRetryableFetchError } from '@supabase/supabase-js'

/**
 * Token revival on the moments a timer cannot see.
 *
 * ═══ THE BUG ═══
 *
 * Alex is signed out after ~30 min away. Measured on a real production token:
 * `exp - iat = 3600`, so the JWT lifetime is the default hour, NOT a 30-minute
 * setting. Nothing to change server-side. What breaks is the CLIENT clock.
 *
 * supabase-js keeps the access token alive with `setInterval` (30 s ticks,
 * refresh when the token is within 90 s of expiry). A browser throttles that
 * interval in a background tab and macOS suspends it outright when the machine
 * sleeps. Come back an hour later, the ticker has fired a handful of times or
 * not at all, the token is long dead, and the FIRST request out of the app
 * takes a 401 — which `api.ts` turns into `forceSignOut()`. Hence "it logged me
 * out while I was away".
 *
 * ═══ WHAT THE LIBRARY ALREADY DOES (and why this file is still needed) ═══
 *
 * auth-js 2.110 is not naive here: it registers its own `visibilitychange`
 * listener, stops the ticker when the tab goes hidden, restarts it (with an
 * immediate tick) when it comes back, and runs `_recoverAndRefresh()` on the
 * hidden → visible edge. That covers "switched tabs".
 *
 * It does NOT cover the two ways a session comes back to life WITHOUT the
 * visibility ever changing:
 *
 *   · **The machine slept with this tab in front.** `document.visibilityState`
 *     was `visible` before the sleep and is `visible` after it — no transition,
 *     so no `visibilitychange`, so nothing recovers. The only thing left is the
 *     resumed interval, which is 30 s late at best. Every request fired in that
 *     window 401s. This is the reported symptom, exactly.
 *   · **The network came back.** auth-js never listens to `online`. A refresh
 *     that failed while offline is retried on the next tick at the earliest.
 *
 * So this module adds the missing TRIGGERS — `focus` and `online`, plus
 * `visibilitychange` as the belt to auth-js's braces — and reuses the library's
 * own `refreshSession()` for the actual work. We do not reimplement the token
 * exchange, the rotation, the cross-tab commit guard, or the failure cooldown;
 * we only add *when to ask*.
 *
 * ═══ WHY `refreshSession()` AND NOT `startAutoRefresh()` ═══
 *
 * `auth.startAutoRefresh()` is the API the docs point at for this shape of
 * problem, and it would half-work: it restarts the ticker and runs one tick
 * immediately. It is the wrong tool here for two reasons.
 *
 *   1. It returns `Promise<void>`. A refresh that fails because the REFRESH
 *      token itself is dead (revoked, rotated away, expired) is invisible to
 *      the caller — and handling that case is half the point: the user must
 *      land on /login, not on a screen quietly stacking 401s. `refreshSession()`
 *      hands back `{ error }`, so the outcome is decidable.
 *   2. It always writes. It tears down and rebuilds the ticker on every call,
 *      whatever the session's state — and in a browser that ticker is auth-js's
 *      own property, driven by its own visibility handler. Restarting it from
 *      outside means two owners for one timer. Asking for a refresh leaves the
 *      ticker alone.
 *
 * Both calls funnel into the same `_callRefreshToken`, so `refreshSession()` is
 * not a "manual" path — it is the same machinery, entered where the result is
 * observable.
 */

/**
 * How close to expiry counts as "refresh it now", in ms.
 *
 * Deliberately the same 90 s as auth-js's own `EXPIRY_MARGIN_MS` (3 ticks ×
 * 30 s). The constant is internal to the package and not importable, so it is
 * restated here rather than guessed at: the revival path and the ticker must
 * agree on what "about to expire" means, or a wake-up would refresh a token the
 * ticker considers fine (or, worse, decline to refresh one it would have).
 */
export const REFRESH_MARGIN_MS = 90_000

export interface RefreshDecisionInput {
  /**
   * `expires_at` of the session the store is holding — SECONDS since the epoch,
   * which is what Supabase puts in the session object. `null`/`undefined` means
   * no session (signed out, or auth disabled).
   */
  expiresAt: number | null | undefined
  /** `Date.now()` at the moment of the decision, in ms. */
  nowMs: number
  /** True while a refresh started by this watcher has not settled yet. */
  refreshInFlight: boolean
}

/**
 * Should the app ask for a new access token right now?
 *
 * Pure, because this is the sentence the whole fix reduces to and a `&&` chain
 * buried inside an event handler is unassertable — the same reason `panelBody`
 * and `searchBody` exist. An expired token (`expiresAt` in the past) answers
 * yes for the same reason a nearly-expired one does: the arithmetic is signed,
 * so "already gone" is just a large negative remaining lifetime.
 */
export function shouldRefreshSession(read: RefreshDecisionInput): boolean {
  // Checked FIRST, and it beats everything else. Several revival events land in
  // the same instant — macOS wake fires `focus` and `visibilitychange` back to
  // back, a reconnect adds `online` — and each one must not start its own token
  // exchange. One question, one answer.
  if (read.refreshInFlight) return false
  // No session to revive. A refresh here would only produce
  // `AuthSessionMissingError`, and asking the network about a signed-out user is
  // exactly the "the mount writes something" behaviour the project forbids.
  if (read.expiresAt == null || !Number.isFinite(read.expiresAt)) return false
  return read.expiresAt * 1000 - read.nowMs <= REFRESH_MARGIN_MS
}

export interface RefreshFailureInput {
  /** The `error` field `refreshSession()` came back with (never `null` here). */
  error: unknown
  /** Expiry of the session still held AFTER the failed refresh, in seconds. */
  expiresAt: number | null | undefined
  nowMs: number
}

/**
 * What a FAILED refresh means: end the session, or leave it alone and let the
 * ticker try again?
 *
 * Signing out is the destructive answer, so it needs both halves to be true:
 * the failure must be definitive, AND the access token must actually be dead.
 *
 *   · A retryable fetch error is the offline case. Ending the session because
 *     the wifi dropped would be a worse bug than the one being fixed.
 *   · A discarded refresh means auth-js's commit guard threw our rotated tokens
 *     away because another tab won the race — the session in storage is that
 *     other tab's, and it is fine.
 *   · A definitive error on a token that is still valid is auth-js's
 *     "proactive-preserve": we asked early (inside the 90 s margin), the server
 *     said no, and the current token still has seconds of life. Keep it; the
 *     ticker will ask again, and if that also fails the token will be genuinely
 *     expired by then and this function will say sign out.
 *
 * The common case never reaches here at all: when the refresh token is truly
 * dead, `_callRefreshToken` removes the session itself and emits `SIGNED_OUT`,
 * which the store already handles. This is the belt for the case where that
 * notification does not arrive.
 */
export function revivalFailureAction(read: RefreshFailureInput): 'sign-out' | 'wait' {
  if (isAuthRetryableFetchError(read.error) || isAuthRefreshDiscardedError(read.error))
    return 'wait'
  if (read.expiresAt == null || !Number.isFinite(read.expiresAt)) return 'sign-out'
  return read.expiresAt * 1000 <= read.nowMs ? 'sign-out' : 'wait'
}

/** What one token exchange came back with. */
export interface RefreshOutcome {
  /** `null`/`undefined` iff the exchange succeeded. */
  error: unknown
  /**
   * The access token the exchange produced, `null` when it failed. Returned
   * explicitly rather than read back from the store afterwards: `TOKEN_REFRESHED`
   * reaches `onAuthStateChange` on its own schedule, so a caller that wants to
   * REPLAY a request with the new token (the 401 retry in `api.ts`) must be handed
   * the token, not told to go looking for it.
   */
  accessToken: string | null
}

/**
 * One token exchange at a time, shared by everyone who can ask for one.
 *
 * Two callers now ask: this file's wake/refocus/reconnect watcher, and the 401
 * retry in `api.ts`. They fire in exactly the same instant — the wake dispatches
 * `focus` while the queries TanStack Query refetches on that same wake are already
 * in flight and 401ing — and a browser tab must never run two refreshes on one
 * refresh token: supabase-js rotates it, so the second exchange presents a token
 * the first has just invalidated and fails for a reason that has nothing to do
 * with the user's session.
 *
 * So the anti-burst guard is not duplicated on each side; it is this one object,
 * built once in `auth-store.ts` and handed to both. A `run()` during an exchange
 * returns THE SAME promise — the second caller waits for the first's answer and
 * gets the same token out of it, which is precisely what it needs.
 */
export interface RefreshGate {
  /** Ask for a fresh token; concurrent asks share one exchange. */
  run: () => Promise<RefreshOutcome>
  /** True while an exchange started through this gate has not settled. */
  inFlight: () => boolean
}

export function createRefreshGate(refresh: () => Promise<RefreshOutcome>): RefreshGate {
  let pending: Promise<RefreshOutcome> | null = null
  return {
    inFlight: () => pending !== null,
    run: () => {
      if (pending) return pending
      // The async wrapper turns a SYNCHRONOUS throw from `refresh` into a
      // rejection, so `.finally` still runs and the gate cannot wedge shut.
      const started = (async () => refresh())().finally(() => {
        pending = null
      })
      pending = started
      return started
    },
  }
}

export interface SessionRevivalDeps {
  /** Expiry (seconds) of the session the store currently holds, or `null`. */
  sessionExpiresAt: () => number | null
  /** The shared gate over `supabase.auth.refreshSession()`. */
  gate: RefreshGate
  /** Run when the session is definitively over — the store's `forceSignOut`. */
  signOut: () => void
}

/** True when a `document` exists and reports the page as hidden. */
function pageIsHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * Listen for the moments a suspended tab comes back and refresh the token if it
 * needs it. Returns a detach function.
 *
 * ATTACHING DOES NOTHING. No refresh is fired here, and no state is written —
 * the project's rule that a mount observes rather than decides (theme, locale,
 * motion) holds for the session too. Bootstrap already hydrates through
 * `getSession()`; a second, unconditional refresh at startup would just be a
 * network call nobody asked for.
 *
 * Tolerates a missing `window`/`document` (node tests, any SSR pass) by
 * returning an inert detacher.
 */
export function watchSessionRevival(deps: SessionRevivalDeps): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }

  const consider = (): void => {
    if (
      !shouldRefreshSession({
        expiresAt: deps.sessionExpiresAt(),
        nowMs: Date.now(),
        // The gate raises its flag SYNCHRONOUSLY inside `run()`, before the first
        // await point. `focus` and `visibilitychange` are dispatched in the same
        // task on wake; if the flag only went up inside the promise, both would
        // already have called through. Consulting it here (rather than relying on
        // the gate's own dedupe) also keeps ONE failure handler per exchange —
        // a second `run()` would attach a second `.then` to the same promise and
        // evaluate `signOut` twice.
        refreshInFlight: deps.gate.inFlight(),
      })
    ) {
      return
    }
    void deps.gate
      .run()
      .then(({ error }) => {
        if (!error) return // `TOKEN_REFRESHED` has already updated the store.
        if (
          revivalFailureAction({
            error,
            expiresAt: deps.sessionExpiresAt(),
            nowMs: Date.now(),
          }) === 'sign-out'
        ) {
          deps.signOut()
        }
      })
      .catch(() => {
        // `refreshSession()` returns auth failures in `{ error }`; a THROW is
        // something else entirely (a fetch that blew up, a storage lock). We do
        // not understand it, so we do not end the user's session over it — the
        // ticker retries, and the 401 handler is the last line either way. The
        // gate reopens itself on this path too, so the watcher is never wedged.
      })
  }

  // Only the hidden → visible edge is a revival. auth-js covers this one too;
  // keeping it costs a no-op (the decision says "fresh") and means the fix does
  // not silently depend on a library internal staying where it is.
  const onVisibilityChange = (): void => {
    if (pageIsHidden()) return
    consider()
  }
  // The one auth-js cannot see. The machine slept with this tab in front:
  // visibility never changed, so `visibilitychange` never fires, but the window
  // is re-focused on wake.
  const onFocus = (): void => consider()
  // A refresh that failed while offline should be retried the moment there is a
  // network again, not on the next 30 s tick.
  const onOnline = (): void => consider()

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  window.addEventListener('focus', onFocus)
  window.addEventListener('online', onOnline)

  return () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('online', onOnline)
  }
}
