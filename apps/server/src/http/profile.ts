import type { MiddlewareHandler } from 'hono'
import { db } from '../db/client'
import { resolveAuthConfig, resolveAdminUserId } from '../auth/config'
import { resolveProfile, type RequestProfile } from '../services/profile.service'
import { SuspendedError } from './errors'

/**
 * IAM profile middleware (spec §2.1, amendments A1–A4). Mounted AFTER the auth
 * gate (needs `authClaims`) and BEFORE the demo middleware (which reads the
 * resolved `is_demo`). Two jobs:
 *
 *  1. Lazily upsert the caller's `user_profile` (throttled touch) and stash the
 *     resolved profile in the request context, so `requireAdmin`/`requireNotDemo`
 *     read it synchronously (no role cache, no async guards).
 *  2. Enforce suspension: a `status='suspended'` caller gets 403 `suspended` on
 *     everything EXCEPT `GET /api/me` (which must 200 so the front can explain the
 *     lockout, A3). The env admin is NEVER blocked (anti-lockout filet, A4).
 *
 * No-op when there are no claims (`/api/health` and the OPTIONS preflight return
 * before claims are set — same guard as `http/demo.ts`).
 */
declare module 'hono' {
  interface ContextVariableMap {
    userProfile: RequestProfile
  }
}

export function createProfileMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const claims = c.get('authClaims')
    const sub = claims?.sub
    if (typeof sub !== 'string' || sub.length === 0) return next() // health / preflight

    const emailClaim = typeof claims.email === 'string' ? claims.email : null
    const profile = await resolveProfile(db, sub, emailClaim)
    c.set('userProfile', profile)

    if (profile.status === 'suspended') {
      // The env admin can never be suspended in effect (A4) — the filet must
      // survive an admin B suspending the env admin in the DB.
      const isEnvAdmin = sub === resolveAdminUserId(resolveAuthConfig(process.env))
      // `/api/me` stays readable so the suspended user learns WHY (A3).
      if (!isEnvAdmin && c.req.path !== '/api/me') {
        throw new SuspendedError('Compte suspendu. Contacte l’administrateur.')
      }
    }
    return next()
  }
}
