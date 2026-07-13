import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { eq, inArray } from 'drizzle-orm'
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
export async function exportBackup(db: DB, userId: string): Promise<Backup> {
  const [subjects, decks, cards, reviewLogs, notes, generations, exams, examSubjects] =
    await Promise.all([
      db.select().from(subject).where(eq(subject.userId, userId)),
      db.select().from(deck).where(eq(deck.userId, userId)),
      db.select().from(card).where(eq(card.userId, userId)),
      db.select().from(reviewLog).where(eq(reviewLog.userId, userId)),
      db.select().from(note).where(eq(note.userId, userId)),
      db.select().from(generation).where(eq(generation.userId, userId)),
      db.select().from(exam).where(eq(exam.userId, userId)),
      // exam_subject has no user_id — scope it via a join on the owning exam.
      db
        .select({ examId: examSubject.examId, subjectId: examSubject.subjectId })
        .from(examSubject)
        .innerJoin(exam, eq(exam.id, examSubject.examId))
        .where(eq(exam.userId, userId)),
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
 * Assert every FK inside the file resolves to another row IN THE SAME FILE
 * (spec §3 / critique amendment 7). Without this, a forged backup could attach
 * one user's row to another user's parent: the physical DB FK would still pass
 * (the parent row exists), silently corrupting the tenant boundary and letting a
 * later cascade delete destroy the other user's data. We reject such a file with
 * a 400 BEFORE wiping anything.
 */
function assertForeignKeyClosure(t: Backup['tables']): void {
  const subjectIds = new Set(t.subject.map((r) => r.id))
  const deckIds = new Set(t.deck.map((r) => r.id))
  const cardIds = new Set(t.card.map((r) => r.id))
  const noteIds = new Set(t.note.map((r) => r.id))
  const examIds = new Set(t.exam.map((r) => r.id))
  const bad = (msg: string): never => {
    throw new ValidationError(`backup import failed: ${msg}`)
  }
  for (const r of t.deck)
    if (!subjectIds.has(r.subjectId)) bad('deck references an unknown subject')
  for (const r of t.card) if (!deckIds.has(r.deckId)) bad('card references an unknown deck')
  for (const r of t.reviewLog)
    if (!cardIds.has(r.cardId)) bad('review_log references an unknown card')
  for (const r of t.note)
    if (r.subjectId !== null && !subjectIds.has(r.subjectId))
      bad('note references an unknown subject')
  for (const r of t.generation) {
    if (!noteIds.has(r.noteId)) bad('generation references an unknown note')
    if (r.deckId !== null && !deckIds.has(r.deckId)) bad('generation references an unknown deck')
  }
  for (const r of t.examSubject) {
    if (!examIds.has(r.examId)) bad('exam_subject references an unknown exam')
    if (!subjectIds.has(r.subjectId)) bad('exam_subject references an unknown subject')
  }
}

/**
 * Restore a full dump for `userId`, replacing that user's data ONLY. Steps run
 * in one transaction: validate → guard version/schema → verify FK closure →
 * wipe (child→parent, scoped) → reinsert (parent→child) with original ids and
 * timestamps but the `userId` FORCED server-side (never read from the file — the
 * backup schemas carry no user_id). Any failure rolls back, so a bad backup
 * never leaves the database half-restored.
 */
export async function importBackup(
  db: DB,
  userId: string,
  raw: unknown,
): Promise<BackupImportResult> {
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
  assertForeignKeyClosure(t)
  // Subquery of THIS user's exam ids — used to scope the junction wipe (it has
  // no user_id of its own).
  const myExamIds = db.select({ id: exam.id }).from(exam).where(eq(exam.userId, userId))
  try {
    return await db.transaction(async (tx) => {
      // Wipe child → parent, SCOPED to this user (foreign keys are enforced).
      await tx.delete(examSubject).where(inArray(examSubject.examId, myExamIds))
      await tx.delete(exam).where(eq(exam.userId, userId))
      await tx.delete(reviewLog).where(eq(reviewLog.userId, userId))
      await tx.delete(card).where(eq(card.userId, userId))
      await tx.delete(generation).where(eq(generation.userId, userId))
      await tx.delete(note).where(eq(note.userId, userId))
      await tx.delete(deck).where(eq(deck.userId, userId))
      await tx.delete(subject).where(eq(subject.userId, userId))

      // Reinsert parent → child, preserving ids and timestamps verbatim.
      if (t.subject.length) {
        await tx.insert(subject).values(
          t.subject.map((r) => ({
            id: r.id,
            userId,
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
            userId,
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
            userId,
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
            userId,
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
            userId,
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
            userId,
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
            userId,
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
