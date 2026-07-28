import type { MiddlewareHandler } from 'hono'
import type { JWTPayload } from 'jose'
import { resolveAuthConfig, type AuthConfig } from '../auth/config'
import { makeVerifier, type AuthVerifier } from '../auth/verify'
import { UnauthorizedError } from './errors'

/**
 * JWT gate on `/api/*` (spec §2.5). Everything is resolved PER REQUEST from
 * `process.env` — nothing at module load (audit §6) — so importing this module
 * (and `app.ts`) never throws. The verifier (which owns the JWKS cache) is
 * memoised per config fingerprint so the cache is not rebuilt on every request.
 *
 * The memo + one-shot warn flags are closure-local to each `createAuthMiddleware()`
 * call: the app mounts a single instance for the process lifetime, while every
 * test gets a fresh, isolated instance (no cross-test leakage of warn state).
 */

/** Typed seam for the future multi-user phase: `c.get('authClaims').sub` etc. */
declare module 'hono' {
  interface ContextVariableMap {
    authClaims: JWTPayload
  }
}

/**
 * The COMPLETE list of routes exempt from the JWT gate, keyed `"<METHOD> <path>"`.
 *
 * Method-scoped and exact-match on purpose — this is the whole attack surface of
 * the gate, so it is deliberately the least expressive matcher possible: no
 * prefix, no wildcard, no normalisation. `/api/demo/session/`, `/API/HEALTH`,
 * `GET /api/demo/session` and anything under `/api/demo/*` are all NOT in the set
 * and therefore still gated. `http/auth.spec.ts` pins that (`the exemption is a
 * two-entry allowlist`).
 *
 *  - `GET /api/health` — the ops probe, readable even during a prod misconfig.
 *  - `POST /api/demo/session` — the public demo login. It accepts NO caller input
 *    whatsoever (see routes/demo.ts): the credentials come from the server env,
 *    so this is not a login proxy, and it is rate-limited.
 */
const PUBLIC_ROUTES: ReadonlySet<string> = new Set(['GET /api/health', 'POST /api/demo/session'])

/** Exact, method-scoped membership test against `PUBLIC_ROUTES`. */
export function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.has(`${method} ${path}`)
}

function configKey(cfg: AuthConfig): string {
  return `${cfg.supabaseUrl ?? ''}|${cfg.jwtSecret ? 'hs' : ''}`
}

/** No arguments: everything is resolved per request from `process.env`. */
export function createAuthMiddleware(): MiddlewareHandler {
  let memo: { key: string; verify: AuthVerifier } | undefined
  let warnedBypass = false
  let warnedIgnored = false

  return async (c, next) => {
    const cfg = resolveAuthConfig(process.env)

    // `/api/health` stays readable even during a prod misconfiguration (spec §2.6):
    // it self-reports `authEnforced:false`, which is the ops runbook for diagnosing
    // *why* a bad deploy is 500ing. So the public-route exemption is checked BEFORE
    // the fail-closed throw below (the probe never carries an Authorization header).
    // `POST /api/demo/session` rides the same exemption: the landing CTA must be
    // able to obtain a demo session while holding no token at all.
    if (isPublicRoute(c.req.method, c.req.path)) return next()

    // Fail-closed (audit §6/§13): EVALUATED HERE, per request — never at import.
    // On Vercel the bundle is lazy-imported, so this 500s at the first cold-start
    // request, not at build time (the deploy "succeeds", then every request 500s
    // until the Supabase integration is active — see docs/deploy-vercel.md).
    if (cfg.misconfigured) {
      throw new Error('[engram] auth non configurée en prod — refus de servir (fail-closed)')
    }

    // Loudly log any real bypass, on any host (audit §7).
    if (cfg.bypassActive && !warnedBypass) {
      warnedBypass = true
      console.warn(
        '[engram] AUTH DÉSACTIVÉE via ENGRAM_AUTH_DISABLED — dev/test uniquement, JAMAIS en prod',
      )
    }
    if (process.env.ENGRAM_AUTH_DISABLED === '1' && !cfg.bypassActive && !warnedIgnored) {
      warnedIgnored = true
      console.warn('[engram] ENGRAM_AUTH_DISABLED ignoré (prod) — auth maintenue')
    }

    // Gate not enforced (dev/e2e bypass OR unconfigured local): pose a DEFAULT
    // identity so downstream `requireUserId` resolves and every scoped query has
    // an owner (spec §2, critique amendment 1). Set on ALL non-enforced exits,
    // not only when bypass is active — the route/isolation specs run with no auth
    // env at all (enforced=false, bypassActive=false) and would otherwise 401.
    if (!cfg.enforced) {
      c.set('authClaims', {
        sub: cfg.devUserId,
        email: 'dev@local',
        role: 'authenticated',
      })
      return next()
    }
    if (c.req.method === 'OPTIONS') return next() // CORS preflight (redundant, audit §17)

    if (!memo || memo.key !== configKey(cfg)) {
      memo = { key: configKey(cfg), verify: makeVerifier(cfg) }
    }
    const header = c.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
    if (!token) throw new UnauthorizedError('missing bearer token')
    try {
      c.set('authClaims', await memo.verify(token)) // seam for multi-user (sub/role)
    } catch {
      throw new UnauthorizedError('invalid or expired token')
    }
    return next()
  }
}
