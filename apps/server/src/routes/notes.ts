import { Hono } from 'hono'
import {
  createNoteSchema,
  extractImageResponseSchema,
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
import { requireUserId } from '../http/identity'
import { PayloadTooLargeError, ServiceUnavailableError, ValidationError } from '../http/errors'
import { detectImageMedia, detectSourceType, extractText } from '../services/extract'
import { createNote, deleteNote, getNote, listNotes, updateNote } from '../services/notes.service'
import { resolveOcrProvider } from '../services/ai-config.service'
import { computeOcrWarnings, getVisionExtractor } from '../ai/vision'
import { OCR_INSTRUCTION, OCR_SYSTEM_PROMPT } from '../ai/prompts/ocr.v1'

export const notesRouter = new Hono()

/** 10 MiB upload cap (md/pdf). */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * Effective cap for `/extract-image` (OCR spec §1.2): DISTINCT from
 * `MAX_UPLOAD_BYTES` and kept safely under the Vercel 4.5 MB platform body cap.
 * A guard-rail — the client downscales + pre-validates, so a post-downscale
 * image should never approach it.
 */
const EXTRACT_IMAGE_MAX_BYTES = 4 * 1024 * 1024

/** Actionable HEIC rejection (OCR spec §1.1). */
const HEIC_MESSAGE =
  'Format HEIC non supporté. Réglez l’appareil photo iPhone sur « Le plus compatible » (JPEG), ou convertissez l’image.'

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
    // An image dropped on the doc importer → point the user at the photo flow.
    if (detectImageMedia({ name: file.name, type: file.type }, bytes) !== null) {
      throw new ValidationError('Utilisez l’import photo pour les images')
    }
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
  return ok(c, noteSchema, await createNote(db, requireUserId(c), input), 201)
})

// POST /api/notes/extract-image — photo OCR (OCR spec §2.4). One DOWNSCALED
// image per request → a Markdown transcription. NEVER writes a note: the client
// previews/corrects the text, then creates the note via `POST /api/notes`.
notesRouter.post('/extract-image', async (c) => {
  // Scope the OCR provider resolution to the caller (spec BYOK §1.3): this
  // handler previously skipped `requireUserId`, which would have let it resolve
  // an unscoped provider. A public user without their own key → clean 503.
  const userId = requireUserId(c)
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) {
    throw new ValidationError('file is required')
  }
  // Guard-rail: the client downscales + pre-validates; this only catches bugs /
  // third-party clients that skip the downscale.
  if (file.size > EXTRACT_IMAGE_MAX_BYTES) {
    throw new PayloadTooLargeError('image trop volumineuse après réduction (max 4 Mo)')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const media = detectImageMedia({ name: file.name, type: file.type }, bytes)
  if (media === null) {
    throw new ValidationError('type d’image non supporté (jpg/png/webp)')
  }
  if ('heic' in media) {
    throw new ValidationError(HEIC_MESSAGE)
  }

  // Capacity guard BEFORE any call (mirror of the generations.ts provider guard).
  // Resolves the OCR slot — the SAME provider as generation, or a dedicated one.
  const cfg = await resolveOcrProvider(db, userId)
  if (!cfg) {
    throw new ServiceUnavailableError(
      'Extraction indisponible : aucun fournisseur IA configuré pour l’OCR.',
    )
  }
  const extractor = getVisionExtractor()
  if (!extractor.supportsVision(cfg)) {
    throw new ServiceUnavailableError(
      'Le fournisseur IA configuré ne supporte pas la vision. Choisissez un modèle vision (Claude, GPT-4o, llava…).',
    )
  }

  const { markdown } = await extractor.extract({
    image: bytes,
    mediaType: media.mediaType,
    systemPrompt: OCR_SYSTEM_PROMPT,
    instruction: OCR_INSTRUCTION,
    filename: file.name,
    provider: cfg,
  })
  if (markdown.trim() === '') {
    throw new ValidationError('aucun texte extrait de l’image')
  }

  return ok(c, extractImageResponseSchema, {
    markdown,
    mediaType: media.mediaType,
    warnings: computeOcrWarnings(markdown),
  })
})

// POST /api/notes — JSON (pasted text).
notesRouter.post('/', zValidator('json', createNoteSchema), async (c) => {
  return ok(c, noteSchema, await createNote(db, requireUserId(c), c.req.valid('json')), 201)
})

// GET /api/notes — list, optional subjectId filter.
notesRouter.get('/', zValidator('query', listNotesQuerySchema), async (c) => {
  const q = c.req.valid('query')
  return ok(c, listNotesResponseSchema, await listNotes(db, requireUserId(c), q.subjectId))
})

notesRouter.get('/:id', zValidator('param', idParamSchema), async (c) => {
  return ok(c, noteSchema, await getNote(db, requireUserId(c), c.req.valid('param').id))
})

notesRouter.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateNoteSchema),
  async (c) => {
    return ok(
      c,
      noteSchema,
      await updateNote(db, requireUserId(c), c.req.valid('param').id, c.req.valid('json')),
    )
  },
)

notesRouter.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  await deleteNote(db, requireUserId(c), c.req.valid('param').id)
  return c.body(null, 204)
})
