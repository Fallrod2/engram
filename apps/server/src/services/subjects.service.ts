import { and, asc, eq } from 'drizzle-orm'
import type { CreateSubject, Subject, UpdateSubject } from '@engram/shared'
import type { DB } from '../db/client'
import { subject } from '../db/schema'
import { subjectToDto } from '../db/dto'
import { NotFoundError } from '../http/errors'

/**
 * Fetch a raw subject row or throw 404. Scoped to `userId`: a subject owned by
 * another user reads as "not found" (anti-enumeration — never a 403). Exported
 * for cross-service guards.
 */
export async function requireSubjectRow(db: DB, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(subject)
    .where(and(eq(subject.id, id), eq(subject.userId, userId)))
  if (!row) throw new NotFoundError(`subject ${id} not found`)
  return row
}

export async function listSubjects(
  db: DB,
  userId: string,
  includeArchived: boolean,
): Promise<Subject[]> {
  const rows = await db
    .select()
    .from(subject)
    .where(
      includeArchived
        ? eq(subject.userId, userId)
        : and(eq(subject.userId, userId), eq(subject.archived, false)),
    )
    .orderBy(asc(subject.archived), asc(subject.position), asc(subject.createdAt))
  return rows.map(subjectToDto)
}

export async function getSubject(db: DB, userId: string, id: string): Promise<Subject> {
  return subjectToDto(await requireSubjectRow(db, userId, id))
}

export async function createSubject(
  db: DB,
  userId: string,
  input: CreateSubject,
): Promise<Subject> {
  const [row] = await db
    .insert(subject)
    .values({
      userId,
      name: input.name,
      color: input.color,
      icon: input.icon,
      ...(input.position !== undefined ? { position: input.position } : {}),
    })
    .returning()
  return subjectToDto(row!)
}

export async function updateSubject(
  db: DB,
  userId: string,
  id: string,
  patch: UpdateSubject,
): Promise<Subject> {
  await requireSubjectRow(db, userId, id)
  const set = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
    ...(patch.position !== undefined ? { position: patch.position } : {}),
    ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
  }
  if (Object.keys(set).length === 0) return getSubject(db, userId, id) // empty body: no-op
  const [row] = await db
    .update(subject)
    .set(set)
    .where(and(eq(subject.id, id), eq(subject.userId, userId)))
    .returning()
  return subjectToDto(row!)
}

/** Idempotent archive/unarchive wrapper. */
export async function setSubjectArchived(
  db: DB,
  userId: string,
  id: string,
  archived: boolean,
): Promise<Subject> {
  await requireSubjectRow(db, userId, id)
  const [row] = await db
    .update(subject)
    .set({ archived })
    .where(and(eq(subject.id, id), eq(subject.userId, userId)))
    .returning()
  return subjectToDto(row!)
}

export async function deleteSubject(db: DB, userId: string, id: string): Promise<void> {
  const res = await db
    .delete(subject)
    .where(and(eq(subject.id, id), eq(subject.userId, userId)))
    .returning({ id: subject.id })
  if (res.length === 0) throw new NotFoundError(`subject ${id} not found`)
}
