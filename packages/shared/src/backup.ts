import { z } from 'zod'
import { generationItemSchema } from './domain'

/**
 * Backup / export contract — the single source of truth for the versioned
 * whole-database dump (`GET /api/backup/export`) and its restore
 * (`POST /api/backup/import`).
 *
 * Unlike the API DTOs in `domain.ts`, these schemas describe the **raw table
 * rows** so a round-trip is lossless: every timestamp is an ISO-8601 string
 * (Postgres `timestamptz` → `Date` → `.toISOString()`, restored with
 * `new Date()`), nullables stay nullable, and `generation.items` keeps its
 * typed JSON buffer. Ids and timestamps are preserved verbatim on restore so
 * FSRS history and creation dates survive the wipe-and-reinsert.
 */

/** ISO-8601 datetime string with ms (e.g. `new Date().toISOString()`). */
const iso = z.string().datetime()

export const backupSubjectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  position: z.number().int(),
  archived: z.boolean(),
  createdAt: iso,
  updatedAt: iso,
})

export const backupDeckRowSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  position: z.number().int(),
  createdAt: iso,
  updatedAt: iso,
})

export const backupCardRowSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  front: z.string(),
  back: z.string(),
  due: iso,
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number().int(),
  scheduledDays: z.number().int(),
  learningSteps: z.number().int(),
  reps: z.number().int(),
  lapses: z.number().int(),
  state: z.number().int(),
  lastReview: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
})

export const backupReviewLogRowSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  rating: z.number().int(),
  state: z.number().int(),
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

export const backupNoteRowSchema = z.object({
  id: z.string(),
  subjectId: z.string().nullable(),
  title: z.string(),
  sourceType: z.string(),
  originalFilename: z.string().nullable(),
  content: z.string(),
  createdAt: iso,
  updatedAt: iso,
})

export const backupGenerationRowSchema = z.object({
  id: z.string(),
  noteId: z.string(),
  deckId: z.string().nullable(),
  kind: z.string(),
  status: z.string(),
  model: z.string(),
  items: z.array(generationItemSchema),
  promptTokens: z.number().int().nullable(),
  completionTokens: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
})

export const backupExamRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: iso,
  notes: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
})

export const backupExamSubjectRowSchema = z.object({
  examId: z.string(),
  subjectId: z.string(),
})

/**
 * Table payloads in FK-safe insertion order:
 * `subject → deck → card → reviewLog → note → generation → exam → examSubject`.
 */
export const backupTablesSchema = z.object({
  subject: z.array(backupSubjectRowSchema),
  deck: z.array(backupDeckRowSchema),
  card: z.array(backupCardRowSchema),
  reviewLog: z.array(backupReviewLogRowSchema),
  note: z.array(backupNoteRowSchema),
  generation: z.array(backupGenerationRowSchema),
  exam: z.array(backupExamRowSchema),
  examSubject: z.array(backupExamSubjectRowSchema),
})

/** Current backup format version. Bump (breaking) when the shape changes. */
export const BACKUP_VERSION = 1

/** The versioned whole-database dump envelope. */
export const backupSchema = z.object({
  /** Format version. A mismatch (≠ 1) fails validation → 400. */
  engramBackup: z.literal(BACKUP_VERSION),
  /** ISO timestamp of the export (informational). */
  exportedAt: iso,
  /** App version from package.json (informational). */
  appVersion: z.string(),
  /** Last drizzle migration tag; a mismatch on import → 409. */
  schema: z.string(),
  tables: backupTablesSchema,
})

/** Per-table inserted-row counts returned by a successful import. */
export const backupImportResultSchema = z.object({
  inserted: z.object({
    subject: z.number().int(),
    deck: z.number().int(),
    card: z.number().int(),
    reviewLog: z.number().int(),
    note: z.number().int(),
    generation: z.number().int(),
    exam: z.number().int(),
    examSubject: z.number().int(),
  }),
})

export type BackupSubjectRow = z.infer<typeof backupSubjectRowSchema>
export type BackupDeckRow = z.infer<typeof backupDeckRowSchema>
export type BackupCardRow = z.infer<typeof backupCardRowSchema>
export type BackupReviewLogRow = z.infer<typeof backupReviewLogRowSchema>
export type BackupNoteRow = z.infer<typeof backupNoteRowSchema>
export type BackupGenerationRow = z.infer<typeof backupGenerationRowSchema>
export type BackupExamRow = z.infer<typeof backupExamRowSchema>
export type BackupExamSubjectRow = z.infer<typeof backupExamSubjectRowSchema>
export type BackupTables = z.infer<typeof backupTablesSchema>
export type Backup = z.infer<typeof backupSchema>
export type BackupImportResult = z.infer<typeof backupImportResultSchema>
