import type { Context } from 'hono'
import { resolveAuthConfig } from '../auth/config'
import { isAdminProfile, isDemoProfile } from '../services/profile.service'
import { UnauthorizedError, ForbiddenError } from './errors'

/**
 * Per-request identity helpers (spec §2/§3). `authClaims` is set by the auth
 * middleware — the real JWT `sub` when the gate is enforced, or the default dev
 * identity when it is not. Routers call `requireUserId` and pass the result to
 * every service so all reads/writes are scoped to the owner.
 */

/** The authenticated owner id (`sub`), or 401 if somehow absent/empty. */
export function requireUserId(c: Context): string {
  const sub = c.get('authClaims')?.sub
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new UnauthorizedError('missing user identity')
  }
  return sub
}

/**
 * Require the caller to be an admin (spec §3, amendment A1). Resolution is
 * `profile.role==='admin' OR userId===resolveAdminUserId(env)` — the DB role is
 * the primary source, with the env id as a permanent anti-lockout filet. STAYS
 * SYNC (the profile is already in the request context, set by the profile
 * middleware), so the 8 existing inline call sites never became async. Fail-closed:
 * no profile in context (route hit outside the middleware, a unit test) → the env
 * filet is the only path; absent that too → 403.
 */
export function requireAdmin(c: Context): string {
  const userId = requireUserId(c)
  const cfg = resolveAuthConfig(process.env)
  if (!isAdminProfile(c.get('userProfile'), userId, cfg)) {
    throw new ForbiddenError('admin only')
  }
  return userId
}

/**
 * Require the caller NOT to be the demo account (spec BYOK §1.2 / amendment A1):
 * `profile.isDemo OR userId===env.demoUserId`. The demo READS the admin AI config
 * (so generation/OCR work in the showcase), but it must never WRITE config — its
 * data is wiped on every new login anyway. Applied to PATCH /settings and
 * PUT/DELETE key; POST test stays permitted (it resolves via the admin alias).
 */
export function requireNotDemo(c: Context): string {
  const userId = requireUserId(c)
  const cfg = resolveAuthConfig(process.env)
  if (isDemoProfile(c.get('userProfile'), userId, cfg)) {
    throw new ForbiddenError('demo account is read-only for AI config')
  }
  return userId
}
