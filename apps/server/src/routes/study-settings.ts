import { Hono } from 'hono'
import {
  studySettingsQuerySchema,
  studySettingsResponseSchema,
  updateStudySettingsSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { requireUserId } from '../http/identity'
import { getStudySettings, updateStudySettings } from '../services/study-settings.service'

/**
 * `/api/study-settings` — the daily pacing pair (new-card limit + daily goal)
 * and where the caller stands today. Both verbs read their identity via
 * `requireUserId(c)` and never touch another account's row.
 *
 * The response always carries the `today` block, so the onboarding step and the
 * dashboard can render "3 / 20 nouvelles aujourd'hui" from a single call — a
 * limit the user cannot see is a limit they cannot understand.
 *
 * `?now=` exists for the same reason it does on `/api/review/queue` and
 * `/api/study-plan`: the local calendar day is computed server-side, and the
 * tests must be able to pin it instead of racing the wall clock.
 */
export const studySettingsRouter = new Hono()

studySettingsRouter.get('/', zValidator('query', studySettingsQuerySchema), async (c) => {
  const { now: nowIso } = c.req.valid('query')
  const now = nowIso ? new Date(nowIso) : new Date()
  return ok(c, studySettingsResponseSchema, await getStudySettings(db, requireUserId(c), now))
})

studySettingsRouter.patch(
  '/',
  zValidator('query', studySettingsQuerySchema),
  zValidator('json', updateStudySettingsSchema),
  async (c) => {
    const { now: nowIso } = c.req.valid('query')
    const now = nowIso ? new Date(nowIso) : new Date()
    // A partial body is the contract: `{}` is a legal no-op that just re-reads.
    const patch = c.req.valid('json')
    return ok(
      c,
      studySettingsResponseSchema,
      await updateStudySettings(db, requireUserId(c), patch, now),
    )
  },
)
