import { Hono } from 'hono'
import {
  deckSuccessQuerySchema,
  deckSuccessResponseSchema,
  heatmapQuerySchema,
  heatmapResponseSchema,
  retentionQuerySchema,
  retentionResponseSchema,
  reviewVolumeQuerySchema,
  reviewVolumeResponseSchema,
  streaksQuerySchema,
  streaksResponseSchema,
  studyTimeQuerySchema,
  studyTimeResponseSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { requireUserId } from '../http/identity'
import {
  deckSuccess,
  heatmap,
  retention,
  reviewVolume,
  streaks,
  studyTime,
} from '../services/analytics.service'

export const analyticsRouter = new Hono()

analyticsRouter.get('/heatmap', zValidator('query', heatmapQuerySchema), async (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(
    c,
    heatmapResponseSchema,
    await heatmap(db, requireUserId(c), {
      now,
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    }),
  )
})

analyticsRouter.get('/streaks', zValidator('query', streaksQuerySchema), async (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(c, streaksResponseSchema, await streaks(db, requireUserId(c), now))
})

analyticsRouter.get('/study-time', zValidator('query', studyTimeQuerySchema), async (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(
    c,
    studyTimeResponseSchema,
    await studyTime(db, requireUserId(c), {
      now,
      granularity: q.granularity,
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    }),
  )
})

analyticsRouter.get('/review-volume', zValidator('query', reviewVolumeQuerySchema), async (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(
    c,
    reviewVolumeResponseSchema,
    await reviewVolume(db, requireUserId(c), {
      now,
      granularity: q.granularity,
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    }),
  )
})

analyticsRouter.get('/retention', zValidator('query', retentionQuerySchema), async (c) => {
  const q = c.req.valid('query')
  return ok(
    c,
    retentionResponseSchema,
    await retention(db, requireUserId(c), {
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    }),
  )
})

analyticsRouter.get('/deck-success', zValidator('query', deckSuccessQuerySchema), async (c) => {
  const q = c.req.valid('query')
  return ok(
    c,
    deckSuccessResponseSchema,
    await deckSuccess(db, requireUserId(c), {
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    }),
  )
})
