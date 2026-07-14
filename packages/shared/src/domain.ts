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

export const sourceTypeSchema = z.enum(['md', 'pdf', 'image'])

/**
 * Media types accepted by the photo-OCR vision path (`POST /api/notes/extract-image`).
 * The shared denominator of the vision APIs (Anthropic / OpenAI-compatible /
 * Ollama). GIF and HEIC are excluded (OCR spec §1.1).
 */
export const visionMediaTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Structured OCR warning code (OCR spec §2.3). The server counts the uncertainty
 * markers the prompt emits and returns language-agnostic codes; the client
 * resolves them to localized text via the dictionary (mirrors the OCR error
 * codes in `features/ocr/errors.ts`). `kind`:
 *  - `uncertain`  → `count` `[?]` markers in the transcription
 *  - `illegible`  → `count` `[illisible]` passages
 */
export const ocrWarningSchema = z.object({
  kind: z.enum(['uncertain', 'illegible']),
  count: z.number().int().nonnegative(),
})
export type OcrWarning = z.infer<typeof ocrWarningSchema>

/**
 * Response of `POST /api/notes/extract-image` (OCR spec §2.4). The endpoint
 * NEVER writes a note — the transcription is previewed/corrected client-side
 * before `POST /api/notes` creates the note (`sourceType: 'image'`). `warnings`
 * are deterministic, language-agnostic codes derived from the Markdown
 * (`[?]` / `[illisible]`), localized at the display point.
 */
export const extractImageResponseSchema = z.object({
  markdown: z.string(),
  mediaType: visionMediaTypeSchema,
  warnings: z.array(ocrWarningSchema),
})

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

/**
 * Per-item output format decided by the 'mixed' evaluator (spec §2). `qa` =
 * classic front/back; `cloze` = a materialised fill-in-the-blank card. Absent on
 * legacy items and on `cards`/`quiz` items → the review UI shows no format badge.
 */
export const generationItemKindSchema = z.enum(['qa', 'cloze'])

/**
 * The pedagogical classification the 'mixed' evaluator assigns to a knowledge
 * unit before choosing its format (spec §2.2). Drives the discreet second badge.
 */
export const generationItemContentTypeSchema = z.enum([
  'definition',
  'formula',
  'list',
  'fact',
  'concept',
])

export const generationItemSchema = z.object({
  id: z.string(),
  front: z.string(),
  back: z.string(),
  status: generationItemStatusSchema,
  cardId: z.string().optional(),
  // --- 'mixed' generation metadata (spec §2.3). Additive & optional: legacy
  // items and cards/quiz items omit them entirely, so existing jsonb rows stay
  // valid with no data migration, and only mixed items carry review badges. ---
  kind: generationItemKindSchema.optional(),
  contentType: generationItemContentTypeSchema.optional(),
  /** The original cloze template (`{{cN::…}}`) a materialised cloze expanded from. */
  clozeText: z.string().optional(),
})

export const generationKindSchema = z.enum(['cards', 'quiz', 'mixed'])
export const generationStatusSchema = z.enum(['pending', 'succeeded', 'failed'])

