import { beforeEach, describe, expect, it } from 'bun:test'
import {
  deckSuccessResponseSchema,
  examReadinessResponseSchema,
  hardestCardsResponseSchema,
  heatmapResponseSchema,
  retentionResponseSchema,
  reviewVolumeResponseSchema,
  streaksResponseSchema,
  studyTimeResponseSchema,
} from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import {
  resetDb,
  seedCard,
  seedDeck,
  seedExam,
  seedReviewLog,
  seedSubject,
} from '../test-support/harness'

beforeEach(() => resetDb(db))

const NOW_ISO = new Date(2026, 6, 12, 10, 0).toISOString()
const nowParam = `now=${encodeURIComponent(NOW_ISO)}`

async function seedReviews(
  state = 2,
  rating = 3,
  n = 12,
): Promise<{ subjectId: string; deckId: string }> {
  const s = await seedSubject(db)
  const d = await seedDeck(db, s.id)
  const c = await seedCard(db, d.id)
  for (let i = 0; i < n; i++)
    await seedReviewLog(db, c.id, { state, rating, review: new Date(2026, 6, 12 - i, 12) })
  return { subjectId: s.id, deckId: d.id }
}

describe('analytics routes — contract validity', () => {
  it('GET /api/analytics/heatmap → 200 contract-valid', async () => {
    await seedReviews()
    const res = await app.request(
      `/api/analytics/heatmap?from=2026-06-13&to=2026-07-12&${nowParam}`,
    )
    expect(res.status).toBe(200)
    expect(heatmapResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('GET /api/analytics/heatmap without window → 200, 365 dense days', async () => {
    const res = await app.request(`/api/analytics/heatmap?${nowParam}`)
    expect(res.status).toBe(200)
    const body = heatmapResponseSchema.parse(await res.json())
    expect(body.days.length).toBe(365)
  })

  it('GET /api/analytics/streaks → 200 contract-valid', async () => {
    await seedReviews()
    const res = await app.request(`/api/analytics/streaks?${nowParam}`)
    expect(res.status).toBe(200)
    expect(streaksResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('GET /api/analytics/study-time?granularity=week → 200 weekly buckets', async () => {
    await seedReviews()
    const res = await app.request(
      `/api/analytics/study-time?from=2026-06-13&to=2026-07-12&granularity=week&${nowParam}`,
    )
    expect(res.status).toBe(200)
    const body = studyTimeResponseSchema.parse(await res.json())
    expect(body.granularity).toBe('week')
    expect(body.buckets.length).toBeGreaterThan(0)
  })

  it('GET /api/analytics/review-volume → 200 contract-valid', async () => {
    await seedReviews()
    const res = await app.request(
      `/api/analytics/review-volume?from=2026-07-01&to=2026-07-12&${nowParam}`,
    )
    expect(res.status).toBe(200)
    expect(reviewVolumeResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('GET /api/analytics/retention → 200, below-threshold subject has null', async () => {
    const s = await seedSubject(db)
    const c = await seedCard(db, (await seedDeck(db, s.id)).id)
    for (let i = 0; i < 3; i++) await seedReviewLog(db, c.id, { state: 2, rating: 3 })
    const res = await app.request('/api/analytics/retention')
    expect(res.status).toBe(200)
    const body = retentionResponseSchema.parse(await res.json())
    const found = body.subjects.find((x) => x.subjectId === s.id)
    expect(found?.retention).toBeNull()
    expect(found?.maturedReviewed).toBe(3)
  })

  it('GET /api/analytics/deck-success → 200 contract-valid', async () => {
    await seedReviews()
    const res = await app.request('/api/analytics/deck-success')
    expect(res.status).toBe(200)
    expect(deckSuccessResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('GET /api/analytics/hardest-cards → 200, default limit, never-reviewed absent', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id, { difficulty: 8.1, reps: 5 })
    await seedCard(db, d.id) // pristine: difficulty 0 → excluded
    const res = await app.request('/api/analytics/hardest-cards')
    expect(res.status).toBe(200)
    const body = hardestCardsResponseSchema.parse(await res.json())
    expect(body.limit).toBe(5) // schema default
    expect(body.minReps).toBeGreaterThan(0)
    expect(body.cards.length).toBe(1)
    expect(body.cards[0]?.difficulty).toBeCloseTo(8.1, 10)
  })

  it('GET /api/analytics/hardest-cards?limit=1 → echoes the limit', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    for (const diff of [3, 9]) await seedCard(db, d.id, { difficulty: diff, reps: 4 })
    const res = await app.request('/api/analytics/hardest-cards?limit=1')
    expect(res.status).toBe(200)
    const body = hardestCardsResponseSchema.parse(await res.json())
    expect(body.limit).toBe(1)
    expect(body.cards.length).toBe(1)
    expect(body.cards[0]?.difficulty).toBeCloseTo(9, 10)
  })

  it('GET /api/analytics/hardest-cards?limit=0 → 400', async () => {
    expect((await app.request('/api/analytics/hardest-cards?limit=0')).status).toBe(400)
    expect((await app.request('/api/analytics/hardest-cards?limit=21')).status).toBe(400)
  })
})

describe('analytics routes — window guards (400)', () => {
  it('from > to → 400', async () => {
    const res = await app.request(
      `/api/analytics/heatmap?from=2026-07-20&to=2026-07-12&${nowParam}`,
    )
    expect(res.status).toBe(400)
  })

  it('window > 366 days → 400', async () => {
    const res = await app.request(
      `/api/analytics/heatmap?from=2026-01-01&to=2027-12-31&${nowParam}`,
    )
    expect(res.status).toBe(400)
  })

  it('calendarically invalid from → 400', async () => {
    const res = await app.request(
      `/api/analytics/heatmap?from=2026-02-30&to=2026-03-05&${nowParam}`,
    )
    expect(res.status).toBe(400)
  })

  it('from without to → 400', async () => {
    expect((await app.request(`/api/analytics/heatmap?from=2026-07-01&${nowParam}`)).status).toBe(
      400,
    )
    expect((await app.request(`/api/analytics/heatmap?to=2026-07-01&${nowParam}`)).status).toBe(400)
  })

  it('retention from without to → 400', async () => {
    expect((await app.request('/api/analytics/retention?from=2026-07-01')).status).toBe(400)
  })
})

describe('analytics routes — per-subject narrowing', () => {
  it('every subject-aware endpoint accepts ?subjectId and narrows to it', async () => {
    const a = await seedReviews()
    const b = await seedReviews()
    const q = `subjectId=${a.subjectId}`
    const heat = heatmapResponseSchema.parse(
      await (await app.request(`/api/analytics/heatmap?${q}&${nowParam}`)).json(),
    )
    expect(heat.total).toBe(12)
    const all = heatmapResponseSchema.parse(
      await (await app.request(`/api/analytics/heatmap?${nowParam}`)).json(),
    )
    expect(all.total).toBe(24)

    const ret = retentionResponseSchema.parse(
      await (await app.request(`/api/analytics/retention?${q}`)).json(),
    )
    expect(ret.subjects.map((s) => s.subjectId)).toEqual([a.subjectId])

    const ds = deckSuccessResponseSchema.parse(
      await (await app.request(`/api/analytics/deck-success?subjectId=${b.subjectId}`)).json(),
    )
    expect(ds.decks.map((d) => d.deckId)).toEqual([b.deckId])

    const st = studyTimeResponseSchema.parse(
      await (await app.request(`/api/analytics/study-time?${q}&${nowParam}`)).json(),
    )
    expect(st.totalReviews).toBe(12)

    const rv = reviewVolumeResponseSchema.parse(
      await (await app.request(`/api/analytics/review-volume?${q}&${nowParam}`)).json(),
    )
    expect(rv.totals.total).toBe(12)
  })

  it('an unknown subjectId is an empty result, never a 404', async () => {
    await seedReviews()
    const res = await app.request(`/api/analytics/heatmap?subjectId=ghost&${nowParam}`)
    expect(res.status).toBe(200)
    expect(heatmapResponseSchema.parse(await res.json()).total).toBe(0)
  })
})

describe('analytics routes — exam readiness', () => {
  it('GET /api/analytics/exam-readiness → 200 contract-valid', async () => {
    const s = await seedSubject(db)
    await seedExam(db, [s.id], { date: new Date(2026, 6, 26) })
    const res = await app.request(`/api/analytics/exam-readiness?${nowParam}`)
    expect(res.status).toBe(200)
    const body = examReadinessResponseSchema.parse(await res.json())
    expect(body.threshold).toBe(0.9)
    expect(body.subjects).toHaveLength(1)
    // The tester's case, end to end: an exam ahead on a subject with no card.
    const e = body.subjects[0]!.exams[0]!
    expect(e.status).toBe('no_cards')
    expect(e.daysUntil).toBe(14)
    expect(e.projection?.readiness).toBeNull()
  })

  it('GET /api/analytics/exam-readiness?subjectId=… narrows to one subject', async () => {
    const a = await seedSubject(db)
    await seedSubject(db)
    const res = await app.request(`/api/analytics/exam-readiness?subjectId=${a.id}&${nowParam}`)
    expect(res.status).toBe(200)
    const body = examReadinessResponseSchema.parse(await res.json())
    expect(body.subjects.map((s) => s.subjectId)).toEqual([a.id])
  })

  it('GET /api/analytics/exam-readiness with no subject at all → 200, empty', async () => {
    const res = await app.request(`/api/analytics/exam-readiness?${nowParam}`)
    expect(res.status).toBe(200)
    expect(examReadinessResponseSchema.parse(await res.json()).subjects).toEqual([])
  })
})
