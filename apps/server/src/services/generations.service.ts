import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { waitUntil } from '@vercel/functions'
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
import { chunkNote } from '../ai/chunk'
import { getCardGenerator, type CardGenerator } from '../ai/generator'
import { expandCloze } from '../ai/cloze'
import type { ResolvedProviderConfig } from '../ai/providers/types'

/** Global cap on the number of cards a single generation may propose. */
const MAX_TOTAL_ITEMS = 100

/** Fetch a raw generation row (scoped to `userId`) or throw 404. */
export async function requireGenerationRow(db: DB, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(generation)
    .where(and(eq(generation.id, id), eq(generation.userId, userId)))
  if (!row) throw new NotFoundError(`generation ${id} not found`)
  return row
}

export async function listGenerations(
  db: DB,
  userId: string,
  noteId?: string,
): Promise<ListGenerationsResponse> {
  const rows = await db
    .select()
    .from(generation)
    .where(
      noteId
        ? and(eq(generation.userId, userId), eq(generation.noteId, noteId))
        : eq(generation.userId, userId),
    )
    .orderBy(desc(generation.createdAt))
  return { generations: rows.map(generationToDto) }
}

export async function getGeneration(db: DB, userId: string, id: string): Promise<Generation> {
  return generationToDto(await requireGenerationRow(db, userId, id))
}

export async function deleteGeneration(db: DB, userId: string, id: string): Promise<void> {
  const res = await db
    .delete(generation)
    .where(and(eq(generation.id, id), eq(generation.userId, userId)))
    .returning({ id: generation.id })
  if (res.length === 0) throw new NotFoundError(`generation ${id} not found`)
}

/**
 * Create the `pending` row and launch the fire-and-forget job. Returns the
 * pending DTO. The provider `cfg` is resolved ONCE by the router (which already
 * guarded the 503 with it) and passed in — the row is stamped with the actual
 * provider/model used, and the same `cfg` flows to the job (no second DB read,
 * no TOCTOU). `generator` defaults to the active registry entry (real in prod,
 * fake in tests) so the fire-and-forget path never hits the real API in tests.
 */
export async function startGeneration(
  db: DB,
  userId: string,
  input: StartGeneration,
  cfg: ResolvedProviderConfig,
  generator: CardGenerator = getCardGenerator(),
): Promise<Generation> {
  await requireNoteRow(db, userId, input.noteId)
  if (input.deckId !== undefined) {
    const deckRow = await requireDeckRow(db, userId, input.deckId)
    if ((await requireSubjectRow(db, userId, deckRow.subjectId)).archived) {
      throw new ConflictError('cannot generate into a deck under an archived subject')
    }
  }
  const [row] = await db
    .insert(generation)
    .values({
      userId,
      noteId: input.noteId,
      kind: input.kind,
      model: cfg.model,
      provider: cfg.providerId,
      status: 'pending',
      ...(input.deckId !== undefined ? { deckId: input.deckId } : {}),
      // items defaults to [] via the schema $defaultFn
    })
    .returning()

  // Fire-and-forget. Locally the long-lived Bun process keeps running until the
  // promise settles. On Vercel the serverless function is frozen the instant the
  // response is returned, so any work started after that never runs — register the
  // promise with `waitUntil` to keep the invocation alive until the job completes.
  // The env guard means the local/test behaviour is byte-for-byte unchanged:
  // `waitUntil` is only ever invoked inside a real Vercel request context. The
  // captured `userId` flows to the job (no Hono context inside the job — spec §2).
  const job = runGenerationJob(db, userId, row!.id, generator, cfg).catch(() => {
    /* runGenerationJob already captures everything; this is a belt. */
  })
  if (process.env.VERCEL === '1') waitUntil(job)
  return generationToDto(row!)
}

/**
 * The job: load the note, chunk it, generate sequentially, aggregate pending
 * items, persist succeeded/failed. NEVER throws (captures everything). Exported
 * and awaitable so tests can run it deterministically with a fake generator.
 */
