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

const PUBLIC_PATHS = new Set(['/api/health'])

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

    if (!cfg.enforced) return next()
    if (c.req.method === 'OPTIONS') return next() // CORS preflight (redundant, audit §17)
    if (PUBLIC_PATHS.has(c.req.path)) return next() // /api/health is public

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
