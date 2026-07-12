import { Hono } from 'hono'
import {
  studyPlanQuerySchema,
  studyPlanResponseSchema,
  studyTodayQuerySchema,
  studyTodayResponseSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { studyPlan, studyToday } from '../services/study-plan.service'

export const studyPlanRouter = new Hono()

studyPlanRouter.get('/', zValidator('query', studyPlanQuerySchema), async (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(
    c,
    studyPlanResponseSchema,
    await studyPlan(db, {
      from: q.from,
      to: q.to,
      now,
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
    }),
  )
})

studyPlanRouter.get('/today', zValidator('query', studyTodayQuerySchema), async (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(c, studyTodayResponseSchema, await studyToday(db, now))
})
