/**
 * Auth configuration — resolved PURELY from an env object (spec §2.3).
 *
 * Two hard rules from the audit:
 * - This function is PURE and side-effect free: it never touches the network,
 *   never logs, and NEVER throws. Importing this module (or `app.ts`, which
 *   mounts the middleware) can therefore never fail — the fail-closed prod
 *   behaviour is a boolean (`misconfigured`) that the MIDDLEWARE turns into a
 *   per-request 500 (audit §6). No config is resolved at any module top-level.
 * - The dev/e2e bypass is anchored to `!isProd`, where `isProd` is
 *   `VERCEL==='1' || NODE_ENV==='production'` (audit §7). A stray
 *   `ENGRAM_AUTH_DISABLED=1` on a non-Vercel production host can no longer
 *   silently disable the gate.
 */

export interface AuthConfig {
  /** Reflected by `/api/health.authEnforced`; true iff the gate verifies JWTs. */
  enforced: boolean
  /** Prod WITHOUT any auth config → the middleware answers 500 (fail-closed). */
  misconfigured: boolean
  /** The middleware logs a loud warn whenever this is true. */
  bypassActive: boolean
  /** Supabase project URL — used to build the JWKS URL + issuer (ES256 path). */
  supabaseUrl: string | undefined
  /** Shared secret — HS256 fallback for a future local login (not shipped). */
  jwtSecret: string | undefined
}

/** Pure: reads an env object, no network, no logging, never throws. */
export function resolveAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || undefined
  const jwtSecret = env.SUPABASE_JWT_SECRET || undefined
  const configured = Boolean(supabaseUrl || jwtSecret)
  const isProd = env.VERCEL === '1' || env.NODE_ENV === 'production'
  const bypassRequested = env.ENGRAM_AUTH_DISABLED === '1'
  const bypassActive = bypassRequested && !isProd // NEVER honoured in prod
  return {
    enforced: configured && !bypassActive,
    misconfigured: isProd && !configured, // fail-closed, judged by the middleware
    bypassActive,
    supabaseUrl,
    jwtSecret,
  }
}
