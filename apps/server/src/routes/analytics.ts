import { Hono } from 'hono'
import {
  deckSuccessQuerySchema,
  deckSuccessResponseSchema,
  examReadinessQuerySchema,
  examReadinessResponseSchema,
  hardestCardsQuerySchema,
  hardestCardsResponseSchema,
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
  examReadiness,
  hardestCards,
  heatmap,
  retention,
  reviewVolume,
  streaks,
  studyTime,
} from '../services/analytics.service'

export const analyticsRouter = new Hono()

/**
 * Every handler below reads its identity through `requireUserId(c)` and hands it
 * to the service, which scopes each query on it. `subjectId` is a FILTER applied
 * on top of that scope, never a substitute for it: it can only ever narrow the
 * caller's own rows, so a forged id reads as empty, never as somebody else's.
 */

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
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
    }),
  )
})

// No `subjectId`: a streak is a habit of the person, not a property of a
// subject — see `streaksQuerySchema` in `@engram/shared`.
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
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
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
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
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
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
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
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
    }),
  )
})

analyticsRouter.get('/hardest-cards', zValidator('query', hardestCardsQuerySchema), async (c) => {
  const q = c.req.valid('query')
  return ok(
    c,
    hardestCardsResponseSchema,
    await hardestCards(db, requireUserId(c), {
      limit: q.limit,
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
    }),
  )
})

/**
 * `GET /api/analytics/exam-readiness` — the forecast: for each subject, its
 * exams and the share of its cards FSRS expects to still be recalled on the day.
 * Omitting `subjectId` returns every non-archived subject (including those with
 * no exam), so the account-wide screen can surface the empty-subject-with-an-exam
 * case without asking subject by subject.
 */
analyticsRouter.get('/exam-readiness', zValidator('query', examReadinessQuerySchema), async (c) => {
  const q = c.req.valid('query')
  const now = q.now ? new Date(q.now) : new Date()
  return ok(
    c,
    examReadinessResponseSchema,
    await examReadiness(db, requireUserId(c), {
      now,
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
    }),
  )
})
