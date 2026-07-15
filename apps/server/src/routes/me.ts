import { Hono } from 'hono'
import { ADMIN_PERMISSIONS, meResponseSchema } from '@engram/shared'
import { ok } from '../http/respond'
import { requireUserId } from '../http/identity'
import { resolveAuthConfig } from '../auth/config'
import { isAdminProfile, isDemoProfile } from '../services/profile.service'

/**
 * `GET /api/me` (spec §2.3): the caller's own identity — the web guard, the
 * conditional admin nav, and the "account suspended" screen all read it. A
 * SUSPENDED caller still gets a 200 here (amendment A3, the profile middleware
 * exempts this path) so the front can explain the lockout instead of looping on
 * opaque 403s. Never exposes another user's data and never a secret.
 */
export const meRouter = new Hono()

meRouter.get('/', (c) => {
  const userId = requireUserId(c)
  const profile = c.get('userProfile')
  const cfg = resolveAuthConfig(process.env)
  const isAdmin = isAdminProfile(profile, userId, cfg)
  return ok(c, meResponseSchema, {
    userId,
    email: profile?.email ?? null,
    isAdmin,
    isDemo: isDemoProfile(profile, userId, cfg),
    status: profile?.status ?? 'active',
    // ALL for an admin / env-admin (even a bypass env-admin whose DB role is
    // 'user'), else the raw group union — reuse the SAME `isAdmin` (amendment C3).
    permissions: isAdmin ? [...ADMIN_PERMISSIONS] : [...(profile?.permissions ?? [])],
  })
})
