import type { FetchFn } from '../ai/providers/types'
import type { AuthConfig } from './config'

/**
 * GoTrue password-grant client for the PUBLIC demo login (landing CTA). Same
 * shape and same discipline as `admin-client.ts` — a thin, injectable `fetch`
 * wrapper, zero new dependency — with one extra rule of its own:
 *
 *  - SECRET-SAFE: `ENGRAM_DEMO_PASSWORD` is read ONCE here, rides only in the
 *    request body over TLS, and is NEVER logged, NEVER echoed in a response and
 *    NEVER interpolated into an error message. On an upstream failure we throw a
 *    generic error of our own making; the raw GoTrue body is discarded unread
 *    (it can quote the submitted credentials back at us).
 *  - NO TOP-LEVEL CONSTRUCTION: the client is resolved PER REQUEST by
 *    `resolveDemoAuthClient`, which returns `null` when the demo is not
 *    configured so the route degrades to a clean 503 instead of a crash.
 *  - The credentials come from the ENVIRONMENT ONLY. Nothing in this module
 *    accepts an email/password argument, so the route it serves can never become
 *    an open login proxy no matter what a caller posts.
 */

/** What the browser needs to install the session (`supabase.auth.setSession`). */
export interface DemoSessionTokens {
  accessToken: string
  refreshToken: string
}

export interface DemoAuthClient {
  /** Open a session for the configured demo account. Takes NO argument, by design. */
  signIn(): Promise<DemoSessionTokens>
}

/**
 * A demo sign-in failure that is safe to surface. Carries only a `status` and a
 * message we wrote — never anything read from the upstream response body.
 */
export class DemoAuthError extends Error {
  constructor(readonly status: number) {
    super(`demo sign-in failed (HTTP ${status})`)
    this.name = 'DemoAuthError'
  }
}

/**
 * Build a client bound to a project `url` + `anonKey` and the demo credentials.
 * `fetchFn` defaults to the global `fetch`; tests inject a stub. Constructed ONLY
 * inside `resolveDemoAuthClient` (never at module top-level).
 */
export function createDemoAuthClient(opts: {
  url: string
  anonKey: string
  email: string
  password: string
  fetchFn?: FetchFn
}): DemoAuthClient {
  const fetchFn = opts.fetchFn ?? fetch
  const base = opts.url.replace(/\/+$/, '')
  return {
    async signIn() {
      let res: Response
      try {
        res = await fetchFn(`${base}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            apikey: opts.anonKey,
            Authorization: `Bearer ${opts.anonKey}`,
            'Content-Type': 'application/json',
          },
          // The ONLY place the demo password appears in a request.
          body: JSON.stringify({ email: opts.email, password: opts.password }),
        })
      } catch {
        // Network/DNS failure. Swallowed on purpose: the thrown cause could carry
        // the request (and therefore the password) in some fetch implementations.
        throw new DemoAuthError(502)
      }
      if (!res.ok) throw new DemoAuthError(res.status)
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: unknown
        refresh_token?: unknown
      }
      const accessToken = typeof body.access_token === 'string' ? body.access_token : ''
      const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : ''
      // A 200 without a usable token pair is an upstream contract break, not a
      // session — treat it like a failure rather than shipping empty strings.
      if (!accessToken || !refreshToken) throw new DemoAuthError(502)
      return { accessToken, refreshToken }
    },
  }
}

/**
 * Test seam (parity with `__setAdminAuthClientForTests`). `undefined` (the
 * default) → the resolver behaves normally. A client instance forces that mock;
 * `null` forces the "demo not configured" / 503 path. Specs set it in
 * `beforeEach` and MUST reset it to `undefined` in `afterEach`.
 */
let testOverride: DemoAuthClient | null | undefined
export function __setDemoAuthClientForTests(client: DemoAuthClient | null | undefined): void {
  testOverride = client
}

/**
 * Resolve the demo login client for THIS request, or `null` when the public demo
 * is not configured. The four ingredients are all required: the project URL and
 * anon key (to reach GoTrue) plus `ENGRAM_DEMO_EMAIL` / `ENGRAM_DEMO_PASSWORD`.
 * NEVER throws, so importing the routes can never fail; the handler turns `null`
 * into a clean 503 `demo_unavailable`, and `/api/health` reflects it as
 * `demoLoginEnabled:false` so the landing hides the CTA.
 */
export function resolveDemoAuthClient(cfg: AuthConfig): DemoAuthClient | null {
  if (testOverride !== undefined) return testOverride
  if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.demoEmail || !cfg.demoPassword) return null
  return createDemoAuthClient({
    url: cfg.supabaseUrl,
    anonKey: cfg.anonKey,
    email: cfg.demoEmail,
    password: cfg.demoPassword,
  })
}
