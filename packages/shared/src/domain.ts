import { z } from 'zod'

/**
 * Domain contract for engram's API — the single source of truth for every
 * request/response shape. Server and web both import the inferred types so
 * they can never drift apart.
 *
 * Representation rules (see WS-B spec §7):
 * - Datetimes cross the API as ISO-8601 strings (`iso`); the DB stores epoch
 *   ms and ts-fsrs uses `Date`. The only conversion point lives in the server.
 * - FSRS enums are re-declared here as Zod literals; this package must NOT
 *   depend on `ts-fsrs` or `drizzle-orm`. A server-side test guards these
 *   literals against the real ts-fsrs enum values.
 */

/** ISO-8601 datetime string (with ms), e.g. `new Date().toISOString()`. */
const iso = z.string().datetime()

/** Hex color `#rrggbb`, validated for `subject.color`. */
export const colorHexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)

// --- FSRS enums (mirror ts-fsrs 5.4.1; guarded by a server test) ----------

/** ts-fsrs `State`: New(0) / Learning(1) / Review(2) / Relearning(3). */
export const fsrsStateSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])

/** ts-fsrs `Rating`: Manual(0) / Again(1) / Hard(2) / Good(3) / Easy(4). */
export const fsrsRatingSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
])

/** ts-fsrs `Grade` (a rating produced by a normal session): 1..4. */
export const fsrsGradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])

export type FsrsState = z.infer<typeof fsrsStateSchema>
export type FsrsRating = z.infer<typeof fsrsRatingSchema>
export type FsrsGrade = z.infer<typeof fsrsGradeSchema>

// --- Entities (read DTOs) --------------------------------------------------

export const subjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: colorHexSchema,
  icon: z.string(),
  position: z.number().int(),
  archived: z.boolean(),
  createdAt: iso,
  updatedAt: iso,
})

export const deckSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  position: z.number().int(),
  createdAt: iso,
  updatedAt: iso,
})

/** The FSRS state of a card, camelCase with ISO dates. */
export const fsrsCardStateSchema = z.object({
  due: iso,
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number().int(),
  scheduledDays: z.number().int(),
  learningSteps: z.number().int(),
  reps: z.number().int(),
  lapses: z.number().int(),
  state: fsrsStateSchema,
  lastReview: iso.nullable(),
})

export const cardSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  front: z.string(),
  back: z.string(),
  fsrs: fsrsCardStateSchema,
  createdAt: iso,
  updatedAt: iso,
})

export const reviewLogSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  rating: fsrsRatingSchema,
  state: fsrsStateSchema,
  due: iso,
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number().int(),
  lastElapsedDays: z.number().int(),
  scheduledDays: z.number().int(),
  learningSteps: z.number().int(),
  review: iso,
  durationMs: z.number().int().nullable(),
  createdAt: iso,
})

export const sourceTypeSchema = z.enum(['md', 'pdf'])

export const noteSchema = z.object({
  id: z.string(),
  subjectId: z.string().nullable(),
  title: z.string(),
  sourceType: sourceTypeSchema,
  originalFilename: z.string().nullable(),
  content: z.string(),
  createdAt: iso,
  updatedAt: iso,
})

export const generationItemStatusSchema = z.enum(['pending', 'accepted', 'edited', 'rejected'])

export const generationItemSchema = z.object({
  id: z.string(),
  front: z.string(),
  back: z.string(),
  status: generationItemStatusSchema,
  cardId: z.string().optional(),
})

export const generationKindSchema = z.enum(['cards', 'quiz'])
export const generationStatusSchema = z.enum(['pending', 'succeeded', 'failed'])

export const generationSchema = z.object({
  id: z.string(),
  noteId: z.string(),
  deckId: z.string().nullable(),
  kind: generationKindSchema,
  status: generationStatusSchema,
  model: z.string(),
  items: z.array(generationItemSchema),
  promptTokens: z.number().int().nullable(),
  completionTokens: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
})

export const examSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: iso,
  notes: z.string().nullable(),
  subjectIds: z.array(z.string()),
  createdAt: iso,
  updatedAt: iso,
})

export type Subject = z.infer<typeof subjectSchema>
export type Deck = z.infer<typeof deckSchema>
export type FsrsCardState = z.infer<typeof fsrsCardStateSchema>
export type Card = z.infer<typeof cardSchema>
export type ReviewLog = z.infer<typeof reviewLogSchema>
export type SourceType = z.infer<typeof sourceTypeSchema>
export type Note = z.infer<typeof noteSchema>
export type GenerationItem = z.infer<typeof generationItemSchema>
export type GenerationItemStatus = z.infer<typeof generationItemStatusSchema>
export type GenerationKind = z.infer<typeof generationKindSchema>
export type GenerationStatus = z.infer<typeof generationStatusSchema>
export type Generation = z.infer<typeof generationSchema>
export type Exam = z.infer<typeof examSchema>

// --- Payloads (create / update) -------------------------------------------

export const createSubjectSchema = z.object({
  name: z.string().min(1),
  color: colorHexSchema,
  icon: z.string().min(1),
  position: z.number().int().optional(),
})

export const updateSubjectSchema = createSubjectSchema.partial().extend({
  archived: z.boolean().optional(),
})

export const createDeckSchema = z.object({
  subjectId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
})

/** `subjectId` is immutable once a deck exists. */
export const updateDeckSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    position: z.number().int(),
  })
  .partial()

/**
 * FSRS fields are never accepted from the client: the server seeds card state
 * with `createEmptyCard(new Date())`.
 */
