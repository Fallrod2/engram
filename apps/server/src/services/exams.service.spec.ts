import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { exam, examSubject } from '../db/schema'
import { seedSubject } from '../test-support/harness'
import { NotFoundError } from '../http/errors'
import { createExam, deleteExam, getExam, listExams, updateExam } from './exams.service'

let t: TestDb
let db: DB
beforeEach(() => {
  t = createTestDb()
  db = t.db as DB
})
afterEach(() => t.cleanup())

const junctionIds = (examId: string): string[] =>
  db
    .select({ subjectId: examSubject.subjectId })
    .from(examSubject)
    .where(eq(examSubject.examId, examId))
    .all()
    .map((r) => r.subjectId)
    .sort()

describe('createExam', () => {
  it('create_exam_persists_and_links_subjects', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    const dto = createExam(db, {
      title: 'Midterm',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id, s2.id],
    })
    expect(junctionIds(dto.id)).toEqual([s1.id, s2.id].sort())
    expect([...dto.subjectIds].sort()).toEqual([s1.id, s2.id].sort())
  })

  it('create_exam_dedupes_subject_ids', () => {
    const a = seedSubject(db)
    const b = seedSubject(db)
    const dto = createExam(db, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [a.id, a.id, b.id],
    })
    expect(junctionIds(dto.id)).toEqual([a.id, b.id].sort())
    expect([...dto.subjectIds].sort()).toEqual([a.id, b.id].sort())
  })

  it('create_exam_missing_subject_404', () => {
    const s = seedSubject(db)
    expect(() =>
      createExam(db, { title: 'E', date: '2026-08-01T00:00:00.000Z', subjectIds: [s.id, 'nope'] }),
    ).toThrow(NotFoundError)
  })

  it('create_exam_normalizes_date_to_local_midnight', () => {
    const s = seedSubject(db)
    // 2026-08-01 at 14:30 local → stored at local midnight of Aug 1.
    const local = new Date(2026, 7, 1, 14, 30)
    const dto = createExam(db, { title: 'E', date: local.toISOString(), subjectIds: [s.id] })
    const row = db.select().from(exam).where(eq(exam.id, dto.id)).get()!
    expect(row.date.getHours()).toBe(0)
    expect(row.date.getMinutes()).toBe(0)
    expect(row.date.getFullYear()).toBe(2026)
    expect(row.date.getMonth()).toBe(7)
    expect(row.date.getDate()).toBe(1)
  })

  it('create_exam_links_multiple_subjects', () => {
    const ids = [seedSubject(db).id, seedSubject(db).id, seedSubject(db).id]
    const dto = createExam(db, { title: 'E', date: '2026-08-01T00:00:00.000Z', subjectIds: ids })
    expect(dto.subjectIds.length).toBe(3)
  })
})

describe('listExams', () => {
  it('list_exams_sorted_by_date_asc', () => {
    const s = seedSubject(db)
    createExam(db, { title: 'C', date: '2026-08-10T00:00:00.000Z', subjectIds: [s.id] })
    createExam(db, { title: 'A', date: '2026-08-01T00:00:00.000Z', subjectIds: [s.id] })
    createExam(db, { title: 'B', date: '2026-08-05T00:00:00.000Z', subjectIds: [s.id] })
    expect(listExams(db, {}).map((e) => e.title)).toEqual(['A', 'B', 'C'])
  })

  it('list_exams_filter_by_subject', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    const s3 = seedSubject(db)
    const a = createExam(db, {
      title: 'A',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id, s2.id],
    })
    const b = createExam(db, { title: 'B', date: '2026-08-02T00:00:00.000Z', subjectIds: [s2.id] })
    createExam(db, { title: 'C', date: '2026-08-03T00:00:00.000Z', subjectIds: [s3.id] })
    const ids = listExams(db, { subjectId: s2.id })
      .map((e) => e.id)
      .sort()
    expect(ids).toEqual([a.id, b.id].sort())
  })

  it('list_exams_aggregates_subject_ids_no_n_plus_1', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    createExam(db, { title: 'A', date: '2026-08-01T00:00:00.000Z', subjectIds: [s1.id, s2.id] })
    createExam(db, { title: 'B', date: '2026-08-02T00:00:00.000Z', subjectIds: [s1.id] })
    const list = listExams(db, {})
    expect([...list[0]!.subjectIds].sort()).toEqual([s1.id, s2.id].sort())
    expect(list[1]!.subjectIds).toEqual([s1.id])
  })
})

