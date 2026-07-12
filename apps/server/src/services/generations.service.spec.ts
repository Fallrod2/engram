import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { GenerationItem } from '@engram/shared'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { card, generation, note } from '../db/schema'
import { ConflictError, NotFoundError, ValidationError } from '../http/errors'
import { seedDeck, seedSubject } from '../test-support/harness'
import type { CardGenerator } from '../ai/generator'
import {
  requireGenerationRow,
  resolveGeneration,
  runGenerationJob,
  startGeneration,
} from './generations.service'

let t: TestDb
let db: DB
beforeEach(() => {
  t = createTestDb()
  db = t.db as DB
})
afterEach(() => {
  t.cleanup()
})

/** A fake generator: one card per call, fixed token counts. Never hits the API. */
const oneCardGen: CardGenerator = {
  async generate() {
    return { cards: [{ front: 'Q', back: 'A' }], promptTokens: 10, completionTokens: 5 }
  },
}

function seedNote(content: string): string {
  return db.insert(note).values({ title: 'Note', sourceType: 'md', content }).returning().get().id
}

function seedGeneration(o: {
  noteId: string
  deckId?: string | null
  status?: 'pending' | 'succeeded' | 'failed'
  items?: GenerationItem[]
}): string {
  return db
    .insert(generation)
    .values({
      noteId: o.noteId,
      kind: 'cards',
      model: 'claude-sonnet-4-6',
      status: o.status ?? 'pending',
      items: o.items ?? [],
      ...(o.deckId != null ? { deckId: o.deckId } : {}),
    })
    .returning()
    .get().id
}

describe('startGeneration', () => {
  it('creates a pending row with items [] and returns the DTO', () => {
    const noteId = seedNote('some content')
    const dto = startGeneration(db, { noteId, kind: 'cards' }, oneCardGen)
    expect(dto.status).toBe('pending')
    expect(dto.items).toEqual([])
    expect(dto.model).toBe('claude-sonnet-4-6')
    expect(dto.noteId).toBe(noteId)
  })

  it('unknown noteId → NotFoundError', () => {
    expect(() => startGeneration(db, { noteId: 'nope', kind: 'cards' }, oneCardGen)).toThrow(
      NotFoundError,
    )
  })

  it('deckId under an archived subject → ConflictError', () => {
    const noteId = seedNote('content')
    const deck = seedDeck(db, seedSubject(db, { archived: true }).id)
    expect(() =>
      startGeneration(db, { noteId, kind: 'cards', deckId: deck.id }, oneCardGen),
    ).toThrow(ConflictError)
  })
})

describe('runGenerationJob', () => {
  it('multi-chunk note → aggregated items, summed tokens, status succeeded', async () => {
    const noteId = seedNote(`${'A'.repeat(8000)}\n\n${'B'.repeat(8000)}`)
    const genId = seedGeneration({ noteId })
    await runGenerationJob(db, genId, oneCardGen)
    const row = requireGenerationRow(db, genId)
    expect(row.status).toBe('succeeded')
    expect(row.items).toHaveLength(2) // one card per chunk, two chunks
    expect(row.promptTokens).toBe(20)
    expect(row.completionTokens).toBe(10)
    expect(row.items.every((i) => i.status === 'pending')).toBe(true)
  })

  it('generator that throws → status failed + error set, does not throw', async () => {
    const noteId = seedNote('content')
    const genId = seedGeneration({ noteId })
    const boomGen: CardGenerator = {
      async generate() {
        throw new Error('boom')
      },
    }
    await runGenerationJob(db, genId, boomGen)
    const row = requireGenerationRow(db, genId)
    expect(row.status).toBe('failed')
    expect(row.error).toContain('boom')
  })

  it('generator that rejects on timeout → status failed', async () => {
    const noteId = seedNote('content')
    const genId = seedGeneration({ noteId })
    const timeoutGen: CardGenerator = {
      async generate() {
        return Promise.reject(new Error('The operation was aborted due to timeout'))
      },
    }
    await runGenerationJob(db, genId, timeoutGen)
    expect(requireGenerationRow(db, genId).status).toBe('failed')
  })

  it('idempotent — a second run on a succeeded generation is a no-op', async () => {
    const noteId = seedNote('content')
    const genId = seedGeneration({ noteId })
    await runGenerationJob(db, genId, oneCardGen)
    const first = requireGenerationRow(db, genId).items
    // A generator that would add many cards — must not run.
    const manyGen: CardGenerator = {
      async generate() {
        return {
          cards: Array.from({ length: 5 }, (_, i) => ({ front: `x${i}`, back: `y${i}` })),
          promptTokens: 1,
          completionTokens: 1,
        }
      },
    }
    await runGenerationJob(db, genId, manyGen)
    expect(requireGenerationRow(db, genId).items).toEqual(first)
  })

  it('respects MAX_TOTAL_ITEMS (global cap)', async () => {
    const noteId = seedNote(`${'A'.repeat(8000)}\n\n${'B'.repeat(8000)}`)
    const genId = seedGeneration({ noteId })
    const bulkGen: CardGenerator = {
      async generate() {
        return {
          cards: Array.from({ length: 60 }, (_, i) => ({ front: `q${i}`, back: `a${i}` })),
          promptTokens: 1,
          completionTokens: 1,
        }
      },
    }
    await runGenerationJob(db, genId, bulkGen)
    // Two chunks × 60 = 120 proposed, capped at 100.
    expect(requireGenerationRow(db, genId).items).toHaveLength(100)
  })
})