export const createCardSchema = z.object({
  deckId: z.string(),
  front: z.string(),
  back: z.string(),
})

/** Updating a card never touches its FSRS state. */
export const updateCardSchema = z
  .object({
    front: z.string(),
    back: z.string(),
  })
  .partial()

/** Submitting a grade during a review session. */
export const reviewCardSchema = z.object({
  grade: fsrsGradeSchema,
  durationMs: z.number().int().nonnegative().optional(),
  reviewedAt: iso.optional(),
})

export const createNoteSchema = z.object({
  subjectId: z.string().optional(),
  title: z.string().min(1),
  sourceType: sourceTypeSchema,
  originalFilename: z.string().optional(),
  content: z.string(),
})

export const updateNoteSchema = z
  .object({
    subjectId: z.string().nullable(),
    title: z.string().min(1),
    sourceType: sourceTypeSchema,
    originalFilename: z.string().nullable(),
    content: z.string(),
  })
  .partial()

export const startGenerationSchema = z.object({
  noteId: z.string(),
  kind: generationKindSchema,
  deckId: z.string().optional(),
})

/** Human review of generated items before insertion. */
export const resolveGenerationSchema = z.object({
  items: z.array(generationItemSchema),
})

export const createExamSchema = z.object({
  title: z.string().min(1),
  date: iso,
  notes: z.string().optional(),
  subjectIds: z.array(z.string()).min(1),
})

export const updateExamSchema = z
  .object({
    title: z.string().min(1),
    date: iso,
    notes: z.string().nullable(),
    subjectIds: z.array(z.string()).min(1),
  })
  .partial()

export type CreateSubject = z.infer<typeof createSubjectSchema>
export type UpdateSubject = z.infer<typeof updateSubjectSchema>
export type CreateDeck = z.infer<typeof createDeckSchema>
export type UpdateDeck = z.infer<typeof updateDeckSchema>
export type CreateCard = z.infer<typeof createCardSchema>
export type UpdateCard = z.infer<typeof updateCardSchema>
export type ReviewCard = z.infer<typeof reviewCardSchema>
export type CreateNote = z.infer<typeof createNoteSchema>
export type UpdateNote = z.infer<typeof updateNoteSchema>
export type StartGeneration = z.infer<typeof startGenerationSchema>
export type ResolveGeneration = z.infer<typeof resolveGenerationSchema>
export type CreateExam = z.infer<typeof createExamSchema>
export type UpdateExam = z.infer<typeof updateExamSchema>

// --- API error envelope (single error contract) ---------------------------

export const apiErrorCodeSchema = z.enum([
  'validation_error',
  'not_found',
  'conflict',
  'internal_error',
])
export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>

// --- Query helpers ---------------------------------------------------------

/** `'true'`/`'false'` query string → boolean. */
const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true')

// --- Params & queries ------------------------------------------------------

/** Single definition of the `:id` path param (a missing/malformed id 404s, not 400). */
export const idParamSchema = z.object({ id: z.string().min(1) })

export const listSubjectsQuerySchema = z.object({ includeArchived: boolParam.optional() })
export const listDecksQuerySchema = z.object({ subjectId: z.string().optional() })
export const listCardsQuerySchema = z.object({
  deckId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
export const previewQuerySchema = z.object({ now: iso.optional() })
export const reviewQueueQuerySchema = z.object({
  deckId: z.string().optional(),
  subjectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  now: iso.optional(),
})
export const reviewCountsQuerySchema = z.object({ now: iso.optional() })

export type ListSubjectsQuery = z.infer<typeof listSubjectsQuerySchema>
export type ListDecksQuery = z.infer<typeof listDecksQuerySchema>
export type ListCardsQuery = z.infer<typeof listCardsQuerySchema>
export type PreviewQuery = z.infer<typeof previewQuerySchema>
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>
export type ReviewCountsQuery = z.infer<typeof reviewCountsQuerySchema>

// --- Composite responses ---------------------------------------------------

export const listCardsResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  cards: z.array(cardSchema),
})
export const reviewQueueResponseSchema = z.object({
  now: iso,
  total: z.number().int().nonnegative(),
  cards: z.array(cardSchema),
})
export const reviewResultSchema = z.object({ card: cardSchema, log: reviewLogSchema })
export const dueCountsSchema = z.object({
  now: iso,
  total: z.number().int().nonnegative(),
  bySubject: z.array(z.object({ subjectId: z.string(), dueCount: z.number().int().nonnegative() })),
  byDeck: z.array(
    z.object({
      deckId: z.string(),
      subjectId: z.string(),
      dueCount: z.number().int().nonnegative(),
    }),
  ),
})

/** Projected outcome of a single grade (read-only preview of the 4 buttons). */
export const gradePreviewSchema = z.object({
  due: iso,
  stability: z.number(),
  difficulty: z.number(),
  scheduledDays: z.number().int().nonnegative(),
  state: fsrsStateSchema,
})
export const reviewPreviewSchema = z.object({
  now: iso,
  again: gradePreviewSchema,
  hard: gradePreviewSchema,
  good: gradePreviewSchema,
  easy: gradePreviewSchema,
})

export type ListCardsResponse = z.infer<typeof listCardsResponseSchema>
export type ReviewQueueResponse = z.infer<typeof reviewQueueResponseSchema>
export type ReviewResult = z.infer<typeof reviewResultSchema>
export type DueCounts = z.infer<typeof dueCountsSchema>
export type GradePreview = z.infer<typeof gradePreviewSchema>
export type ReviewPreview = z.infer<typeof reviewPreviewSchema>
