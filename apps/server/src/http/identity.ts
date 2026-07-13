import type { Context } from 'hono'
import { resolveAuthConfig, resolveAdminUserId } from '../auth/config'
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
 * Require the caller to be the admin (spec §3): returns the user id or throws
 * 403 `forbidden`. Fail-closed — if no admin is configured in enforced prod
 * (`ENGRAM_ADMIN_USER_ID` absent) nobody passes; under the dev bypass the
 * default identity is the admin, so local dev + the default e2e suite work.
 */
export function requireAdmin(c: Context): string {
  const userId = requireUserId(c)
  const adminUserId = resolveAdminUserId(resolveAuthConfig(process.env))
  if (!adminUserId || userId !== adminUserId) {
    throw new ForbiddenError('admin only')
  }
  return userId
}
