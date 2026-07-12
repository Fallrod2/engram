import { beforeEach, describe, expect, it } from 'bun:test'
import { studyPlanResponseSchema, studyTodayResponseSchema } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { resetDb, seedCard, seedDeck, seedExam, seedSubject } from '../test-support/harness'

beforeEach(() => resetDb(db))

const NOW_ISO = new Date(2026, 6, 12, 10, 0).toISOString()

describe('study-plan routes', () => {
  it('GET /api/study-plan?from&to → 200 contract-valid', async () => {
    const s = await seedSubject(db)
    const d = await seedDeck(db, s.id)
    await seedCard(db, d.id, { due: new Date(2026, 6, 12, 8, 0) })
    await seedExam(db, [s.id], { date: new Date(2026, 6, 15) })
    const res = await app.request(
      `/api/study-plan?from=2026-07-12&to=2026-07-20&now=${encodeURIComponent(NOW_ISO)}`,
    )
    expect(res.status).toBe(200)
    expect(studyPlanResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('GET without from or to → 400', async () => {
    expect((await app.request('/api/study-plan?to=2026-07-20')).status).toBe(400)
    expect((await app.request('/api/study-plan?from=2026-07-12')).status).toBe(400)
  })

  it('GET from>to → 400', async () => {
    const res = await app.request('/api/study-plan?from=2026-07-20&to=2026-07-12')
    expect(res.status).toBe(400)
  })

  it('GET window > 366 days → 400', async () => {
    const res = await app.request('/api/study-plan?from=2026-01-01&to=2027-12-31')
    expect(res.status).toBe(400)
  })

  it('GET calendarically invalid from → 400', async () => {
    const res = await app.request('/api/study-plan?from=2026-02-30&to=2026-03-05')
    expect(res.status).toBe(400)
    // Contrast: a real date is accepted.
    const okRes = await app.request('/api/study-plan?from=2026-02-28&to=2026-03-05')
    expect(okRes.status).toBe(200)
  })

  it('GET ?subjectId= → 200 scope respected', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    await seedCard(db, (await seedDeck(db, s1.id)).id, { due: new Date(2026, 6, 13, 8, 0) })
    await seedCard(db, (await seedDeck(db, s2.id)).id, { due: new Date(2026, 6, 13, 8, 0) })
    const res = await app.request(
      `/api/study-plan?from=2026-07-12&to=2026-07-15&subjectId=${s1.id}&now=${encodeURIComponent(NOW_ISO)}`,
    )
    const body = studyPlanResponseSchema.parse(await res.json())
    const day = body.days.find((d) => d.date === '2026-07-13')!
    expect(day.dueCount).toBe(1)
    expect(day.bySubject.every((b) => b.subjectId === s1.id)).toBe(true)
  })

  it('GET /api/study-plan/today → 200 contract-valid', async () => {
    const s = await seedSubject(db)
    await seedCard(db, (await seedDeck(db, s.id)).id, { due: new Date(2026, 6, 12, 8, 0) })
    const res = await app.request(`/api/study-plan/today?now=${encodeURIComponent(NOW_ISO)}`)
    expect(res.status).toBe(200)
    expect(studyTodayResponseSchema.safeParse(await res.json()).success).toBe(true)
  })
})
