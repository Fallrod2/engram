import { desc, eq } from 'drizzle-orm'
import type { CreateNote, ListNotesResponse, Note, UpdateNote } from '@engram/shared'
import type { DB } from '../db/client'
import { note } from '../db/schema'
import { noteToDto } from '../db/dto'
import { NotFoundError, ConflictError, ValidationError } from '../http/errors'
import { requireSubjectRow } from './subjects.service'

/** Fetch a raw note row or throw 404. Exported for cross-service guards. */
export function requireNoteRow(db: DB, id: string) {
  const row = db.select().from(note).where(eq(note.id, id)).get()
  if (!row) throw new NotFoundError(`note ${id} not found`)
  return row
}

export function listNotes(db: DB, subjectId?: string): ListNotesResponse {
  const rows = db
    .select()
    .from(note)
    .where(subjectId ? eq(note.subjectId, subjectId) : undefined)
    .orderBy(desc(note.createdAt))
    .all()
  return { notes: rows.map(noteToDto) }
}

export function getNote(db: DB, id: string): Note {
  return noteToDto(requireNoteRow(db, id))
}

/** Guard a subject reference: 404 if missing, 409 if archived. */
function assertUsableSubject(db: DB, subjectId: string): void {
  if (requireSubjectRow(db, subjectId).archived) {
    throw new ConflictError('cannot attach a note to an archived subject')
  }
}

export function createNote(db: DB, input: CreateNote): Note {
  // Single non-vacuity guard covering BOTH upload and JSON paths without touching
  // the shared Zod schema. The upload route additionally emits a more specific
  // "no extractable text in file" message before reaching here.
  const content = input.content.trim()
  if (!content) throw new ValidationError('note content is empty')

  if (input.subjectId !== undefined) assertUsableSubject(db, input.subjectId)

  const row = db
    .insert(note)
    .values({
      title: input.title,
      sourceType: input.sourceType,
      content,
      ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
      ...(input.originalFilename !== undefined ? { originalFilename: input.originalFilename } : {}),
    })
    .returning()
    .get()
  return noteToDto(row)
}

export function updateNote(db: DB, id: string, patch: UpdateNote): Note {
  requireNoteRow(db, id)
  // Re-attaching to a non-null subject re-checks 404/409.
  if (patch.subjectId !== undefined && patch.subjectId !== null) {
    assertUsableSubject(db, patch.subjectId)
  }
  const set = {
    ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.sourceType !== undefined ? { sourceType: patch.sourceType } : {}),
    ...(patch.originalFilename !== undefined ? { originalFilename: patch.originalFilename } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
  }
  if (Object.keys(set).length === 0) return getNote(db, id) // empty body: no-op
  const row = db.update(note).set(set).where(eq(note.id, id)).returning().get()
  return noteToDto(row)
}

export function deleteNote(db: DB, id: string): void {
  const res = db.delete(note).where(eq(note.id, id)).returning({ id: note.id }).all()
  if (res.length === 0) throw new NotFoundError(`note ${id} not found`)
}
