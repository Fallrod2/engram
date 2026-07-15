import type { FetchFn } from '../ai/providers/types'
import type { AuthConfig } from './config'

/**
 * The GoTrue Admin API client (spec §2 / recon §1, amendments A5/A6/A7). A THIN,
 * INJECTABLE `fetch` wrapper (zero new dep — parity with the AI provider adapters,
 * which take a `fetchFn`). Its whole reason to exist is testability + safety:
 *
 *  - INJECTABLE: `createAdminAuthClient({ ..., fetchFn })` lets the route specs
 *    mock `inviteUser/createUser/updateUserEmail` with NO network (amendment A6.3),
 *    via the `__setAdminAuthClientForTests` seam below. Tests NEVER call real GoTrue.
 *  - SECRET-SAFE (amendment A5): the `service_role` key rides ONLY in the request
 *    headers over TLS. It is NEVER logged, and on an upstream error we read only a
 *    minimal `{code,msg}` and build our OWN message — the raw upstream body (which
 *    could echo the Authorization header) is NEVER re-emitted to the caller.
 *  - NO TOP-LEVEL CONSTRUCTION (parity config.ts): the client is resolved PER
 *    REQUEST by `resolveAdminAuthClient`, which returns `null` when the config is
 *    absent so the route degrades to a clean 503 (never a crash, amendment A6.2).
 */

export interface AdminAuthClient {
  /** Send an invitation email (magic link → existing /set-password flow). Returns the new sub. */
  inviteUser(email: string, redirectTo: string): Promise<{ id: string }>
  /** Create a confirmed account with a temporary password (over TLS). Returns the new sub. */
  createUser(input: {
    email: string
    password: string
    emailConfirm: boolean
  }): Promise<{ id: string }>
  /** Change an existing account's email. */
  updateUserEmail(id: string, email: string): Promise<{ id: string }>
}

/** How an upstream GoTrue failure maps to an actionable, secret-free API error. */
export type AdminAuthErrorKind = 'email_taken' | 'invalid_email' | 'upstream'

/**
 * A classified GoTrue failure. Carries ONLY a `kind` + `status` + a message built
 * by us — never the raw upstream body (amendment A5.3). The route/service maps
 * `kind` to the public `ApiError` (409 email_taken / 400 invalid_email / 502).
 */
export class AdminAuthError extends Error {
  constructor(
    readonly kind: AdminAuthErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AdminAuthError'
  }
}

/**
 * Read a FAILED GoTrue response into a classified error. Parses at most a small
 * `{code,msg}` shape; on any parse issue it still returns a generic upstream error.
 * NEVER interpolates the body into the message (it may echo request headers).
 */
async function classifyError(res: Response): Promise<AdminAuthError> {
  let code = ''
  let msg = ''
  try {
    const body = (await res.json()) as Record<string, unknown>
    code = String(body.error_code ?? body.code ?? '').toLowerCase()
    msg = String(body.msg ?? body.error_description ?? body.error ?? '').toLowerCase()
  } catch {
    // A non-JSON / empty error body → fall through to a generic upstream error.
  }
  const emailTaken =
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    /already|registered|exists|duplicate/.test(msg)
  if (emailTaken) return new AdminAuthError('email_taken', res.status, 'email already registered')
  if (res.status === 400 && /email/.test(msg)) {
    return new AdminAuthError('invalid_email', 400, 'invalid email address')
  }
  return new AdminAuthError(
    'upstream',
    res.status,
    `auth provider request failed (HTTP ${res.status})`,
  )
}

/** Extract the created/updated user's `id` (the `sub`) from a successful response. */
async function readId(res: Response): Promise<{ id: string }> {
  const body = (await res.json().catch(() => ({}))) as { id?: unknown }
  return { id: typeof body.id === 'string' ? body.id : '' }
}

/**
 * Build a real GoTrue admin client bound to a project `url` + `serviceRoleKey`.
 * `fetchFn` defaults to the global `fetch`; tests inject a stub. Constructed ONLY
 * inside `resolveAdminAuthClient` (never at module top-level).
 */
export function createAdminAuthClient(opts: {
  url: string
  serviceRoleKey: string
  fetchFn?: FetchFn
}): AdminAuthClient {
  const fetchFn = opts.fetchFn ?? fetch
  const base = opts.url.replace(/\/+$/, '')
  // Header factory — the ONLY place the service_role key appears. Never logged.
  const headers = (): Record<string, string> => ({
    apikey: opts.serviceRoleKey,
    Authorization: `Bearer ${opts.serviceRoleKey}`,
    'Content-Type': 'application/json',
  })

  return {
    async inviteUser(email, redirectTo) {
      const res = await fetchFn(
        `${base}/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`,
        { method: 'POST', headers: headers(), body: JSON.stringify({ email }) },
      )
      if (!res.ok) throw await classifyError(res)
      return readId(res)
    },
    async createUser({ email, password, emailConfirm }) {
      const res = await fetchFn(`${base}/auth/v1/admin/users`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ email, password, email_confirm: emailConfirm }),
      })
      if (!res.ok) throw await classifyError(res)
      return readId(res)
    },
    async updateUserEmail(id, email) {
      const res = await fetchFn(`${base}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw await classifyError(res)
      return readId(res)
    },
  }
}

/**
 * Test seam (amendment A6.3). `undefined` (the default) → the resolver behaves
 * normally (real client iff configured, else `null`). A client instance forces
 * that mock; `null` forces the unavailable/503 path. Route specs set a mock in
 * `beforeEach` and MUST reset to `undefined` in `afterEach`.
 */
let testOverride: AdminAuthClient | null | undefined
export function __setAdminAuthClientForTests(client: AdminAuthClient | null | undefined): void {
  testOverride = client
}

/**
 * Resolve the admin client for THIS request, or `null` when account management is
 * unavailable (no `SUPABASE_URL` or no `service_role` key — dev bypass, tests, or
 * prod without the key). The handler turns `null` into a clean 503 (amendment A6.2)
 * — it NEVER throws here, so importing the routes can never fail.
 */
export function resolveAdminAuthClient(cfg: AuthConfig): AdminAuthClient | null {
  if (testOverride !== undefined) return testOverride
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return null
  return createAdminAuthClient({ url: cfg.supabaseUrl, serviceRoleKey: cfg.serviceRoleKey })
}

/**
 * The trusted `redirectTo` for an invitation link (amendment A9). Derived from a
 * SERVER-configured base URL (`ENGRAM_PUBLIC_SITE_URL`), NEVER from the request
 * `Origin`/`Referer` (phishing / token-theft backstop). Dev fallback: the local
 * web origin. The Supabase allowlist is a second backstop, not the guarantee.
 */
export function resolveInviteRedirect(cfg: AuthConfig): string {
  const base = (cfg.publicSiteUrl ?? 'http://localhost:5174').replace(/\/+$/, '')
  return `${base}/`
}
