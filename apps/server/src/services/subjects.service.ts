import { asc, eq } from 'drizzle-orm'
import type { CreateSubject, Subject, UpdateSubject } from '@engram/shared'
import type { DB } from '../db/client'
import { subject } from '../db/schema'
import { subjectToDto } from '../db/dto'
import { NotFoundError } from '../http/errors'

/** Fetch a raw subject row or throw 404. Exported for cross-service guards. */
export async function requireSubjectRow(db: DB, id: string) {
  const [row] = await db.select().from(subject).where(eq(subject.id, id))
  if (!row) throw new NotFoundError(`subject ${id} not found`)
  return row
}

export async function listSubjects(db: DB, includeArchived: boolean): Promise<Subject[]> {
  const rows = await db
    .select()
    .from(subject)
    .where(includeArchived ? undefined : eq(subject.archived, false))
    .orderBy(asc(subject.archived), asc(subject.position), asc(subject.createdAt))
  return rows.map(subjectToDto)
}

export async function getSubject(db: DB, id: string): Promise<Subject> {
  return subjectToDto(await requireSubjectRow(db, id))
}

export async function createSubject(db: DB, input: CreateSubject): Promise<Subject> {
  const [row] = await db
    .insert(subject)
    .values({
      name: input.name,
      color: input.color,
      icon: input.icon,
      ...(input.position !== undefined ? { position: input.position } : {}),
    })
    .returning()
  return subjectToDto(row!)
}

export async function updateSubject(db: DB, id: string, patch: UpdateSubject): Promise<Subject> {
  await requireSubjectRow(db, id)
  const set = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
    ...(patch.position !== undefined ? { position: patch.position } : {}),
    ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
  }
  if (Object.keys(set).length === 0) return getSubject(db, id) // empty body: no-op
  const [row] = await db.update(subject).set(set).where(eq(subject.id, id)).returning()
  return subjectToDto(row!)
}

/** Idempotent archive/unarchive wrapper. */
export async function setSubjectArchived(db: DB, id: string, archived: boolean): Promise<Subject> {
  await requireSubjectRow(db, id)
  const [row] = await db.update(subject).set({ archived }).where(eq(subject.id, id)).returning()
  return subjectToDto(row!)
}

export async function deleteSubject(db: DB, id: string): Promise<void> {
  const res = await db.delete(subject).where(eq(subject.id, id)).returning({ id: subject.id })
  if (res.length === 0) throw new NotFoundError(`subject ${id} not found`)
}