describe('resolveGeneration', () => {
  function seedSucceeded(withDeck = true) {
    const noteId = seedNote('content')
    const deckId = withDeck ? seedDeck(db, seedSubject(db).id).id : null
    const items: GenerationItem[] = [
      { id: 'i0', front: 'Q0', back: 'A0', status: 'pending' },
      { id: 'i1', front: 'Q1', back: 'A1', status: 'pending' },
      { id: 'i2', front: 'Q2', back: 'A2', status: 'pending' },
      { id: 'i3', front: 'Q3', back: 'A3', status: 'pending' },
    ]
    const genId = seedGeneration({ noteId, deckId, status: 'succeeded', items })
    return { genId, deckId }
  }

  it('accepted/edited insert fresh cards; rejected/pending insert nothing', () => {
    const { genId, deckId } = seedSucceeded()
    const dto = resolveGeneration(db, genId, {
      items: [
        { id: 'i0', front: 'Q0', back: 'A0', status: 'accepted' },
        { id: 'i1', front: 'edited front', back: 'edited back', status: 'edited' },
        { id: 'i2', front: 'Q2', back: 'A2', status: 'rejected' },
        { id: 'i3', front: 'Q3', back: 'A3', status: 'pending' },
      ],
    })
    const cards = db
      .select()
      .from(card)
      .where(eq(card.deckId, deckId as string))
      .all()
    expect(cards).toHaveLength(2)
    const byId = new Map(dto.items.map((i) => [i.id, i]))
    expect(byId.get('i0')?.cardId).toBeDefined()
    expect(byId.get('i1')?.cardId).toBeDefined()
    expect(byId.get('i2')?.cardId).toBeUndefined()
    expect(byId.get('i2')?.status).toBe('rejected')
    expect(byId.get('i3')?.status).toBe('pending')
  })

  it('edited uses the client-modified front/back', () => {
    const { genId, deckId } = seedSucceeded()
    resolveGeneration(db, genId, {
      items: [{ id: 'i1', front: 'NEW FRONT', back: 'NEW BACK', status: 'edited' }],
    })
    const cards = db
      .select()
      .from(card)
      .where(eq(card.deckId, deckId as string))
      .all()
    expect(cards).toHaveLength(1)
    expect(cards[0]?.front).toBe('NEW FRONT')
    expect(cards[0]?.back).toBe('NEW BACK')
  })

  it('idempotent — replaying does not recreate cards', () => {
    const { genId, deckId } = seedSucceeded()
    const decision = { items: [{ id: 'i0', front: 'Q0', back: 'A0', status: 'accepted' as const }] }
    resolveGeneration(db, genId, decision)
    resolveGeneration(db, genId, decision)
    const cards = db
      .select()
      .from(card)
      .where(eq(card.deckId, deckId as string))
      .all()
    expect(cards).toHaveLength(1)
  })

  it('an already-inserted item (cardId) stays frozen even if re-sent as rejected', () => {
    const { genId, deckId } = seedSucceeded()
    resolveGeneration(db, genId, {
      items: [{ id: 'i0', front: 'Q0', back: 'A0', status: 'accepted' }],
    })
    const dto = resolveGeneration(db, genId, {
      items: [{ id: 'i0', front: 'Q0', back: 'A0', status: 'rejected' }],
    })
    const item = dto.items.find((i) => i.id === 'i0')
    expect(item?.status).toBe('accepted')
    expect(item?.cardId).toBeDefined()
    // The card still exists — never dropped.
    expect(
      db
        .select()
        .from(card)
        .where(eq(card.deckId, deckId as string))
        .all(),
    ).toHaveLength(1)
  })

  it('status !== succeeded → ConflictError (409)', () => {
    const noteId = seedNote('content')
    const genId = seedGeneration({ noteId, status: 'pending' })
    expect(() => resolveGeneration(db, genId, { items: [] })).toThrow(ConflictError)
  })

  it('unknown item id → ValidationError (400)', () => {
    const { genId } = seedSucceeded()
    expect(() =>
      resolveGeneration(db, genId, {
        items: [{ id: 'nope', front: 'x', back: 'y', status: 'accepted' }],
      }),
    ).toThrow(ValidationError)
  })

  it('accepting with no target deck (deckId null) → ConflictError (409)', () => {
    const { genId } = seedSucceeded(false)
    expect(() =>
      resolveGeneration(db, genId, {
        items: [{ id: 'i0', front: 'Q0', back: 'A0', status: 'accepted' }],
      }),
    ).toThrow(ConflictError)
  })

  it('inserted cards carry a fresh FSRS state (state 0, reps 0)', () => {
    const { genId, deckId } = seedSucceeded()
    resolveGeneration(db, genId, {
      items: [{ id: 'i0', front: 'Q0', back: 'A0', status: 'accepted' }],
    })
    const row = db
      .select()
      .from(card)
      .where(eq(card.deckId, deckId as string))
      .get()
    expect(row?.state).toBe(0)
    expect(row?.reps).toBe(0)
  })
})
