import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { backupSchema, BACKUP_VERSION, type Backup, type BackupImportResult } from '@engram/shared'
import type { DB } from '../db/client'
import { card, deck, exam, examSubject, generation, note, reviewLog, subject } from '../db/schema'
import { ApiError, ConflictError, ValidationError } from '../http/errors'

/** ISO string for a `Date` column value. */
const iso = (d: Date): string => d.toISOString()
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null)

/**
 * The tag of the latest drizzle migration, read at runtime from the migration
 * journal (`drizzle/meta/_journal.json` → last `entries[].tag`). This is the
 * source of truth for the backup `schema` field written on export and for the
 * 409 guard on import. It is the readable tag, NOT the content hash stored in
 * `drizzle.__drizzle_migrations`.
 */
export function currentSchemaTag(): string {
  const journalPath = fileURLToPath(new URL('../../drizzle/meta/_journal.json', import.meta.url))
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[]
  }
  const last = journal.entries.at(-1)
  if (!last) throw new Error('drizzle journal has no migration entries')
  return last.tag
}

/** App version, read from the server package.json (informational field). */
function appVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url))
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Read every table and assemble the versioned, lossless dump. Raw rows are
 * serialized with ISO timestamps; `generation.items` (jsonb) passes through
 * verbatim. The caller validates the result against `backupSchema`.
 */
export async function exportBackup(db: DB): Promise<Backup> {
  const [subjects, decks, cards, reviewLogs, notes, generations, exams, examSubjects] =
    await Promise.all([
      db.select().from(subject),
      db.select().from(deck),
      db.select().from(card),
      db.select().from(reviewLog),
      db.select().from(note),
      db.select().from(generation),
      db.select().from(exam),
      db.select().from(examSubject),
    ])

  return {
    engramBackup: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: appVersion(),
    schema: currentSchemaTag(),
    tables: {
      subject: subjects.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        icon: r.icon,
        position: r.position,
        archived: r.archived,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
      })),
      deck: decks.map((r) => ({
        id: r.id,
        subjectId: r.subjectId,
        name: r.name,
        description: r.description,
        position: r.position,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
      })),
      card: cards.map((r) => ({
        id: r.id,
        deckId: r.deckId,
        front: r.front,
        back: r.back,
        due: iso(r.due),
        stability: r.stability,
        difficulty: r.difficulty,
        elapsedDays: r.elapsedDays,
        scheduledDays: r.scheduledDays,
        learningSteps: r.learningSteps,
        reps: r.reps,
        lapses: r.lapses,
        state: r.state,
        lastReview: isoOrNull(r.lastReview),
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
      })),
      reviewLog: reviewLogs.map((r) => ({
        id: r.id,
        cardId: r.cardId,
        rating: r.rating,
        state: r.state,
        due: iso(r.due),
        stability: r.stability,
        difficulty: r.difficulty,
        elapsedDays: r.elapsedDays,
        lastElapsedDays: r.lastElapsedDays,
        scheduledDays: r.scheduledDays,
        learningSteps: r.learningSteps,
        review: iso(r.review),
        durationMs: r.durationMs,
        createdAt: iso(r.createdAt),
      })),
      note: notes.map((r) => ({
        id: r.id,
        subjectId: r.subjectId,
        title: r.title,
        sourceType: r.sourceType,
        originalFilename: r.originalFilename,
        content: r.content,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
      })),
      generation: generations.map((r) => ({
        id: r.id,
        noteId: r.noteId,
        deckId: r.deckId,
        kind: r.kind,
        status: r.status,
        model: r.model,
        items: r.items,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        error: r.error,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
      })),
      exam: exams.map((r) => ({
        id: r.id,
        title: r.title,
        date: iso(r.date),
        notes: r.notes,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
      })),
      examSubject: examSubjects.map((r) => ({
        examId: r.examId,
        subjectId: r.subjectId,
      })),
    },
  }
}

/**
 * Restore a full dump, replacing ALL current data. Steps run in one
 * transaction: validate → guard version/schema → wipe (child→parent) →
 * reinsert (parent→child) with original ids and timestamps. Any failure rolls
 * back, so a bad backup never leaves the database half-restored.
 */
