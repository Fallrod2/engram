import { createHmac } from 'node:crypto'

/**
 * Fixtures for the OPT-IN auth-ON e2e (spec §6.3, audit §10). Distinct ports from
 * the default suite (3100/5273) and from the dev/live servers. The server runs
 * auth ON via the HS256 path (`SUPABASE_JWT_SECRET`) — no GoTrue container, no
 * network — and the test mints a JWT signed with the SAME secret.
 */
export const AUTH_PORTS = { api: 3110, web: 5283 } as const
export const AUTH_API_BASE = `http://localhost:${AUTH_PORTS.api}`
export const AUTH_API_HEALTH_URL = `${AUTH_API_BASE}/api/health`
export const AUTH_WEB_URL = `http://localhost:${AUTH_PORTS.web}`

/** Shared HS256 secret: signs the test tokens AND verifies them on the server. */
export const AUTH_TEST_SECRET = 'engram-e2e-auth-secret-at-least-32-bytes-long!!'

/**
 * `sub` the auth-ON harness treats as the instance admin (wired as
 * `ENGRAM_ADMIN_USER_ID` in `playwright.auth.config.ts`). A token minted with
 * this subject is admin via the permanent env filet; every other sub is a plain
 * user. Kept here so the config and the admin spec agree on one value.
 */
export const AUTH_ADMIN_SUB = 'e2e-admin-user'

/**
 * A SECOND, non-admin subject used by the delegated-administration specs
 * (rbac-groups §6.3). It is a plain `user` — it gains targeted admin permissions
 * ONLY through group membership the admin grants at runtime, and loses them when
 * removed. Kept here so the delegated specs share one canonical delegate identity;
 * the other delegated scenarios mint further distinct subs inline for isolation.
 */
export const AUTH_DELEGATE_SUB = 'e2e-delegate-user'

/** The storageKey configured in apps/web/src/lib/supabase.ts. */
export const AUTH_STORAGE_KEY = 'engram-auth'

/**
 * Marker key for an in-progress invite/recovery password setup (see
 * `LINK_SETUP_STORAGE_KEY` in apps/web/src/lib/auth-store.ts). Its presence
 * alongside a live session means a reload landed mid-onboarding.
 */
export const AUTH_LINK_STORAGE_KEY = 'engram-auth-link'

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

/** Mint a compact HS256 JWT (no jose dependency in the e2e runtime). */
export function mintJwt(payload: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const data = `${header}.${body}`
  const sig = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

export interface SeedSession {
  access_token: string
  refresh_token: string
  expires_at: number
  token_type: string
  user: { id: string; aud: string; role: string; email: string }
}

/**
 * A supabase-js-compatible persisted session wrapping the given access token.
 * `user` is parametrizable (amendment A14): the multi-user admin scenarios mint
 * tokens with distinct `sub`s, and `session.user.id`/`email` MUST match the JWT
 * subject or supabase-js (client) and the server (JWT-scoped) would disagree.
 * Defaults preserve the original single-user fixture for the existing specs.
 */
export function seedSession(
  accessToken: string,
  user: { id?: string; email?: string } = {},
): SeedSession {
  return {
    access_token: accessToken,
    refresh_token: 'e2e-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 86_400, // far future → no refresh
    token_type: 'bearer',
    user: {
      id: user.id ?? 'e2e-user',
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email ?? 'test@local',
    },
  }
}