describe('updateExam', () => {
  it('update_exam_replaces_subject_ids', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    const s3 = seedSubject(db)
    const e = createExam(db, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id, s2.id],
    })
    const upd = updateExam(db, e.id, { subjectIds: [s2.id, s3.id] })
    expect(junctionIds(e.id)).toEqual([s2.id, s3.id].sort())
    expect([...upd.subjectIds].sort()).toEqual([s2.id, s3.id].sort())
  })

  it('update_exam_title_only_keeps_subjects', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    const e = createExam(db, {
      title: 'E',
      date: '2026-08-01T00:00:00.000Z',
      subjectIds: [s1.id, s2.id],
    })
    const before = db.select().from(exam).where(eq(exam.id, e.id)).get()!
    const upd = updateExam(db, e.id, { title: 'Renamed' })
    expect(upd.title).toBe('Renamed')
    expect(junctionIds(e.id)).toEqual([s1.id, s2.id].sort())
    const after = db.select().from(exam).where(eq(exam.id, e.id)).get()!
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())
  })

  it('update_exam_subjects_only_bumps_updated_at', () => {
    const s1 = seedSubject(db)
    const s2 = seedSubject(db)
    const e = createExam(db, { title: 'E', date: '2026-08-01T00:00:00.000Z', subjectIds: [s1.id] })
    // Backdate updatedAt so the scope-only bump is unambiguously observable.
    const past = new Date(Date.now() - 60_000)
    db.update(exam).set({ updatedAt: past }).where(eq(exam.id, e.id)).run()
    updateExam(db, e.id, { subjectIds: [s2.id] })
    const after = db.select().from(exam).where(eq(exam.id, e.id)).get()!
    expect(after.updatedAt.getTime()).toBeGreaterThan(past.getTime())
    expect(junctionIds(e.id)).toEqual([s2.id])
  })

  it('update_exam_empty_patch_is_noop', () => {
    const s1 = seedSubject(db)
    const e = createExam(db, { title: 'E', date: '2026-08-01T00:00:00.000Z', subjectIds: [s1.id] })
    const before = db.select().from(exam).where(eq(exam.id, e.id)).get()!
    const upd = updateExam(db, e.id, {})
    expect(upd.title).toBe('E')
    expect(upd.subjectIds).toEqual([s1.id])
    const after = db.select().from(exam).where(eq(exam.id, e.id)).get()!
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  it('update_exam_date_renormalized', () => {
    const s = seedSubject(db)
    const e = createExam(db, { title: 'E', date: '2026-08-01T00:00:00.000Z', subjectIds: [s.id] })
    updateExam(db, e.id, { date: new Date(2026, 8, 15, 9, 0).toISOString() })
    const row = db.select().from(exam).where(eq(exam.id, e.id)).get()!
    expect(row.date.getHours()).toBe(0)
    expect(row.date.getDate()).toBe(15)
    expect(row.date.getMonth()).toBe(8)
  })

  it('update_exam_missing_404', () => {
    expect(() => updateExam(db, 'nope', { title: 'x' })).toThrow(NotFoundError)
  })

  it('update_exam_missing_subject_404_does_not_mutate', () => {
    const s1 = seedSubject(db)
    const e = createExam(db, { title: 'E', date: '2026-08-01T00:00:00.000Z', subjectIds: [s1.id] })
    expect(() => updateExam(db, e.id, { subjectIds: ['nope'] })).toThrow(NotFoundError)
    expect(junctionIds(e.id)).toEqual([s1.id])
  })
})

describe('deleteExam', () => {
  it('delete_exam_cascades_junction', () => {
    const s = seedSubject(db)
    const e = createExam(db, { title: 'E', date: '2026-08-01T00:00:00.000Z', subjectIds: [s.id] })
    deleteExam(db, e.id)
    expect(junctionIds(e.id)).toEqual([])
    expect(() => getExam(db, e.id)).toThrow(NotFoundError)
  })

  it('delete_exam_missing_404', () => {
    expect(() => deleteExam(db, 'nope')).toThrow(NotFoundError)
  })
})