export const generationSchema = z.object({
  id: z.string(),
  noteId: z.string(),
  deckId: z.string().nullable(),
  kind: generationKindSchema,
  status: generationStatusSchema,
  model: z.string(),
  /** Provider used for this run (nullable: rows created before multi-provider). */
  provider: z.string().nullable(),
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
export type VisionMediaType = z.infer<typeof visionMediaTypeSchema>
export type ExtractImageResponse = z.infer<typeof extractImageResponseSchema>
export type Note = z.infer<typeof noteSchema>
export type GenerationItem = z.infer<typeof generationItemSchema>
export type GenerationItemStatus = z.infer<typeof generationItemStatusSchema>
export type GenerationItemKind = z.infer<typeof generationItemKindSchema>
export type GenerationItemContentType = z.infer<typeof generationItemContentTypeSchema>
export type GenerationKind = z.infer<typeof generationKindSchema>
export type GenerationStatus = z.infer<typeof generationStatusSchema>
export type Generation = z.infer<typeof generationSchema>
export type Exam = z.infer<typeof examSchema>

// --- AI providers (multi-provider generation config) ----------------------
//
// Single source of truth for the AI settings surface. NO schema here ever
// carries a secret: keys are write-only end to end (sent, never read back).

export const aiProviderIdSchema = z.enum([
  'anthropic',
  'openrouter',
  'ollama',
  'openai-compat',
  'mistral',
  // Subscription provider: linked via ChatGPT/Codex OAuth device-code, not a key.
  'openai-codex',
])

/**
 * Non-secret per-provider config (model + optional base URL). `baseUrl` accepts
 * a valid URL OR the empty string (the "not yet configured" state for
 * openai-compat), so the default config round-trips through this schema.
 */
export const aiProviderConfigSchema = z.object({
  model: z.string(),
  baseUrl: z.union([z.string().url(), z.literal('')]).optional(), // ollama / openai-compat
})

/**
 * Full config for every provider. An explicit object (not `z.record`): the four
 * providers are always present, so indexing by a provider id yields a defined
 * config (no `| undefined`) — and `z.record(enum, …)` would infer a partial.
 */
export const aiProvidersSchema = z.object({
  anthropic: aiProviderConfigSchema,
  openrouter: aiProviderConfigSchema,
  ollama: aiProviderConfigSchema,
  'openai-compat': aiProviderConfigSchema,
  mistral: aiProviderConfigSchema,
  'openai-codex': aiProviderConfigSchema,
})

/**
 * OCR provider slot (spec: "Provider OCR séparé"). The photo-OCR path can use a
 * DIFFERENT provider/model than card generation. `mode: 'same'` (the default)
 * makes the OCR path follow the active generation provider — this preserves the
 * historical behaviour for every existing settings blob. `mode: 'custom'` uses
 * the `(provider, model)` couple below; the KEY and BASE URL stay per-provider
 * (shared with generation — only the model differs).
 */
export const aiOcrSettingsSchema = z.object({
  // No `.default()` here on purpose: it would make `mode` optional on the input
  // type but required on the output type, so the DTO would not round-trip
  // cleanly through the client's request typing. The default `'same'` lives in
  // `DEFAULT_AI_SETTINGS`; a partial/absent stored blob falls back to it.
  mode: z.enum(['same', 'custom']),
  /** Provider used ONLY when `mode === 'custom'`. */
  provider: aiProviderIdSchema,
  /** Dedicated OCR model (may differ from the same provider's generation model). */
  model: z.string(),
})

export const aiSettingsSchema = z.object({
  activeProvider: aiProviderIdSchema,
  providers: aiProvidersSchema,
  ocr: aiOcrSettingsSchema,
})

/** Per-provider status — derived, NEVER contains a secret. */
export const aiProviderStatusSchema = z.object({
  provider: aiProviderIdSchema,
  requiresKey: z.boolean(),
  hasKey: z.boolean(),
  keySource: z.enum(['app', 'env']).nullable(),
  model: z.string().nullable(),
  baseUrl: z.string().optional(),
  active: z.boolean(),
  /** True for the provider effectively used by the OCR slot (spec §1.1). */
  ocrActive: z.boolean(),
  /**
   * Only meaningful for OAuth providers (openai-codex): the account is LINKED
   * (a credential row exists). Key-based providers surface link state via
   * `hasKey`; this is the explicit OAuth signal the UI uses for its badge.
   */
  linked: z.boolean().optional(),
  /**
   * True when the provider is disabled on THIS instance (openai-codex with the
   * `ENGRAM_ENABLE_CODEX` kill-switch off). The UI shows "unavailable on this
   * instance" instead of the link controls (audit C11).
   */
  unavailable: z.boolean().optional(),
  /**
   * Whether this provider + its configured model can accept an image for OCR
   * (best-effort, model-name driven — same heuristic the server guards with).
   * The Settings OCR section uses it to warn when "same as generation" points at
   * a text-only provider (fix-codex-vision §B).
   */
  visionCapable: z.boolean().optional(),
})

export const aiSettingsResponseSchema = z.object({
  settings: aiSettingsSchema,
  statuses: z.array(aiProviderStatusSchema),
})

/**
 * PATCH body — non-secret config only. Unknown keys (a secret) are stripped.
 * `providers` is a genuine partial (any subset of providers, each with a
 * partial config): `z.record(enum, …)` would force every provider key present.
 */
const partialProviderConfigSchema = aiProviderConfigSchema.partial()
export const updateAiSettingsSchema = z.object({
  activeProvider: aiProviderIdSchema.optional(),
  providers: z
    .object({
      anthropic: partialProviderConfigSchema,
      openrouter: partialProviderConfigSchema,
      ollama: partialProviderConfigSchema,
      'openai-compat': partialProviderConfigSchema,
      mistral: partialProviderConfigSchema,
      'openai-codex': partialProviderConfigSchema,
    })
    .partial()
    .optional(),
  /** OCR slot patch — a deep partial merged over the current OCR config. */
  ocr: aiOcrSettingsSchema.partial().optional(),
})

/** PUT key body — the only place a key is accepted (write-only). */
export const setAiKeySchema = z.object({ key: z.string().min(1) })

/** POST test — an optional not-yet-saved candidate (key/baseUrl/model). */
export const testConnectionRequestSchema = z.object({
  key: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
})
export const aiModelSchema = z.object({ id: z.string(), label: z.string().optional() })

/**
 * i18n-neutral outcome code for a connection test. The server NEVER returns a
 * localized message (no French text hardcoded); the client maps this code to a
 * `dict.fr`/`dict.en` string. `httpStatus` (when present) is appended by the UI.
 */
export const testConnectionDetailCodeSchema = z.enum([
  'ok',
  'invalid_key',
  'forbidden',
  'unreachable',
  'incomplete_config',
  // A key-requiring provider resolved NO key (BYOK: paste a key then Save).
  'missing_key',
  'no_credentials',
  'http_error',
  // openai-codex: the device-code beta is off on the account (init refused).
  'device_auth_disabled',
])
export const testConnectionResponseSchema = z.object({
  ok: z.boolean(),
  detailCode: testConnectionDetailCodeSchema,
  httpStatus: z.number().int().optional(),
  models: z.array(aiModelSchema).optional(),
})
export const listModelsResponseSchema = z.object({ models: z.array(aiModelSchema) })

/** `:provider` path param for the `/api/ai/providers/:provider/*` routes. */
export const providerParamSchema = z.object({ provider: aiProviderIdSchema })

// --- openai-codex device-code link flow -----------------------------------
//
// The subscription provider is linked via a device-code OAuth flow, NOT a key.
// `link/start` returns a user code + verification page + an OPAQUE handle
// (HMAC-signed, bound to the user, carrying the device_auth_id — no server
// state, Vercel-safe). The client polls `link/poll` with that handle until the
// status is terminal. NO token is EVER returned to the client (write-only).

/** `POST /providers/openai-codex/link/start` response. */
export const codexLinkStartResponseSchema = z.object({
  /** Code the user types on the verification page. */
  userCode: z.string(),
  /** Page the user opens to authorize. */
  verificationUri: z.string(),
  /** Poll window in seconds (device-code cap). */
  expiresIn: z.number().int(),
  /** Opaque, signed, user-bound handle to pass back to `link/poll`. */
  handle: z.string(),
})

/** `POST /providers/openai-codex/link/poll` request. */
export const codexLinkPollRequestSchema = z.object({ handle: z.string().min(1) })

/** Terminal + transient states of the link poll. */
export const codexLinkStatusSchema = z.enum([
  'pending', // keep polling
  'linked', // success — credential persisted
  'expired', // handle/device code expired — restart
  'denied', // user denied or upstream refused
  'device_auth_disabled', // beta toggle off on the account
])

/** `POST /providers/openai-codex/link/poll` response. */
export const codexLinkPollResponseSchema = z.object({ status: codexLinkStatusSchema })

export type AiProviderId = z.infer<typeof aiProviderIdSchema>
export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>
export type AiOcrSettings = z.infer<typeof aiOcrSettingsSchema>
export type AiSettings = z.infer<typeof aiSettingsSchema>
export type AiProviderStatus = z.infer<typeof aiProviderStatusSchema>
export type AiSettingsResponse = z.infer<typeof aiSettingsResponseSchema>
export type UpdateAiSettings = z.infer<typeof updateAiSettingsSchema>
export type SetAiKey = z.infer<typeof setAiKeySchema>
export type TestConnectionRequest = z.infer<typeof testConnectionRequestSchema>
export type AiModel = z.infer<typeof aiModelSchema>
export type TestConnectionDetailCode = z.infer<typeof testConnectionDetailCodeSchema>
export type TestConnectionResponse = z.infer<typeof testConnectionResponseSchema>
export type ListModelsResponse = z.infer<typeof listModelsResponseSchema>
export type ProviderParam = z.infer<typeof providerParamSchema>
export type CodexLinkStartResponse = z.infer<typeof codexLinkStartResponseSchema>
export type CodexLinkPollRequest = z.infer<typeof codexLinkPollRequestSchema>
export type CodexLinkStatus = z.infer<typeof codexLinkStatusSchema>
export type CodexLinkPollResponse = z.infer<typeof codexLinkPollResponseSchema>

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
  'unauthorized', // 401 — access token absent, malformed, invalid or expired (auth gate)
  'forbidden', // 403 — authenticated but not allowed (admin-only route)
  'suspended', // 403 — the account is suspended (IAM, spec §2.1 / amendment A15)
  'conflict',
  'payload_too_large', // 413 — uploaded file exceeds the size limit
  'service_unavailable', // 503 — AI generation unavailable (no ANTHROPIC_API_KEY)
  'upstream_error', // 502 — a trusted upstream (e.g. OpenAI device-code init) refused/failed
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

/**
 * Local calendar day `YYYY-MM-DD` (a window bound / bucket key, never an
 * instant). Validated CALENDARICALLY, not just by format: the round-trip
 * through a local `Date` rejects impossible dates (`2026-02-30`, `2026-13-01`)
 * that the `Date` constructor would otherwise silently normalize into a shifted
 * window. This aligns the rigor with `iso`.
 */
export const localDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number]
    const dt = new Date(y, m - 1, d) // local components (never Date.UTC)
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  }, 'invalid calendar date')

