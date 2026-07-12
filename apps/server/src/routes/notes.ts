import { Hono } from 'hono'
import {
  createNoteSchema,
  idParamSchema,
  listNotesQuerySchema,
  listNotesResponseSchema,
  noteSchema,
  updateNoteSchema,
  uploadNoteMetaSchema,
  type CreateNote,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { PayloadTooLargeError, ValidationError } from '../http/errors'
import { detectSourceType, extractText } from '../services/extract'
import { createNote, deleteNote, getNote, listNotes, updateNote } from '../services/notes.service'

export const notesRouter = new Hono()

/** 10 MiB upload cap. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** Strip the final extension from a filename (`notes.pdf` → `notes`). */
function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

// POST /api/notes/upload — multipart import (the core of Phase 3).
notesRouter.post('/upload', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) {
    throw new ValidationError('file is required')
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError('file too large (max 10 MiB)')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const sourceType = detectSourceType({ name: file.name, type: file.type }, bytes)
  if (!sourceType) {
    throw new ValidationError('unsupported file type (md/pdf only)')
  }

  const extracted = await extractText(bytes, sourceType)
  if (extracted.trim() === '') {
    throw new ValidationError('no extractable text in file')
  }

  const rawTitle = typeof body['title'] === 'string' ? body['title'] : undefined
  const rawSubjectId = typeof body['subjectId'] === 'string' ? body['subjectId'] : undefined
  const meta = uploadNoteMetaSchema.safeParse({
    ...(rawTitle !== undefined ? { title: rawTitle } : {}),
    ...(rawSubjectId !== undefined ? { subjectId: rawSubjectId } : {}),
  })
  if (!meta.success) {
    throw new ValidationError('invalid upload metadata', meta.error.flatten())
  }

  const input: CreateNote = {
    title: meta.data.title ?? baseName(file.name),
    sourceType,
    originalFilename: file.name,
    content: extracted,
    ...(meta.data.subjectId !== undefined ? { subjectId: meta.data.subjectId } : {}),
  }
  return ok(c, noteSchema, createNote(db, input), 201)
})

// POST /api/notes — JSON (pasted text).
notesRouter.post('/', zValidator('json', createNoteSchema), (c) => {
  return ok(c, noteSchema, createNote(db, c.req.valid('json')), 201)
})

// GET /api/notes — list, optional subjectId filter.
notesRouter.get('/', zValidator('query', listNotesQuerySchema), (c) => {
  const q = c.req.valid('query')
  return ok(c, listNotesResponseSchema, listNotes(db, q.subjectId))
})

notesRouter.get('/:id', zValidator('param', idParamSchema), (c) => {
  return ok(c, noteSchema, getNote(db, c.req.valid('param').id))
})

notesRouter.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateNoteSchema),
  (c) => {
    return ok(c, noteSchema, updateNote(db, c.req.valid('param').id, c.req.valid('json')))
  },
)

notesRouter.delete('/:id', zValidator('param', idParamSchema), (c) => {
  deleteNote(db, c.req.valid('param').id)
  return c.body(null, 204)
})
