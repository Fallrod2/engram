import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { AuthConfig } from './config'

/**
 * JWT verification (spec §2.4) — local, no network per request in steady state.
 *
 * The algorithm is FIXED by the server config, never derived from the incoming
 * `alg` header (anti alg-confusion, audit §4). The cloud path pins `ES256` +
 * JWKS; the HS256 path (a future local-login hook, not shipped) pins `HS256`.
 * `jose` validates `exp`/`nbf` automatically, plus `issuer`/`audience`/`algorithms`.
 */

export type AuthVerifier = (token: string) => Promise<JWTPayload>

/**
 * The EXACT JWKS URL (audit §12): the `/auth/v1/` segment is mandatory. A wrong
 * path would 401 all prod traffic in silence, so this helper is unit-tested.
 */
export function jwksUrl(supabaseUrl: string): URL {
  return new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
}

/**
 * ES256/JWKS verifier bound to a key resolver. The `keys` seam lets tests inject
 * a `createLocalJWKSet(...)` and verify real tokens without any network call.
 */
export function makeJwksVerifier(
  supabaseUrl: string,
  keys: Parameters<typeof jwtVerify>[1],
): AuthVerifier {
  const issuer = `${supabaseUrl}/auth/v1`
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: 'authenticated',
      algorithms: ['ES256'],
    })
    return payload
  }
}

/** HS256 verifier (shared secret) — the not-shipped local-login fallback. */
export function makeHs256Verifier(secret: string): AuthVerifier {
  const key = new TextEncoder().encode(secret)
  return async (token) => {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      audience: 'authenticated',
    })
    return payload
  }
}

/**
 * Build the real verifier from the config (lazy — only ever called by the
 * middleware once the gate is enforced AND configured, so the remote JWKS is
 * never constructed with an invalid URL in unit tests).
 */
export function makeVerifier(cfg: AuthConfig): AuthVerifier {
  if (cfg.supabaseUrl) {
    // `createRemoteJWKSet` fetches lazily on first key resolution AND handles
    // rotation (refetch on unknown `kid` with a cooldown) → no per-request call.
    return makeJwksVerifier(cfg.supabaseUrl, createRemoteJWKSet(jwksUrl(cfg.supabaseUrl)))
  }
  if (cfg.jwtSecret) {
    return makeHs256Verifier(cfg.jwtSecret)
  }
  // `enforced && !configured` is impossible (resolveAuthConfig guarantees it).
  return async () => {
    throw new Error('auth verifier not configured')
  }
}
