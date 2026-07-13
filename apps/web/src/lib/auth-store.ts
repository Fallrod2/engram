import type { Session } from '@supabase/supabase-js'
import { supabase, AUTH_ENABLED_WEB } from './supabase'
import {
  AUTH_LINK_PARAM_KEYS,
  readAuthLink,
  type AuthLinkError,
  type AuthLinkTokens,
  type AuthLinkType,
} from './auth-links'

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

/**
 * Onboarding link state (spec: invite/recovery flow). `none` in normal use; set at
 * bootstrap when the user arrived via an email link. `setup` means a valid
 * invite/recovery session is active and the user must choose a password before
 * entering the app; `error` means the one-time link was expired or already used.
 */
export type LinkState =
  | { kind: 'none' }
  | { kind: 'setup'; linkType: AuthLinkType }
  | { kind: 'error'; error: AuthLinkError }

let linkState: LinkState = { kind: 'none' }
const linkListeners = new Set<(state: LinkState) => void>()
/** Tokens captured from the URL before `init()`, established via `setSession`. */
let pendingLink: AuthLinkTokens | null = null

/**
 * localStorage marker for an *in-progress* password setup (spec: invite/recovery).
 * The invite/recovery session is persisted by supabase-js (`persistSession`) and
 * survives a page reload, but the in-memory `linkState` does not — and the URL
 * tokens were already stripped, so `captureAuthLink()` finds nothing on the second
 * load. Without this marker `init()` would rehydrate the recovery session as a
 * *normal* login and let the user into the app WITHOUT ever setting a password
 * (a hard auth bypass). We persist the setup intent here, re-read it in `init()`
 * when a session is present, and clear it only once the password is actually set
 * (`clearLinkState`). Distinct from supabase-js's own `engram-auth` storage key.
 */
const LINK_SETUP_STORAGE_KEY = 'engram-auth-link'

function persistLinkSetup(linkType: AuthLinkType): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LINK_SETUP_STORAGE_KEY, linkType)
  } catch {
    // Storage unavailable (private mode). The in-memory `linkState` still gates
    // this tab; only cross-reload persistence is lost — acceptable degradation.
  }
}

function readPersistedLinkSetup(): AuthLinkType | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(LINK_SETUP_STORAGE_KEY)
    return value === 'invite' || value === 'recovery' ? value : null
  } catch {
    return null
  }
}

function clearPersistedLinkSetup(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LINK_SETUP_STORAGE_KEY)
  } catch {
    // ignore — nothing to clear if storage is unavailable
  }
}

function setLinkState(next: LinkState): void {
  linkState = next
  for (const listener of linkListeners) listener(linkState)
}

export function getLinkState(): LinkState {
  return linkState
}

export function subscribeLink(listener: (state: LinkState) => void): () => void {
  linkListeners.add(listener)
  return () => {
    linkListeners.delete(listener)
  }
}

/** True while an invite/recovery session is active and awaiting a new password. */
export function isPasswordSetupPending(): boolean {
  return linkState.kind === 'setup'
}

/** Clear the onboarding link state once the password has been set (or dismissed). */
export function clearLinkState(): void {
  pendingLink = null
  clearPersistedLinkSetup()
  if (linkState.kind !== 'none') setLinkState({ kind: 'none' })
}

/** Remove any auth-link params from the current URL so the token never lingers. */
function stripAuthParamsFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.hash = ''
  for (const key of AUTH_LINK_PARAM_KEYS) url.searchParams.delete(key)
  window.history.replaceState(null, '', `${url.pathname}${url.search}`)
}

/**
 * Read an invite/recovery callback from the URL (fragment or query), stash the
 * tokens for `init()` to establish, and strip them from the URL immediately. Must
 * run once at bootstrap BEFORE `init()`. Errors (expired/used link) surface as an
 * `error` link state right away (no session to establish). The `loc` argument is
 * injectable for tests; it defaults to `window.location`.
 */
