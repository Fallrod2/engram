import { asc, eq, inArray } from 'drizzle-orm'
import type { CreateExam, Exam, UpdateExam } from '@engram/shared'
import type { DB } from '../db/client'
import { exam, examSubject, subject } from '../db/schema'
import { examToDto } from '../db/dto'
import { localMidnight } from '../lib/day'
import { NotFoundError } from '../http/errors'

/** Normalize an incoming ISO datetime to local midnight of that calendar day. */
function normalizeExamDate(iso: string): Date {
  const d = new Date(iso)
  return localMidnight(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Dedupe + assert every subject id exists (404 otherwise). Returns the deduped ids. */
function assertSubjectsExist(db: DB, subjectIds: string[]): string[] {
  const ids = [...new Set(subjectIds)]
  const found = db.select({ id: subject.id }).from(subject).where(inArray(subject.id, ids)).all()
  if (found.length !== ids.length) throw new NotFoundError('one or more subjects not found')
  return ids
}

/** Fetch a raw exam row or throw 404. Exported for cross-service guards. */
export function requireExamRow(db: DB, id: string) {
  const row = db.select().from(exam).where(eq(exam.id, id)).get()
  if (!row) throw new NotFoundError(`exam ${id} not found`)
  return row
}

/** Subject ids linked to a single exam. */
function getSubjectIds(db: DB, examId: string): string[] {
  return db
    .select({ subjectId: examSubject.subjectId })
    .from(examSubject)
    .where(eq(examSubject.examId, examId))
    .all()
    .map((r) => r.subjectId)
}

export function listExams(db: DB, f: { subjectId?: string }): Exam[] {
  const rows = db
    .select()
    .from(exam)
    .where(
      f.subjectId
        ? inArray(
            exam.id,
            db
              .select({ id: examSubject.examId })
              .from(examSubject)
              .where(eq(examSubject.subjectId, f.subjectId)),
          )
        : undefined,
    )
    .orderBy(asc(exam.date), asc(exam.createdAt))
    .all()

  if (rows.length === 0) return []

  // Aggregate subject ids for all exams in ONE query (avoids N+1).
  const links = db
    .select({ examId: examSubject.examId, subjectId: examSubject.subjectId })
    .from(examSubject)
    .where(
      inArray(
        examSubject.examId,
        rows.map((r) => r.id),
      ),
    )
    .all()
  const byExam = new Map<string, string[]>()
  for (const l of links) {
    const list = byExam.get(l.examId)
    if (list) list.push(l.subjectId)
    else byExam.set(l.examId, [l.subjectId])
  }
  return rows.map((r) => examToDto(r, byExam.get(r.id) ?? []))
}

export function getExam(db: DB, id: string): Exam {
  const row = requireExamRow(db, id)
  return examToDto(row, getSubjectIds(db, id))
}

export function createExam(db: DB, input: CreateExam): Exam {
  const ids = assertSubjectsExist(db, input.subjectIds)
  return db.transaction((tx) => {
    const row = tx
      .insert(exam)
      .values({
        title: input.title,
        date: normalizeExamDate(input.date),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      .returning()
      .get()
    for (const subjectId of ids) {
      tx.insert(examSubject).values({ examId: row.id, subjectId }).run()
    }
    return examToDto(row, ids)
  })
}

export function updateExam(db: DB, id: string, patch: UpdateExam): Exam {
  requireExamRow(db, id)
  const set = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.date !== undefined ? { date: normalizeExamDate(patch.date) } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
  }
  // Empty patch (both columns and subjectIds untouched): no-op, never `set({})`.
  if (Object.keys(set).length === 0 && patch.subjectIds === undefined) return getExam(db, id)

  // Validate subject existence BEFORE mutating (404 rolls nothing back).
  const ids = patch.subjectIds !== undefined ? assertSubjectsExist(db, patch.subjectIds) : undefined

  return db.transaction((tx) => {
    if (Object.keys(set).length > 0) {
      tx.update(exam).set(set).where(eq(exam.id, id)).run()
    }
    if (ids !== undefined) {
      // Replace the junction wholesale to reflect the new scope.
      tx.delete(examSubject).where(eq(examSubject.examId, id)).run()
      for (const subjectId of ids) {
        tx.insert(examSubject).values({ examId: id, subjectId }).run()
      }
      // A scope-only change still bumps updatedAt (columns `set` was empty).
      if (Object.keys(set).length === 0) {
        tx.update(exam).set({ updatedAt: new Date() }).where(eq(exam.id, id)).run()
      }
    }
    const row = tx.select().from(exam).where(eq(exam.id, id)).get()
    if (!row) throw new NotFoundError(`exam ${id} not found`)
    const currentIds =
      ids ??
      tx
        .select({ subjectId: examSubject.subjectId })
        .from(examSubject)
        .where(eq(examSubject.examId, id))
        .all()
        .map((r) => r.subjectId)
    return examToDto(row, currentIds)
  })
}

export function deleteExam(db: DB, id: string): void {
  const res = db.delete(exam).where(eq(exam.id, id)).returning({ id: exam.id }).all()
  if (res.length === 0) throw new NotFoundError(`exam ${id} not found`)
}
