import { Hono } from 'hono'
import { meResponseSchema } from '@engram/shared'
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
  return ok(c, meResponseSchema, {
    userId,
    email: profile?.email ?? null,
    isAdmin: isAdminProfile(profile, userId, cfg),
    isDemo: isDemoProfile(profile, userId, cfg),
    status: profile?.status ?? 'active',
  })
})
