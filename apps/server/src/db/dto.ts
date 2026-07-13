import type { InferSelectModel } from 'drizzle-orm'
import type { Subject, Deck, Card, ReviewLog, Note, Generation, Exam } from '@engram/shared'
import type { subject, deck, card, reviewLog, note, generation, exam } from './schema'

/**
 * Row → API DTO serializers: the single conversion point where DB `Date`/int-ms
 * values become ISO-8601 strings. These outputs are validated against the
 * shared Zod schemas (anti-drift test); Drizzle types stay server-internal.
 */

const iso = (d: Date): string => d.toISOString()
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null)

export function subjectToDto(row: InferSelectModel<typeof subject>): Subject {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    position: row.position,
    archived: row.archived,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function deckToDto(row: InferSelectModel<typeof deck>): Deck {
  return {
    id: row.id,
    subjectId: row.subjectId,
    name: row.name,
    description: row.description,
    position: row.position,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function cardToDto(row: InferSelectModel<typeof card>): Card {
  return {
    id: row.id,
    deckId: row.deckId,
    front: row.front,
    back: row.back,
    fsrs: {
      due: iso(row.due),
      stability: row.stability,
      difficulty: row.difficulty,
      elapsedDays: row.elapsedDays,
      scheduledDays: row.scheduledDays,
      learningSteps: row.learningSteps,
      reps: row.reps,
      lapses: row.lapses,
      state: row.state as Card['fsrs']['state'],
      lastReview: isoOrNull(row.lastReview),
    },
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function reviewLogToDto(row: InferSelectModel<typeof reviewLog>): ReviewLog {
  return {
    id: row.id,
    cardId: row.cardId,
    rating: row.rating as ReviewLog['rating'],
    state: row.state as ReviewLog['state'],
    due: iso(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    lastElapsedDays: row.lastElapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    review: iso(row.review),
    durationMs: row.durationMs,
    createdAt: iso(row.createdAt),
  }
}

export function noteToDto(row: InferSelectModel<typeof note>): Note {
  return {
    id: row.id,
    subjectId: row.subjectId,
    title: row.title,
    sourceType: row.sourceType as Note['sourceType'],
    originalFilename: row.originalFilename,
    content: row.content,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export function generationToDto(row: InferSelectModel<typeof generation>): Generation {
  return {
    id: row.id,
    noteId: row.noteId,
    deckId: row.deckId,
    kind: row.kind as Generation['kind'],
    status: row.status as Generation['status'],
    model: row.model,
    provider: row.provider,
    items: row.items,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    error: row.error,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

/** `exam` row + aggregated `exam_subject` ids → exam DTO. */
export function examToDto(row: InferSelectModel<typeof exam>, subjectIds: string[]): Exam {
  return {
    id: row.id,
    title: row.title,
    date: iso(row.date),
    notes: row.notes,
    subjectIds,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}
