import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { examSchema } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { examSubject } from '../db/schema'
import { resetDb, seedExam, seedSubject } from '../test-support/harness'

beforeEach(() => resetDb(db))

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const patchJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('exams routes', () => {
  it('POST valid → 201 contract-valid', async () => {
    const s = await seedSubject(db)
    const res = await postJson('/api/exams', {
      title: 'Final',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s.id],
    })
    expect(res.status).toBe(201)
    expect(examSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('POST empty subjectIds → 400', async () => {
    const res = await postJson('/api/exams', {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [],
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { details?: unknown } }
    expect(body.error.details).toBeDefined()
  })

  it('POST unknown subject → 404', async () => {
    const res = await postJson('/api/exams', {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: ['nope'],
    })
    expect(res.status).toBe(404)
  })

  it('POST malformed date → 400', async () => {
    const s = await seedSubject(db)
    const res = await postJson('/api/exams', {
      title: 'E',
      date: 'not-a-date',
      subjectIds: [s.id],
    })
    expect(res.status).toBe(400)
  })

  it('GET /api/exams sorted by date', async () => {
    const s = await seedSubject(db)
    await seedExam(db, [s.id], { title: 'Later', date: new Date(2026, 7, 10) })
    await seedExam(db, [s.id], { title: 'Sooner', date: new Date(2026, 7, 1) })
    const body = (await (await app.request('/api/exams')).json()) as { title: string }[]
    expect(body.map((e) => e.title)).toEqual(['Sooner', 'Later'])
  })

  it('GET /api/exams?subjectId= filters', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    await seedExam(db, [s1.id])
    await seedExam(db, [s2.id])
    const body = (await (await app.request(`/api/exams?subjectId=${s1.id}`)).json()) as unknown[]
    expect(body).toHaveLength(1)
  })

  it('GET /api/exams/:id unknown → 404', async () => {
    expect((await app.request('/api/exams/nope')).status).toBe(404)
  })

  it('PATCH replaces subjectIds → 200 reflects new scope', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    const e = await seedExam(db, [s1.id])
    const res = await patchJson(`/api/exams/${e.id}`, { subjectIds: [s2.id] })
    const body = examSchema.parse(await res.json())
    expect(body.subjectIds).toEqual([s2.id])
  })

  it('PATCH {} → 200 returns the exam unchanged', async () => {
    const s = await seedSubject(db)
    const e = await seedExam(db, [s.id], { title: 'Keep' })
    const res = await patchJson(`/api/exams/${e.id}`, {})
    expect(res.status).toBe(200)
    const body = examSchema.parse(await res.json())
    expect(body.title).toBe('Keep')
    expect(body.subjectIds).toEqual([s.id])
  })

  it('DELETE → 204 and junction rows gone', async () => {
    const s = await seedSubject(db)
    const e = await seedExam(db, [s.id])
    expect((await app.request(`/api/exams/${e.id}`, { method: 'DELETE' })).status).toBe(204)
    const rows = await db.select().from(examSubject).where(eq(examSubject.examId, e.id))
    expect(rows).toHaveLength(0)
  })
})