export async function importBackup(db: DB, raw: unknown): Promise<BackupImportResult> {
  const parsed = backupSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError('invalid backup file', parsed.error.flatten())
  }
  const dump = parsed.data

  const tag = currentSchemaTag()
  if (dump.schema !== tag) {
    throw new ConflictError(
      `backup was taken on schema "${dump.schema}" but the database is on "${tag}"; migrate to a matching version first`,
    )
  }

  const t = dump.tables
  try {
    return await db.transaction(async (tx) => {
      // Wipe child → parent (foreign keys are enforced).
      await tx.delete(examSubject)
      await tx.delete(exam)
      await tx.delete(reviewLog)
      await tx.delete(card)
      await tx.delete(generation)
      await tx.delete(note)
      await tx.delete(deck)
      await tx.delete(subject)

      // Reinsert parent → child, preserving ids and timestamps verbatim.
      if (t.subject.length) {
        await tx.insert(subject).values(
          t.subject.map((r) => ({
            id: r.id,
            name: r.name,
            color: r.color,
            icon: r.icon,
            position: r.position,
            archived: r.archived,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        )
      }
      if (t.deck.length) {
        await tx.insert(deck).values(
          t.deck.map((r) => ({
            id: r.id,
            subjectId: r.subjectId,
            name: r.name,
            description: r.description,
            position: r.position,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        )
      }
      if (t.card.length) {
        await tx.insert(card).values(
          t.card.map((r) => ({
            id: r.id,
            deckId: r.deckId,
            front: r.front,
            back: r.back,
            due: new Date(r.due),
            stability: r.stability,
            difficulty: r.difficulty,
            elapsedDays: r.elapsedDays,
            scheduledDays: r.scheduledDays,
            learningSteps: r.learningSteps,
            reps: r.reps,
            lapses: r.lapses,
            state: r.state,
            lastReview: r.lastReview ? new Date(r.lastReview) : null,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        )
      }
      if (t.reviewLog.length) {
        await tx.insert(reviewLog).values(
          t.reviewLog.map((r) => ({
            id: r.id,
            cardId: r.cardId,
            rating: r.rating,
            state: r.state,
            due: new Date(r.due),
            stability: r.stability,
            difficulty: r.difficulty,
            elapsedDays: r.elapsedDays,
            lastElapsedDays: r.lastElapsedDays,
            scheduledDays: r.scheduledDays,
            learningSteps: r.learningSteps,
            review: new Date(r.review),
            durationMs: r.durationMs,
            createdAt: new Date(r.createdAt),
          })),
        )
      }
      if (t.note.length) {
        await tx.insert(note).values(
          t.note.map((r) => ({
            id: r.id,
            subjectId: r.subjectId,
            title: r.title,
            sourceType: r.sourceType,
            originalFilename: r.originalFilename,
            content: r.content,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        )
      }
      if (t.generation.length) {
        await tx.insert(generation).values(
          t.generation.map((r) => ({
            id: r.id,
            noteId: r.noteId,
            deckId: r.deckId,
            kind: r.kind,
            status: r.status,
            model: r.model,
            items: r.items,
            promptTokens: r.promptTokens,
            completionTokens: r.completionTokens,
            error: r.error,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        )
      }
      if (t.exam.length) {
        await tx.insert(exam).values(
          t.exam.map((r) => ({
            id: r.id,
            title: r.title,
            date: new Date(r.date),
            notes: r.notes,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        )
      }
      if (t.examSubject.length) {
        await tx
          .insert(examSubject)
          .values(t.examSubject.map((r) => ({ examId: r.examId, subjectId: r.subjectId })))
      }

      return {
        inserted: {
          subject: t.subject.length,
          deck: t.deck.length,
          card: t.card.length,
          reviewLog: t.reviewLog.length,
          note: t.note.length,
          generation: t.generation.length,
          exam: t.exam.length,
          examSubject: t.examSubject.length,
        },
      }
    })
  } catch (err) {
    if (err instanceof ApiError) throw err
    // A DB-level failure during restore (forged FK, check violation, duplicate
    // id) = invalid backup content. The transaction already rolled back, so the
    // database is unchanged; surface it as a 400 rather than an opaque 500.
    throw new ValidationError('backup import failed: data violates database constraints')
  }
}
