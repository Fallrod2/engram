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
import {
  deckSuccess,
  heatmap,
  retention,
  reviewVolume,
  streaks,
  studyTime,
} from '../services/analytics.service'

export const analyticsRouter = new Hono()

analyticsRouter.get('/heatmap', zValidator('query', heatmapQuerySchema), (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(
    c,
    heatmapResponseSchema,
    heatmap(db, {
      now,
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    }),
  )
})

analyticsRouter.get('/streaks', zValidator('query', streaksQuerySchema), (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(c, streaksResponseSchema, streaks(db, now))
})

analyticsRouter.get('/study-time', zValidator('query', studyTimeQuerySchema), (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(
    c,
    studyTimeResponseSchema,
    studyTime(db, {
      now,
      granularity: q.granularity,
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    }),
  )
})

analyticsRouter.get('/review-volume', zValidator('query', reviewVolumeQuerySchema), (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(
    c,
    reviewVolumeResponseSchema,
    reviewVolume(db, {
      now,
      granularity: q.granularity,
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    }),
  )
})

analyticsRouter.get('/retention', zValidator('query', retentionQuerySchema), (c) => {
  const q = c.req.valid('query')
  return ok(
    c,
    retentionResponseSchema,
    retention(db, {
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    }),
  )
})

analyticsRouter.get('/deck-success', zValidator('query', deckSuccessQuerySchema), (c) => {
  const q = c.req.valid('query')
  return ok(
    c,
    deckSuccessResponseSchema,
    deckSuccess(db, {
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
    }),
  )
})
