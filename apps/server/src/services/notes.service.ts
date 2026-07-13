import { and, desc, eq } from 'drizzle-orm'
import type { CreateNote, ListNotesResponse, Note, UpdateNote } from '@engram/shared'
import type { DB } from '../db/client'
import { note } from '../db/schema'
import { noteToDto } from '../db/dto'
import { NotFoundError, ConflictError, ValidationError } from '../http/errors'
import { requireSubjectRow } from './subjects.service'

/** Fetch a raw note row (scoped to `userId`) or throw 404. Exported for guards. */
export async function requireNoteRow(db: DB, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(note)
    .where(and(eq(note.id, id), eq(note.userId, userId)))
  if (!row) throw new NotFoundError(`note ${id} not found`)
  return row
}

export async function listNotes(
  db: DB,
  userId: string,
  subjectId?: string,
): Promise<ListNotesResponse> {
  const rows = await db
    .select()
    .from(note)
    .where(
      subjectId
        ? and(eq(note.userId, userId), eq(note.subjectId, subjectId))
        : eq(note.userId, userId),
    )
    .orderBy(desc(note.createdAt))
  return { notes: rows.map(noteToDto) }
}

export async function getNote(db: DB, userId: string, id: string): Promise<Note> {
  return noteToDto(await requireNoteRow(db, userId, id))
}

/** Guard a subject reference: 404 if missing/foreign, 409 if archived. */
async function assertUsableSubject(db: DB, userId: string, subjectId: string): Promise<void> {
  if ((await requireSubjectRow(db, userId, subjectId)).archived) {
    throw new ConflictError('cannot attach a note to an archived subject')
  }
}

export async function createNote(db: DB, userId: string, input: CreateNote): Promise<Note> {
  // Single non-vacuity guard covering BOTH upload and JSON paths without touching
  // the shared Zod schema. The upload route additionally emits a more specific
  // "no extractable text in file" message before reaching here.
  const content = input.content.trim()
  if (!content) throw new ValidationError('note content is empty')

  if (input.subjectId !== undefined) await assertUsableSubject(db, userId, input.subjectId)

  const [row] = await db
    .insert(note)
    .values({
      userId,
      title: input.title,
      sourceType: input.sourceType,
      content,
      ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
      ...(input.originalFilename !== undefined ? { originalFilename: input.originalFilename } : {}),
    })
    .returning()
  return noteToDto(row!)
}

export async function updateNote(
  db: DB,
  userId: string,
  id: string,
  patch: UpdateNote,
): Promise<Note> {
  await requireNoteRow(db, userId, id)
  // Re-attaching to a non-null subject re-checks 404/409.
  if (patch.subjectId !== undefined && patch.subjectId !== null) {
    await assertUsableSubject(db, userId, patch.subjectId)
  }
  const set = {
    ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.sourceType !== undefined ? { sourceType: patch.sourceType } : {}),
    ...(patch.originalFilename !== undefined ? { originalFilename: patch.originalFilename } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
  }
  if (Object.keys(set).length === 0) return getNote(db, userId, id) // empty body: no-op
  const [row] = await db
    .update(note)
    .set(set)
    .where(and(eq(note.id, id), eq(note.userId, userId)))
    .returning()
  return noteToDto(row!)
}

export async function deleteNote(db: DB, userId: string, id: string): Promise<void> {
  const res = await db
    .delete(note)
    .where(and(eq(note.id, id), eq(note.userId, userId)))
    .returning({ id: note.id })
  if (res.length === 0) throw new NotFoundError(`note ${id} not found`)
}
