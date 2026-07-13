import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { exam, examSubject } from '../db/schema'
import { seedSubject } from '../test-support/harness'
import { NotFoundError } from '../http/errors'
import { createExam, deleteExam, getExam, listExams, updateExam } from './exams.service'

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

const junctionIds = async (examId: string): Promise<string[]> =>
  (
    await db
      .select({ subjectId: examSubject.subjectId })
      .from(examSubject)
      .where(eq(examSubject.examId, examId))
  )
    .map((r) => r.subjectId)
    .sort()

describe('createExam', () => {
  it('create_exam_persists_and_links_subjects', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    const dto = await createExam(db, U, {
      title: 'Midterm',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id, s2.id],
    })
    expect(await junctionIds(dto.id)).toEqual([s1.id, s2.id].sort())
    expect([...dto.subjectIds].sort()).toEqual([s1.id, s2.id].sort())
  })

  it('create_exam_dedupes_subject_ids', async () => {
    const a = await seedSubject(db)
    const b = await seedSubject(db)
    const dto = await createExam(db, U, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [a.id, a.id, b.id],
    })
    expect(await junctionIds(dto.id)).toEqual([a.id, b.id].sort())
    expect([...dto.subjectIds].sort()).toEqual([a.id, b.id].sort())
  })

  it('create_exam_missing_subject_404', async () => {
    const s = await seedSubject(db)
    await expect(
      createExam(db, U, {
        title: 'E',
        date: '2026-08-01T00:00:00.000Z',
        subjectIds: [s.id, 'nope'],
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('create_exam_normalizes_date_to_local_midnight', async () => {
    const s = await seedSubject(db)
    // 2026-08-01 at 14:30 local → stored at local midnight of Aug 1.
    const local = new Date(2026, 7, 1, 14, 30)
    const dto = await createExam(db, U, {
      title: 'E',
      date: local.toISOString(),
      subjectIds: [s.id],
    })
    const [row] = await db.select().from(exam).where(eq(exam.id, dto.id))
    expect(row!.date.getHours()).toBe(0)
    expect(row!.date.getMinutes()).toBe(0)
    expect(row!.date.getFullYear()).toBe(2026)
    expect(row!.date.getMonth()).toBe(7)
    expect(row!.date.getDate()).toBe(1)
  })

  it('create_exam_links_multiple_subjects', async () => {
    const ids = [(await seedSubject(db)).id, (await seedSubject(db)).id, (await seedSubject(db)).id]
    const dto = await createExam(db, U, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: ids,
    })
    expect(dto.subjectIds.length).toBe(3)
  })
})

describe('listExams', () => {
  it('list_exams_sorted_by_date_asc', async () => {
    const s = await seedSubject(db)
    await createExam(db, U, { title: 'C', date: '2026-08-10T00:00:00.000Z', subjectIds: [s.id] })
    await createExam(db, U, { title: 'A', date: '2026-08-01T00:00:00.000Z', subjectIds: [s.id] })
    await createExam(db, U, { title: 'B', date: '2026-08-05T00:00:00.000Z', subjectIds: [s.id] })
    expect((await listExams(db, U, {})).map((e) => e.title)).toEqual(['A', 'B', 'C'])
  })

  it('list_exams_filter_by_subject', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    const s3 = await seedSubject(db)
    const a = await createExam(db, U, {
      title: 'A',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id, s2.id],
    })
    const b = await createExam(db, U, {
      title: 'B',
      date: '2026-08-02T00:00:00.000Z',
      subjectIds: [s2.id],
    })
    await createExam(db, U, { title: 'C', date: '2026-08-03T00:00:00.000Z', subjectIds: [s3.id] })
    const ids = (await listExams(db, U, { subjectId: s2.id })).map((e) => e.id).sort()
    expect(ids).toEqual([a.id, b.id].sort())
  })

  it('list_exams_aggregates_subject_ids_no_n_plus_1', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    await createExam(db, U, {
      title: 'A',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id, s2.id],
    })
    await createExam(db, U, { title: 'B', date: '2026-08-02T00:00:00.000Z', subjectIds: [s1.id] })
    const list = await listExams(db, U, {})
    expect([...list[0]!.subjectIds].sort()).toEqual([s1.id, s2.id].sort())
    expect(list[1]!.subjectIds).toEqual([s1.id])
  })
})

