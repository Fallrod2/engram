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

/**
 * Default owner id used for the dev/e2e/test identity when the gate is NOT
 * enforced (bypass or unconfigured). Exported as the SINGLE source of truth so
 * the auth middleware (its default `sub`) and the test harness seeds agree —
 * otherwise seeds and scoped queries would use different ids and every list
 * would come back empty (spec §2 / §6.1). Alex overrides it locally with
 * `ENGRAM_DEV_USER_ID=<his Supabase uid>` so his live dashboard shows his data
 * after the 0004 backfill.
 */
export const DEFAULT_DEV_USER_ID = 'dev-user'

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
  /**
   * GoTrue `service_role` key (account CRUD, spec §2 / amendment A5). Read ONLY
   * here; the server-side admin client is the sole consumer. NEVER reflected in
   * any response (/health, /me, admin.*) and NEVER logged. Absent → account
   * creation/edit answers a clean 503 `account_mgmt_unavailable` (amendment A6).
   */
  serviceRoleKey: string | undefined
  /**
   * Trusted public site base URL for the invite `redirectTo` (amendment A9). MUST
   * be a server-configured value, NEVER derived from the request `Origin`/`Referer`
   * (phishing / token-theft backstop). Absent → a documented localhost dev fallback.
   */
  publicSiteUrl: string | undefined
  /** `sub` of the default identity posed when the gate is not enforced (§2). */
  devUserId: string
  /** `ENGRAM_ADMIN_USER_ID` — the only user allowed on admin routes (§3). */
  adminUserId: string | undefined
  /** `ENGRAM_DEMO_USER_ID` — the demo account, reset on each new login (§4). */
  demoUserId: string | undefined
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
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    publicSiteUrl: env.ENGRAM_PUBLIC_SITE_URL || undefined,
    devUserId: env.ENGRAM_DEV_USER_ID || DEFAULT_DEV_USER_ID,
    adminUserId: env.ENGRAM_ADMIN_USER_ID || undefined,
    demoUserId: env.ENGRAM_DEMO_USER_ID || undefined,
  }
}

/**
 * The user id that is allowed on admin-only routes (spec §3), or `undefined`
 * when nobody is (→ fail-closed 403). Under bypass/dev the default identity is
 * the admin, so everything works locally without extra env; in enforced prod it
 * is strictly `ENGRAM_ADMIN_USER_ID` (absent → all admin routes 403).
 */
export function resolveAdminUserId(cfg: AuthConfig): string | undefined {
  if (!cfg.enforced) return cfg.adminUserId ?? cfg.devUserId
  return cfg.adminUserId
}
