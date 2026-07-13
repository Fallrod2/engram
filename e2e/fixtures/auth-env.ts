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

/** The storageKey configured in apps/web/src/lib/supabase.ts. */
export const AUTH_STORAGE_KEY = 'engram-auth'

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

/** A supabase-js-compatible persisted session wrapping the given access token. */
export function seedSession(accessToken: string): SeedSession {
  return {
    access_token: accessToken,
    refresh_token: 'e2e-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 86_400, // far future → no refresh
    token_type: 'bearer',
    user: { id: 'e2e-user', aud: 'authenticated', role: 'authenticated', email: 'test@local' },
  }
}