describe('updateExam', () => {
  it('update_exam_replaces_subject_ids', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    const s3 = await seedSubject(db)
    const e = await createExam(db, U, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id, s2.id],
    })
    const upd = await updateExam(db, U, e.id, { subjectIds: [s2.id, s3.id] })
    expect(await junctionIds(e.id)).toEqual([s2.id, s3.id].sort())
    expect([...upd.subjectIds].sort()).toEqual([s2.id, s3.id].sort())
  })

  it('update_exam_title_only_keeps_subjects', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    const e = await createExam(db, U, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id, s2.id],
    })
    const [before] = await db.select().from(exam).where(eq(exam.id, e.id))
    const upd = await updateExam(db, U, e.id, { title: 'Renamed' })
    expect(upd.title).toBe('Renamed')
    expect(await junctionIds(e.id)).toEqual([s1.id, s2.id].sort())
    const [after] = await db.select().from(exam).where(eq(exam.id, e.id))
    expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime())
  })

  it('update_exam_subjects_only_bumps_updated_at', async () => {
    const s1 = await seedSubject(db)
    const s2 = await seedSubject(db)
    const e = await createExam(db, U, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id],
    })
    // Backdate updatedAt so the scope-only bump is unambiguously observable.
    const past = new Date(Date.now() - 60_000)
    await db.update(exam).set({ updatedAt: past }).where(eq(exam.id, e.id))
    await updateExam(db, U, e.id, { subjectIds: [s2.id] })
    const [after] = await db.select().from(exam).where(eq(exam.id, e.id))
    expect(after!.updatedAt.getTime()).toBeGreaterThan(past.getTime())
    expect(await junctionIds(e.id)).toEqual([s2.id])
  })

  it('update_exam_empty_patch_is_noop', async () => {
    const s1 = await seedSubject(db)
    const e = await createExam(db, U, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id],
    })
    const [before] = await db.select().from(exam).where(eq(exam.id, e.id))
    const upd = await updateExam(db, U, e.id, {})
    expect(upd.title).toBe('E')
    expect(upd.subjectIds).toEqual([s1.id])
    const [after] = await db.select().from(exam).where(eq(exam.id, e.id))
    expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime())
  })

  it('update_exam_date_renormalized', async () => {
    const s = await seedSubject(db)
    const e = await createExam(db, U, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s.id],
    })
    await updateExam(db, U, e.id, { date: new Date(2026, 8, 15, 9, 0).toISOString() })
    const [row] = await db.select().from(exam).where(eq(exam.id, e.id))
    expect(row!.date.getHours()).toBe(0)
    expect(row!.date.getDate()).toBe(15)
    expect(row!.date.getMonth()).toBe(8)
  })

  it('update_exam_missing_404', async () => {
    await expect(updateExam(db, U, 'nope', { title: 'x' })).rejects.toThrow(NotFoundError)
  })

  it('update_exam_missing_subject_404_does_not_mutate', async () => {
    const s1 = await seedSubject(db)
    const e = await createExam(db, U, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id],
    })
    await expect(updateExam(db, U, e.id, { subjectIds: ['nope'] })).rejects.toThrow(NotFoundError)
    expect(await junctionIds(e.id)).toEqual([s1.id])
  })
})

describe('deleteExam', () => {
  it('delete_exam_cascades_junction', async () => {
    const s = await seedSubject(db)
    const e = await createExam(db, U, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s.id],
    })
    await deleteExam(db, U, e.id)
    expect(await junctionIds(e.id)).toEqual([])
    await expect(getExam(db, U, e.id)).rejects.toThrow(NotFoundError)
  })

  it('delete_exam_missing_404', async () => {
    await expect(deleteExam(db, U, 'nope')).rejects.toThrow(NotFoundError)
  })
})
