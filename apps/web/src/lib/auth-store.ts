import type { Session } from '@supabase/supabase-js'
import { supabase, AUTH_ENABLED_WEB } from './supabase'

/**
 * Vanilla auth store (spec §3.2) — readable OUTSIDE React so the router's
 * `beforeLoad` guard (which runs off-render) can read the session and `await`
 * the initial hydration. `<AuthProvider>` mirrors it into React state.
 *
 * When web auth is disabled (`!AUTH_ENABLED_WEB`) the state is forced
 * `authenticated` and `ready` resolves immediately — symmetric with the server
 * gate being OFF in dev/e2e.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'
export interface AuthState {
  status: AuthStatus
  session: Session | null
}

type Listener = (state: AuthState) => void

let state: AuthState = AUTH_ENABLED_WEB
  ? { status: 'loading', session: null }
  : { status: 'authenticated', session: null }

const listeners = new Set<Listener>()
let onSignedOut: () => void = () => {}

let resolveReady!: () => void
const readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve
})

function setState(next: AuthState): void {
  state = next
  for (const listener of listeners) listener(state)
}

export function getState(): AuthState {
  return state
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Current access token (kept fresh by `autoRefreshToken` + `TOKEN_REFRESHED`). */
export function token(): string | null {
  return state.session?.access_token ?? null
}

/** Wire the "signed out" effect (navigate to /login + clear queries), set once. */
export function setOnSignedOut(fn: () => void): void {
  onSignedOut = fn
}

/**
 * Force a signed-out state synchronously, purge the Supabase session, and run
 * the signed-out effect. Used by the api 401 handler (audit §8): a dead session
 * mid-use must redirect to /login, not leave failing queries on screen.
 */
export function forceSignOut(): void {
  setState({ status: 'unauthenticated', session: null })
  // Fire-and-forget: the network call may fail (dead session / offline); the
  // local session is cleared regardless. Swallow so it never surfaces as an
  // unhandled rejection.
  void supabase?.auth.signOut().catch(() => {})
  onSignedOut()
}

let started = false

/** Hydrate from `getSession()` then subscribe to auth changes. Idempotent. */
export function init(): Promise<void> {
  if (started) return readyPromise
  started = true
  if (!AUTH_ENABLED_WEB || !supabase) {
    setState({ status: 'authenticated', session: null })
    resolveReady()
    return readyPromise
  }
  void supabase.auth.getSession().then(({ data }) => {
    setState({
      status: data.session ? 'authenticated' : 'unauthenticated',
      session: data.session,
    })
    resolveReady()
  })
  supabase.auth.onAuthStateChange((event, session) => {
    setState({ status: session ? 'authenticated' : 'unauthenticated', session })
    if (event === 'SIGNED_OUT') onSignedOut()
  })
  return readyPromise
}

/** The object handed to the router context (`RouterContext.auth`). */
export const authStore = {
  getState,
  subscribe,
  token,
  ready: readyPromise,
  init,
  setOnSignedOut,
  forceSignOut,
}

/** Shape of the store, for the router context type. */
export type AuthStore = typeof authStore

export interface AuthLike {
  getState(): AuthState
}

/**
 * Clamp an attacker-controllable `redirect` value to a safe same-origin relative
 * path (CWE-601 open-redirect defense). Anything that is not a path starting with
 * a single `/` (so not `//host`, not `https://…`, not `\\`) falls back to `/`.
 * Applied at every site that turns `redirect` into a real navigation.
 */
export function sanitizeRedirect(value: string | undefined | null): string {
  if (value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) {
    return value
  }
  return '/'
}

/**
 * Router guard (spec §3.4), extracted for a unit test (audit §3/§8). Assumes the
 * caller has already `await`ed `auth.ready`, so the store is never `loading`.
 * `/login` is exempt (anti-loop).
 */
export function requireAuth(opts: {
  auth: AuthLike
  pathname: string
  href: string
}): { to: '/login'; search: { redirect: string } } | undefined {
  if (opts.pathname === '/login') return undefined // anti-loop (audit §8)
  if (opts.auth.getState().status !== 'authenticated') {
    // Defense in depth: only ever stash a same-origin relative return path.
    return { to: '/login', search: { redirect: sanitizeRedirect(opts.href) } }
  }
  return undefined
}
