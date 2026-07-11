import { asc, eq } from 'drizzle-orm'
import type { CreateSubject, Subject, UpdateSubject } from '@engram/shared'
import type { DB } from '../db/client'
import { subject } from '../db/schema'
import { subjectToDto } from '../db/dto'
import { NotFoundError } from '../http/errors'

/** Fetch a raw subject row or throw 404. Exported for cross-service guards. */
export function requireSubjectRow(db: DB, id: string) {
  const row = db.select().from(subject).where(eq(subject.id, id)).get()
  if (!row) throw new NotFoundError(`subject ${id} not found`)
  return row
}

export function listSubjects(db: DB, includeArchived: boolean): Subject[] {
  const rows = db
    .select()
    .from(subject)
    .where(includeArchived ? undefined : eq(subject.archived, false))
    .orderBy(asc(subject.archived), asc(subject.position), asc(subject.createdAt))
    .all()
  return rows.map(subjectToDto)
}

export function getSubject(db: DB, id: string): Subject {
  return subjectToDto(requireSubjectRow(db, id))
}

export function createSubject(db: DB, input: CreateSubject): Subject {
  const row = db
    .insert(subject)
    .values({
      name: input.name,
      color: input.color,
      icon: input.icon,
      ...(input.position !== undefined ? { position: input.position } : {}),
    })
    .returning()
    .get()
  return subjectToDto(row)
}

export function updateSubject(db: DB, id: string, patch: UpdateSubject): Subject {
  requireSubjectRow(db, id)
  const set = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
    ...(patch.position !== undefined ? { position: patch.position } : {}),
    ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
  }
  if (Object.keys(set).length === 0) return getSubject(db, id) // empty body: no-op
  const row = db.update(subject).set(set).where(eq(subject.id, id)).returning().get()
  return subjectToDto(row)
}

/** Idempotent archive/unarchive wrapper. */
export function setSubjectArchived(db: DB, id: string, archived: boolean): Subject {
  requireSubjectRow(db, id)
  const row = db.update(subject).set({ archived }).where(eq(subject.id, id)).returning().get()
  return subjectToDto(row)
}

export function deleteSubject(db: DB, id: string): void {
  const res = db.delete(subject).where(eq(subject.id, id)).returning({ id: subject.id }).all()
  if (res.length === 0) throw new NotFoundError(`subject ${id} not found`)
}