export async function runGenerationJob(
  db: DB,
  userId: string,
  genId: string,
  generator: CardGenerator = getCardGenerator(),
  cfg?: ResolvedProviderConfig,
): Promise<void> {
  const [gen] = await db
    .select()
    .from(generation)
    .where(and(eq(generation.id, genId), eq(generation.userId, userId)))
  if (!gen || gen.status !== 'pending') return // idempotence: only ever replays pending

  try {
    const note = await requireNoteRow(db, userId, gen.noteId)
    const chunks = chunkNote(note.content)
    const items: GenerationItem[] = []
    let promptTokens = 0
    let completionTokens = 0

    for (const chunk of chunks) {
      if (items.length >= MAX_TOTAL_ITEMS) break
      // No signal fabricated here: the generator owns its per-call timeout. The
      // resolved provider is passed through so the model used matches the stamp.
      const r = await generator.generate({
        content: chunk,
        kind: gen.kind as GenerationKind,
        ...(cfg ? { provider: cfg } : {}),
      })
      promptTokens += r.promptTokens
      completionTokens += r.completionTokens
      const isMixed = gen.kind === 'mixed'
      for (const c of r.cards) {
        if (items.length >= MAX_TOTAL_ITEMS) break
        if (c.kind === 'cloze') {
          // Materialise the cloze template into one front/back card per distinct
          // mask (the "façon quiz" light path — nothing downstream learns cloze
          // exists). Malformed templates degrade gracefully: log + drop the item.
          const expansion = expandCloze(c.clozeText)
          if (!expansion.ok) {
            console.warn(`[engram] generation ${genId}: cloze rejeté — ${expansion.reason}`)
            continue
          }
          // A single group may be truncated mid-way by MAX_TOTAL_ITEMS; the
          // resulting cards are independent, so a partial group is acceptable.
          for (const card of expansion.cards) {
            if (items.length >= MAX_TOTAL_ITEMS) break
            items.push({
              id: randomUUID(),
              front: card.front,
              back: card.back,
              status: 'pending',
              kind: 'cloze',
              ...(c.contentType ? { contentType: c.contentType } : {}),
              clozeText: c.clozeText,
            })
          }
          continue
        }
        // qa draft. Only `mixed` stamps the evaluation metadata (kind/contentType)
        // so the review UI can badge it; cards/quiz stay byte-identical (no meta).
        items.push({
          id: randomUUID(),
          front: c.front,
          back: c.back,
          status: 'pending',
          ...(isMixed
            ? { kind: 'qa' as const, ...(c.contentType ? { contentType: c.contentType } : {}) }
            : {}),
        })
      }
    }

    await db
      .update(generation)
      .set({ status: 'succeeded', items, promptTokens, completionTokens })
      .where(eq(generation.id, genId))
  } catch (e) {
    const message = e instanceof Error ? e.message : 'generation failed'
    await db
      .update(generation)
      .set({ status: 'failed', error: message.slice(0, 1000) })
      .where(eq(generation.id, genId))
  }
}

/**
 * Apply per-card review decisions and insert accepted cards, idempotently, in a
 * single transaction. Items already carrying a `cardId` are FROZEN — no incoming
 * decision can re-insert, re-status, or delete them (that would destroy FSRS
 * history).
 */
export async function resolveGeneration(
  db: DB,
  userId: string,
  id: string,
  input: ResolveGeneration,
): Promise<Generation> {
  const row = await requireGenerationRow(db, userId, id)
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
    const deckRow = await requireDeckRow(db, userId, deckId)
    if ((await requireSubjectRow(db, userId, deckRow.subjectId)).archived) {
      throw new ConflictError('cannot insert cards into a deck under an archived subject')
    }
  }

  const updated = await db.transaction(async (tx) => {
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
        const cardId = await insertFreshCardRow(tx, userId, {
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

    const [saved] = await tx
      .update(generation)
      .set({ items: next })
      .where(eq(generation.id, id))
      .returning()
    return saved!
  })

  return generationToDto(updated)
}
