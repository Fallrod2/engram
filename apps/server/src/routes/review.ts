import { Hono } from 'hono'
import {
  dueCountsSchema,
  reviewCountsQuerySchema,
  reviewQueueQuerySchema,
  reviewQueueResponseSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { requireUserId } from '../http/identity'
import { dueCounts, dueQueue, type QueueFilter } from '../services/review-queue.service'

export const reviewRouter = new Hono()

reviewRouter.get('/queue', zValidator('query', reviewQueueQuerySchema), async (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  const filter: QueueFilter = {
    limit: q.limit ?? 50,
    now,
    ...(q.deckId ? { deckId: q.deckId } : {}),
    ...(q.subjectId ? { subjectId: q.subjectId } : {}),
  }
  const { total, cards } = await dueQueue(db, requireUserId(c), filter)
  return ok(c, reviewQueueResponseSchema, { now: now.toISOString(), total, cards })
})

reviewRouter.get('/counts', zValidator('query', reviewCountsQuerySchema), async (c) => {
  const { now: nowIso } = c.req.valid('query')
  const now = nowIso ? new Date(nowIso) : new Date()
  const counts = await dueCounts(db, requireUserId(c), now)
  return ok(c, dueCountsSchema, { now: now.toISOString(), ...counts })
})
