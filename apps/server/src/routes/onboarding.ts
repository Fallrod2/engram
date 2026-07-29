import { Hono, type Context } from 'hono'
import { onboardingStatusSchema, updateOnboardingSchema } from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { requireUserId } from '../http/identity'
import { resolveAuthConfig } from '../auth/config'
import { isDemoProfile } from '../services/profile.service'
import { getOnboardingStatus, setOnboardingCompleted } from '../services/onboarding.service'

/**
 * `/api/onboarding` — the first-run journey's marker (T-049).
 *
 * GET answers ONE question: should the app open the journey by itself? It is
 * read on the first navigation of a session, so it stays deliberately tiny (one
 * k/v read plus, only when there is no marker, one content probe).
 *
 * PATCH records that the user went through the journey — or left it, which is
 * the same statement as far as "do not ask again" goes. The journey is not
 * blocking (Alex, 29/07/2026), so quitting at step 1 is a legitimate answer and
 * must not put the user back in front of it on the next page load.
 *
 * THE DEMO IS RESOLVED HERE, not in the service: `isDemoProfile` needs the
 * request context (the profile posed by the middleware) and the env config,
 * neither of which a service should reach for. Both verbs pass it down, so the
 * demo can neither be redirected into the journey nor leave a marker behind for
 * the next visitor.
 */
export const onboardingRouter = new Hono()

function demoFlag(c: Context): boolean {
  return isDemoProfile(c.get('userProfile'), requireUserId(c), resolveAuthConfig(process.env))
}

onboardingRouter.get('/', async (c) => {
  const userId = requireUserId(c)
  return ok(
    c,
    onboardingStatusSchema,
    await getOnboardingStatus(db, userId, { isDemo: demoFlag(c) }),
  )
})

onboardingRouter.patch('/', zValidator('json', updateOnboardingSchema), async (c) => {
  const userId = requireUserId(c)
  const { completed } = c.req.valid('json')
  return ok(
    c,
    onboardingStatusSchema,
    await setOnboardingCompleted(db, userId, completed, { isDemo: demoFlag(c) }),
  )
})