export function captureAuthLink(loc?: { hash: string; search: string }): void {
  if (!AUTH_ENABLED_WEB) return
  const source =
    loc ??
    (typeof window !== 'undefined'
      ? { hash: window.location.hash, search: window.location.search }
      : undefined)
  if (!source) return
  const result = readAuthLink(source)
  if (!result) return
  if (result.kind === 'error') {
    setLinkState({ kind: 'error', error: result })
  } else {
    pendingLink = result
  }
  stripAuthParamsFromUrl()
}

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
  const client = supabase
  // If an invite/recovery link was captured, establish THAT session first (needed
  // for `updateUser({password})`) and flag the password-setup step. Otherwise
  // hydrate the persisted session as usual.
  const bootstrap = pendingLink
    ? client.auth
        .setSession({
          access_token: pendingLink.accessToken,
          refresh_token: pendingLink.refreshToken,
        })
        .then(({ data, error }) => {
          if (error || !data.session) {
            setLinkState({
              kind: 'error',
              error: {
                kind: 'error',
                error: 'session_error',
                code: null,
                description: error?.message ?? null,
              },
            })
            setState({ status: 'unauthenticated', session: null })
          } else {
            // Persist the setup intent so a reload BEFORE the password is set
            // re-enters this gate instead of leaking into the app (see marker doc).
            persistLinkSetup(pendingLink!.type)
            setLinkState({ kind: 'setup', linkType: pendingLink!.type })
            setState({ status: 'authenticated', session: data.session })
          }
        })
    : client.auth.getSession().then(({ data }) => {
        // No fresh URL link, but a persisted setup marker + a live session means an
        // invite/recovery reload landed here mid-onboarding: re-enter the setup gate
        // rather than treating the recovery session as a normal login (auth bypass).
        const persistedSetup = readPersistedLinkSetup()
        if (data.session && persistedSetup) {
          setLinkState({ kind: 'setup', linkType: persistedSetup })
          setState({ status: 'authenticated', session: data.session })
          return
        }
        // A marker with no session is stale (session expired/cleared) — drop it.
        if (persistedSetup) clearPersistedLinkSetup()
        setState({
          status: data.session ? 'authenticated' : 'unauthenticated',
          session: data.session,
        })
      })
  void bootstrap.finally(() => resolveReady())
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
  captureAuthLink,
  getLinkState,
  subscribeLink,
  isPasswordSetupPending,
  clearLinkState,
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
 * `/login` is exempt (anti-loop). `/` and `/welcome` are exempt too so an
 * unauthenticated visitor lands on the public landing page instead of being
 * bounced to /login (landing spec §1). Deep links stay guarded.
 */
export function requireAuth(opts: {
  auth: AuthLike
  pathname: string
  href: string
}): { to: '/login'; search: { redirect: string } } | undefined {
  // Anti-loop / public routes exempt. `/login` (audit §8) and `/set-password`
  // (invite/recovery flow) render bare and manage their own redirects; `/` and
  // `/welcome` are the public landing (the route component itself shows the
  // dashboard once authenticated) — never bounce any of them back here.
  if (
    opts.pathname === '/login' ||
    opts.pathname === '/set-password' ||
    opts.pathname === '/' ||
    opts.pathname === '/welcome'
  )
    return undefined
  if (opts.auth.getState().status !== 'authenticated') {
    // Defense in depth: only ever stash a same-origin relative return path.
    return { to: '/login', search: { redirect: sanitizeRedirect(opts.href) } }
  }
  return undefined
}

/**
 * Root-guard companion (spec: invite/recovery). When an email-link flow is active
 * (a pending password setup, or an expired-link error), force the user onto the
 * bare `/set-password` screen — except when already there (anti-loop). Returns
 * `undefined` in normal use, so the standard `requireAuth` check then applies.
 */
export function linkRedirect(opts: {
  pathname: string
  linkState: LinkState
}): { to: '/set-password' } | undefined {
  if (opts.linkState.kind === 'none') return undefined
  if (opts.pathname === '/set-password') return undefined
  // Expired/used-link screen: the flow is already dead (no session to complete),
  // and it offers an escape to /login. Never bounce that navigation back to the
  // dead-end set-password screen. The mandatory `setup` gate stays strict — only
  // the terminal `error` state is allowed to reach /login.
  if (opts.linkState.kind === 'error' && opts.pathname === '/login') return undefined
  return { to: '/set-password' }
}
