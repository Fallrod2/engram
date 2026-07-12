import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import type {
  Generation,
  GenerationItem,
  GenerationKind,
  ListGenerationsResponse,
  ResolveGeneration,
  StartGeneration,
} from '@engram/shared'
import type { DB } from '../db/client'
import { generation } from '../db/schema'
import { generationToDto } from '../db/dto'
import { NotFoundError, ConflictError, ValidationError } from '../http/errors'
import { requireNoteRow } from './notes.service'
import { requireDeckRow } from './decks.service'
import { requireSubjectRow } from './subjects.service'
import { insertFreshCardRow } from './cards.service'
import { GENERATION_MODEL } from '../ai/prompts/cards.v1'
import { chunkNote } from '../ai/chunk'
import { getCardGenerator, type CardGenerator } from '../ai/generator'

/** Global cap on the number of cards a single generation may propose. */
const MAX_TOTAL_ITEMS = 100

/** Fetch a raw generation row or throw 404. */
export function requireGenerationRow(db: DB, id: string) {
  const row = db.select().from(generation).where(eq(generation.id, id)).get()
  if (!row) throw new NotFoundError(`generation ${id} not found`)
  return row
}

export function listGenerations(db: DB, noteId?: string): ListGenerationsResponse {
  const rows = db
    .select()
    .from(generation)
    .where(noteId ? eq(generation.noteId, noteId) : undefined)
    .orderBy(desc(generation.createdAt))
    .all()
  return { generations: rows.map(generationToDto) }
}

export function getGeneration(db: DB, id: string): Generation {
  return generationToDto(requireGenerationRow(db, id))
}

export function deleteGeneration(db: DB, id: string): void {
  const res = db
    .delete(generation)
    .where(eq(generation.id, id))
    .returning({ id: generation.id })
    .all()
  if (res.length === 0) throw new NotFoundError(`generation ${id} not found`)
}

/**
 * Create the `pending` row and launch the fire-and-forget job. Returns the
 * pending DTO. `generator` defaults to the active registry entry (real in prod,
 * fake in tests) so the fire-and-forget path never hits the real API in tests.
 */
export function startGeneration(
  db: DB,
  input: StartGeneration,
  generator: CardGenerator = getCardGenerator(),
): Generation {
  requireNoteRow(db, input.noteId)
  if (input.deckId !== undefined) {
    const deckRow = requireDeckRow(db, input.deckId)
    if (requireSubjectRow(db, deckRow.subjectId).archived) {
      throw new ConflictError('cannot generate into a deck under an archived subject')
    }
  }
  const row = db
    .insert(generation)
    .values({
      noteId: input.noteId,
      kind: input.kind,
      model: GENERATION_MODEL,
      status: 'pending',
      ...(input.deckId !== undefined ? { deckId: input.deckId } : {}),
      // items defaults to [] via the schema $defaultFn
    })
    .returning()
    .get()

  // Fire-and-forget: the server process stays alive, the promise runs on.
  void runGenerationJob(db, row.id, generator).catch(() => {
    /* runGenerationJob already captures everything; this is a belt. */
  })
  return generationToDto(row)
}

/**
 * The job: load the note, chunk it, generate sequentially, aggregate pending
 * items, persist succeeded/failed. NEVER throws (captures everything). Exported
 * and awaitable so tests can run it deterministically with a fake generator.
 */
export async function runGenerationJob(
  db: DB,
  genId: string,
  generator: CardGenerator = getCardGenerator(),
): Promise<void> {
  const gen = db.select().from(generation).where(eq(generation.id, genId)).get()
  if (!gen || gen.status !== 'pending') return // idempotence: only ever replays pending

  try {
    const note = requireNoteRow(db, gen.noteId)
    const chunks = chunkNote(note.content)
    const items: GenerationItem[] = []
    let promptTokens = 0
    let completionTokens = 0

    for (const chunk of chunks) {
      if (items.length >= MAX_TOTAL_ITEMS) break
      // No signal fabricated here: the generator owns its per-call timeout.
      const r = await generator.generate({ content: chunk, kind: gen.kind as GenerationKind })
      promptTokens += r.promptTokens
      completionTokens += r.completionTokens
      for (const c of r.cards) {
        if (items.length >= MAX_TOTAL_ITEMS) break
        items.push({ id: randomUUID(), front: c.front, back: c.back, status: 'pending' })
      }
    }

    db.update(generation)
      .set({ status: 'succeeded', items, promptTokens, completionTokens })
      .where(eq(generation.id, genId))
      .run()
  } catch (e) {
    const message = e instanceof Error ? e.message : 'generation failed'
    db.update(generation)
      .set({ status: 'failed', error: message.slice(0, 1000) })
      .where(eq(generation.id, genId))
      .run()
  }
}

/**
 * Apply per-card review decisions and insert accepted cards, idempotently, in a
 * single transaction. Items already carrying a `cardId` are FROZEN — no incoming
 * decision can re-insert, re-status, or delete them (that would destroy FSRS
 * history).
 */
export function resolveGeneration(db: DB, id: string, input: ResolveGeneration): Generation {
  const row = requireGenerationRow(db, id)
  if (row.status !== 'succeeded') {
    throw new ConflictError('generation not ready to resolve')
  }

  const stored = new Map(row.items.map((i) => [i.id, i]))
  // Mutable copy of the stored items; stored items absent from the input keep
  // their state (merge — robust to partial resubmits).
  const next: GenerationItem[] = row.items.map((i) => ({ ...i }))
  const nextById = new Map(next.map((i) => [i.id, i]))

  // Validate every decision references a known item.
  for (const item of input.items) {
    if (!stored.has(item.id)) throw new ValidationError('unknown item id')
  }

  // Is there at least one item to actually insert (accepted/edited AND not yet
  // inserted)? Validate the target deck ONCE, before the loop.
  const needsDeck = input.items.some((item) => {
    const s = stored.get(item.id)
    return (
      s !== undefined &&
      s.cardId === undefined &&
      (item.status === 'accepted' || item.status === 'edited')
    )
  })
  const deckId = row.deckId
  if (needsDeck) {
    if (deckId === null) throw new ConflictError('generation has no target deck')
    const deckRow = requireDeckRow(db, deckId)
    if (requireSubjectRow(db, deckRow.subjectId).archived) {
      throw new ConflictError('cannot insert cards into a deck under an archived subject')
    }
  }

  const updated = db.transaction((tx) => {
    for (const item of input.items) {
      const s = stored.get(item.id)
      const target = nextById.get(item.id)
      if (s === undefined || target === undefined) continue

      // Frozen: an already-inserted item ignores every incoming decision.
      if (s.cardId !== undefined) continue

      if (item.status === 'rejected') {
        target.status = 'rejected'
        continue
      }
      if (item.status === 'accepted' || item.status === 'edited') {
        // deckId is guaranteed non-null here (needsDeck validated above).
        const cardId = insertFreshCardRow(tx, {
          deckId: deckId as string,
          front: item.front,
          back: item.back,
        })
        target.status = item.status
        target.front = item.front
        target.back = item.back
        target.cardId = cardId
        continue
      }
      // 'pending' in the input: leave pending, no insertion.
    }

    return tx.update(generation).set({ items: next }).where(eq(generation.id, id)).returning().get()
  })

  return generationToDto(updated)
}
