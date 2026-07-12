import { desc, eq } from 'drizzle-orm'
import type { CreateNote, ListNotesResponse, Note, UpdateNote } from '@engram/shared'
import type { DB } from '../db/client'
import { note } from '../db/schema'
import { noteToDto } from '../db/dto'
import { NotFoundError, ConflictError, ValidationError } from '../http/errors'
import { requireSubjectRow } from './subjects.service'

/** Fetch a raw note row or throw 404. Exported for cross-service guards. */
export async function requireNoteRow(db: DB, id: string) {
  const [row] = await db.select().from(note).where(eq(note.id, id))
  if (!row) throw new NotFoundError(`note ${id} not found`)
  return row
}

export async function listNotes(db: DB, subjectId?: string): Promise<ListNotesResponse> {
  const rows = await db
    .select()
    .from(note)
    .where(subjectId ? eq(note.subjectId, subjectId) : undefined)
    .orderBy(desc(note.createdAt))
  return { notes: rows.map(noteToDto) }
}

export async function getNote(db: DB, id: string): Promise<Note> {
  return noteToDto(await requireNoteRow(db, id))
}

/** Guard a subject reference: 404 if missing, 409 if archived. */
async function assertUsableSubject(db: DB, subjectId: string): Promise<void> {
  if ((await requireSubjectRow(db, subjectId)).archived) {
    throw new ConflictError('cannot attach a note to an archived subject')
  }
}

export async function createNote(db: DB, input: CreateNote): Promise<Note> {
  // Single non-vacuity guard covering BOTH upload and JSON paths without touching
  // the shared Zod schema. The upload route additionally emits a more specific
  // "no extractable text in file" message before reaching here.
  const content = input.content.trim()
  if (!content) throw new ValidationError('note content is empty')

  if (input.subjectId !== undefined) await assertUsableSubject(db, input.subjectId)

  const [row] = await db
    .insert(note)
    .values({
      title: input.title,
      sourceType: input.sourceType,
      content,
      ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
      ...(input.originalFilename !== undefined ? { originalFilename: input.originalFilename } : {}),
    })
    .returning()
  return noteToDto(row!)
}

export async function updateNote(db: DB, id: string, patch: UpdateNote): Promise<Note> {
  await requireNoteRow(db, id)
  // Re-attaching to a non-null subject re-checks 404/409.
  if (patch.subjectId !== undefined && patch.subjectId !== null) {
    await assertUsableSubject(db, patch.subjectId)
  }
  const set = {
    ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.sourceType !== undefined ? { sourceType: patch.sourceType } : {}),
    ...(patch.originalFilename !== undefined ? { originalFilename: patch.originalFilename } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
  }
  if (Object.keys(set).length === 0) return getNote(db, id) // empty body: no-op
  const [row] = await db.update(note).set(set).where(eq(note.id, id)).returning()
  return noteToDto(row!)
}

export async function deleteNote(db: DB, id: string): Promise<void> {
  const res = await db.delete(note).where(eq(note.id, id)).returning({ id: note.id })
  if (res.length === 0) throw new NotFoundError(`note ${id} not found`)
}