export const listSubjectsQuerySchema = z.object({ includeArchived: boolParam.optional() })
export const listDecksQuerySchema = z.object({ subjectId: z.string().optional() })
export const listCardsQuerySchema = z.object({
  deckId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
export const listNotesQuerySchema = z.object({ subjectId: z.string().optional() })
export const listGenerationsQuerySchema = z.object({ noteId: z.string().optional() })
export const previewQuerySchema = z.object({ now: iso.optional() })
export const reviewQueueQuerySchema = z.object({
  deckId: z.string().optional(),
  subjectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  now: iso.optional(),
})
export const reviewCountsQuerySchema = z.object({ now: iso.optional() })

export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>
export type ListGenerationsQuery = z.infer<typeof listGenerationsQuerySchema>
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
export const listNotesResponseSchema = z.object({ notes: z.array(noteSchema) })
export const listGenerationsResponseSchema = z.object({
  generations: z.array(generationSchema),
})

/**
 * Text fields of the `POST /api/notes/upload` multipart body (the binary file
 * itself is validated outside Zod). Parsed manually in the route.
 */
export const uploadNoteMetaSchema = z.object({
  title: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
})
export type UploadNoteMeta = z.infer<typeof uploadNoteMetaSchema>
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

/**
 * Aggregate card totals for every non-empty deck — `GET /api/decks/card-counts`.
 * One `GROUP BY deck_id` query replaces the per-deck `limit=1` fan-out (Phase 7
 * §2.2). Decks with zero cards are ABSENT from `byDeck` (the client defaults a
 * missing deck to 0), so the payload stays proportional to non-empty decks.
 */
export const deckCardCountsSchema = z.object({
  byDeck: z.array(z.object({ deckId: z.string(), cardCount: z.number().int().nonnegative() })),
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
export type ListNotesResponse = z.infer<typeof listNotesResponseSchema>
export type ListGenerationsResponse = z.infer<typeof listGenerationsResponseSchema>
export type ReviewQueueResponse = z.infer<typeof reviewQueueResponseSchema>
export type ReviewResult = z.infer<typeof reviewResultSchema>
export type DueCounts = z.infer<typeof dueCountsSchema>
export type DeckCardCounts = z.infer<typeof deckCardCountsSchema>
export type GradePreview = z.infer<typeof gradePreviewSchema>
export type ReviewPreview = z.infer<typeof reviewPreviewSchema>

// --- Planning: exams queries + study-plan ---------------------------------

/** Filter `GET /api/exams` to exams linked to a given subject. */
export const listExamsQuerySchema = z.object({ subjectId: z.string().optional() })

/**
 * `GET /api/study-plan` — projected review load over a local-day window.
 * `from`/`to` are calendar days (inclusive); `now` is the instant used to place
 * "today" and to fold overdue cards. `subjectId` scopes dues + boost.
 */
export const studyPlanQuerySchema = z.object({
  from: localDaySchema,
  to: localDaySchema,
  subjectId: z.string().optional(),
  now: iso.optional(),
})

export const studyPlanSubjectLoadSchema = z.object({
  subjectId: z.string(),
  dueCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  examBoost: z.number().int().nonnegative(),
})
export const studyPlanDayExamSchema = z.object({
  examId: z.string(),
  title: z.string(),
  subjectIds: z.array(z.string()),
})
export const studyPlanDaySchema = z.object({
  date: localDaySchema,
  isToday: z.boolean(),
  dueCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  examBoost: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  bySubject: z.array(studyPlanSubjectLoadSchema),
  exams: z.array(studyPlanDayExamSchema),
})
export const studyPlanResponseSchema = z.object({
  now: iso,
  from: localDaySchema,
  to: localDaySchema,
  days: z.array(studyPlanDaySchema),
})

/** `GET /api/study-plan/today` — prioritized "what to review today". */
export const studyTodayQuerySchema = z.object({ now: iso.optional() })
export const studyTodaySubjectSchema = z.object({
  subjectId: z.string(),
  dueCount: z.number().int().nonnegative(),
  nextExam: z
    .object({
      examId: z.string(),
      title: z.string(),
      date: iso,
      daysUntil: z.number().int(),
    })
    .nullable(),
  priority: z.number(),
})
export const studyTodayResponseSchema = z.object({
  now: iso,
  total: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  subjects: z.array(studyTodaySubjectSchema),
})

// --- Analytics (Phase 5) ---------------------------------------------------

/**
 * Shared shape of the optional local-day window (`from`/`to` together, or
 * neither). The "both-or-none" rule and the size/order guards are enforced in
 * the analytics service, not in Zod.
 */
const analyticsWindowShape = { from: localDaySchema.optional(), to: localDaySchema.optional() }
const analyticsGranularitySchema = z.enum(['day', 'week']).default('day')

// --- heatmap ---
export const heatmapQuerySchema = z.object({ ...analyticsWindowShape, now: iso.optional() })
export const heatmapDaySchema = z.object({
  date: localDaySchema,
  count: z.number().int().nonnegative(),
})
export const heatmapResponseSchema = z.object({
  from: localDaySchema,
  to: localDaySchema,
  total: z.number().int().nonnegative(),
  activeDays: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
  days: z.array(heatmapDaySchema), // dense: one item per day of [from, to]
})

// --- streaks ---
export const streaksQuerySchema = z.object({ now: iso.optional() })
export const streaksResponseSchema = z.object({
  now: iso,
  current: z.number().int().nonnegative(),
  longest: z.number().int().nonnegative(),
  includesToday: z.boolean(),
  lastStudyDay: localDaySchema.nullable(),
  totalStudyDays: z.number().int().nonnegative(),
})

// --- study-time ---
export const studyTimeQuerySchema = z.object({
  ...analyticsWindowShape,
  granularity: analyticsGranularitySchema,
  now: iso.optional(),
})
export const studyTimeBucketSchema = z.object({
  date: localDaySchema, // a day, or the Monday of the week
  daysInBucket: z.number().int().min(1).max(7), // 1 in day; 1..7 in week (partial edge)
  durationMs: z.number().int().nonnegative(), // Σ of non-null durations
  reviewCount: z.number().int().nonnegative(),
  measuredCount: z.number().int().nonnegative(),
  avgMs: z.number().int().nonnegative().nullable(), // Math.round; null if measuredCount === 0
})
export const studyTimeResponseSchema = z.object({
  from: localDaySchema,
  to: localDaySchema,
  granularity: z.enum(['day', 'week']),
  totalMs: z.number().int().nonnegative(),
  totalReviews: z.number().int().nonnegative(),
  measuredReviews: z.number().int().nonnegative(),
  buckets: z.array(studyTimeBucketSchema),
})

// --- review-volume ---
export const reviewVolumeQuerySchema = z.object({
  ...analyticsWindowShape,
  granularity: analyticsGranularitySchema,
  now: iso.optional(),
})
const ratingCounts = {
  again: z.number().int().nonnegative(),
  hard: z.number().int().nonnegative(),
  good: z.number().int().nonnegative(),
  easy: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}
export const reviewVolumeBucketSchema = z.object({
  date: localDaySchema,
  daysInBucket: z.number().int().min(1).max(7),
  ...ratingCounts,
})
export const reviewVolumeResponseSchema = z.object({
  from: localDaySchema,
  to: localDaySchema,
  granularity: z.enum(['day', 'week']),
  totals: z.object(ratingCounts),
  buckets: z.array(reviewVolumeBucketSchema),
})

// --- retention (per subject) ---
export const retentionQuerySchema = z.object({ ...analyticsWindowShape })
export const retentionSubjectSchema = z.object({
  subjectId: z.string(),
  // Denominator name is DISTINCT from deckSuccess.reviewed (all states): here
  // only reviews in state=Review count (mature cards).
  maturedReviewed: z.number().int().nonnegative(),
  recalled: z.number().int().nonnegative(), // rating >= 2 among those
  retention: z.number().min(0).max(1).nullable(), // null if maturedReviewed < minSample
})
export const retentionResponseSchema = z.object({
  from: localDaySchema.nullable(),
  to: localDaySchema.nullable(),
  minSample: z.number().int().positive(),
  subjects: z.array(retentionSubjectSchema),
})

// --- deck-success (per deck) ---
export const deckSuccessQuerySchema = z.object({ ...analyticsWindowShape })
export const deckSuccessSchema = z.object({
  deckId: z.string(),
  subjectId: z.string(),
  reviewed: z.number().int().nonnegative(), // all states
  passed: z.number().int().nonnegative(), // rating >= 2
  successRate: z.number().min(0).max(1).nullable(),
})
export const deckSuccessResponseSchema = z.object({
  from: localDaySchema.nullable(),
  to: localDaySchema.nullable(),
  minSample: z.number().int().positive(),
  decks: z.array(deckSuccessSchema),
})

export type HeatmapQuery = z.infer<typeof heatmapQuerySchema>
export type HeatmapDay = z.infer<typeof heatmapDaySchema>
export type HeatmapResponse = z.infer<typeof heatmapResponseSchema>
export type StreaksQuery = z.infer<typeof streaksQuerySchema>
export type StreaksResponse = z.infer<typeof streaksResponseSchema>
export type StudyTimeQuery = z.infer<typeof studyTimeQuerySchema>
export type StudyTimeBucket = z.infer<typeof studyTimeBucketSchema>
export type StudyTimeResponse = z.infer<typeof studyTimeResponseSchema>
export type ReviewVolumeQuery = z.infer<typeof reviewVolumeQuerySchema>
export type ReviewVolumeBucket = z.infer<typeof reviewVolumeBucketSchema>
export type ReviewVolumeResponse = z.infer<typeof reviewVolumeResponseSchema>
export type RetentionQuery = z.infer<typeof retentionQuerySchema>
export type RetentionSubject = z.infer<typeof retentionSubjectSchema>
export type RetentionResponse = z.infer<typeof retentionResponseSchema>
export type DeckSuccessQuery = z.infer<typeof deckSuccessQuerySchema>
export type DeckSuccess = z.infer<typeof deckSuccessSchema>
export type DeckSuccessResponse = z.infer<typeof deckSuccessResponseSchema>

export type ListExamsQuery = z.infer<typeof listExamsQuerySchema>
export type StudyPlanQuery = z.infer<typeof studyPlanQuerySchema>
export type StudyPlanSubjectLoad = z.infer<typeof studyPlanSubjectLoadSchema>
export type StudyPlanDayExam = z.infer<typeof studyPlanDayExamSchema>
export type StudyPlanDay = z.infer<typeof studyPlanDaySchema>
export type StudyPlanResponse = z.infer<typeof studyPlanResponseSchema>
export type StudyTodayQuery = z.infer<typeof studyTodayQuerySchema>
export type StudyTodaySubject = z.infer<typeof studyTodaySubjectSchema>
export type StudyTodayResponse = z.infer<typeof studyTodayResponseSchema>
